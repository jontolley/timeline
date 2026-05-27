import re
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from bson import ObjectId
from auth import require_auth
from database import (
    categories_collection,
    events_collection,
    people_collection,
    thread_subscriptions_collection,
    threads_collection,
)
from models import EventCreate, EventUpdate
from embeddings import EmbeddingService
import storage

router = APIRouter(prefix="/api/events")
embedding_service = EmbeddingService()


async def _validate_event_type(event_type: Optional[str], owner_id: ObjectId):
    """Reject event_type values that don't match a category owned by the
    current user. Skipped when None (PATCH-style updates that don't include the field)."""
    if event_type is None:
        return
    exists = await categories_collection.find_one({"name": event_type, "owner_id": owner_id})
    if not exists:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown event_type '{event_type}' — see GET /api/categories",
        )


async def _resolve_thread_id(thread_id: Optional[str], owner_id: ObjectId) -> ObjectId:
    """Validate a thread_id (string) belongs to the current user; if None,
    fall back to the user's oldest thread. Raises 400 if the user has no
    threads yet (shouldn't happen post-migration)."""
    if thread_id:
        try:
            oid = ObjectId(thread_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid thread_id")
        thread = await threads_collection.find_one({"_id": oid, "owner_id": owner_id})
        if not thread:
            raise HTTPException(status_code=400, detail="thread_id not found")
        return oid
    # Default to the oldest thread this user owns.
    default_thread = await threads_collection.find_one(
        {"owner_id": owner_id}, sort=[("created_at", 1)]
    )
    if not default_thread:
        raise HTTPException(
            status_code=500,
            detail="No threads exist for this user — migration may not have run",
        )
    return default_thread["_id"]


async def _build_denorm_context(docs: list[dict], viewer_id) -> dict:
    """Pre-load the foreign owners' category labels + people names for any
    events not owned by `viewer_id`. Avoids N+1 lookups during _serialize."""
    foreign_owner_ids = {d.get("owner_id") for d in docs if d.get("owner_id") and d.get("owner_id") != viewer_id}
    cat_map: dict = {}  # (owner_id, name) -> {label, color}
    if foreign_owner_ids:
        async for c in categories_collection.find({"owner_id": {"$in": list(foreign_owner_ids)}}):
            cat_map[(c["owner_id"], c["name"])] = {"label": c["label"], "color": c["color"]}

    people_ids: set = set()
    for d in docs:
        if d.get("owner_id") != viewer_id:
            for pid in (d.get("people") or []):
                if isinstance(pid, str):
                    people_ids.add(pid)
    people_map: dict = {}
    if people_ids:
        try:
            oids = [ObjectId(pid) for pid in people_ids if pid]
            async for p in people_collection.find(
                {"_id": {"$in": oids}}, {"_id": 1, "name": 1, "color": 1}
            ):
                people_map[str(p["_id"])] = {"name": p.get("name") or "", "color": p.get("color") or "slate"}
        except Exception:
            pass

    return {"viewer_id": viewer_id, "categories": cat_map, "people": people_map}


async def _serialize(doc: dict, context: dict = None) -> dict:
    """Serialize an event doc for the API. Generates fresh presigned GET URLs
    for any attached media on every read (signing is local and cheap).
    Tolerates legacy docs that still have `photos` instead of `media`.

    When `context` is provided (from `_build_denorm_context`), events whose
    owner_id != context["viewer_id"] get denormalized category + people
    metadata embedded so the viewer's UI can render them without doing
    cross-user lookups against stores it doesn't have access to."""
    doc = dict(doc)
    raw_owner_id = doc.get("owner_id")
    doc["_id"] = str(doc["_id"])
    is_foreign = context is not None and raw_owner_id is not None and raw_owner_id != context["viewer_id"]
    doc["is_owner"] = not is_foreign
    doc.pop("owner_id", None)  # internal field, not surfaced to the client
    if doc.get("thread_id") is not None:
        doc["thread_id"] = str(doc["thread_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        val = doc.get(field)
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            doc[field] = val.isoformat()
    loc = doc.get("location")
    if isinstance(loc, str):
        doc["location"] = {"name": loc, "address": None, "lat": None, "lng": None}
    if doc.get("people") is None:
        doc["people"] = []

    raw_media = doc.get("media")
    if raw_media is None:
        # Fall back to legacy field for any doc the migration hasn't touched yet.
        raw_media = doc.get("photos") or []
    enriched = []
    for m in raw_media:
        m = dict(m)
        m.setdefault("kind", "photo")  # legacy items had no kind
        uploaded = m.get("uploaded_at")
        if isinstance(uploaded, datetime):
            if uploaded.tzinfo is None:
                uploaded = uploaded.replace(tzinfo=timezone.utc)
            m["uploaded_at"] = uploaded.isoformat()
        if storage.is_configured() and m.get("key"):
            try:
                m["url"] = await storage.presign_get(m["key"])
            except Exception:
                m["url"] = None
            if m.get("thumb_key"):
                try:
                    m["thumb_url"] = await storage.presign_get(m["thumb_key"])
                except Exception:
                    m["thumb_url"] = None
        enriched.append(m)
    doc["media"] = enriched
    doc.pop("photos", None)

    # Denormalize category + people for shared events so the viewer's UI can
    # render the owner's category color/label and the owner's people names
    # without cross-user lookups.
    if is_foreign and context is not None:
        cat = context["categories"].get((raw_owner_id, doc.get("event_type")))
        if cat:
            doc["category_display"] = {"label": cat["label"], "color": cat["color"]}
        people_disp = []
        for pid in (doc.get("people") or []):
            if isinstance(pid, str):
                info = context["people"].get(pid)
                if info:
                    people_disp.append({"id": pid, "name": info["name"], "color": info["color"]})
        if people_disp:
            doc["people_display"] = people_disp

    return doc


_MAX_PAGE_SIZE = 200


async def _visible_thread_filter(viewer_id, thread_id_filter: Optional[list[str]]):
    """Resolve the visible-thread set + optional explicit thread filter into a
    Mongo query fragment. Returns either a dict ready to merge into the events
    query, or None if the viewer can't see any threads."""
    own_thread_ids = [
        t["_id"] async for t in threads_collection.find(
            {"owner_id": viewer_id}, {"_id": 1}
        )
    ]
    sub_thread_ids = [
        s["thread_id"] async for s in thread_subscriptions_collection.find(
            {"subscriber_user_id": viewer_id, "visible": True}, {"thread_id": 1}
        )
    ]
    visible_thread_ids = own_thread_ids + sub_thread_ids
    if not visible_thread_ids:
        return None, []

    allowed = visible_thread_ids
    if thread_id_filter:
        try:
            thread_oids = [ObjectId(t) for t in thread_id_filter if t]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid thread_id filter")
        if thread_oids:
            allowed = [tid for tid in thread_oids if tid in visible_thread_ids]
    return {"$in": allowed}, visible_thread_ids


@router.get("")
async def list_events(
    event_type: Optional[str] = None,
    tag: Optional[str] = None,
    person_id: Optional[list[str]] = Query(None),
    thread_id: Optional[list[str]] = Query(None),
    limit: Optional[int] = None,
    before_date: Optional[str] = None,
    before_id: Optional[str] = None,
    after_date: Optional[str] = None,
    after_id: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    """List events the current user can see — their own plus events in any
    threads they're subscribed to (with subscription.visible=true).

    Default (no `limit`) — returns every event ascending by date. With
    `limit` — paginated newest-first. Use the (before_date, before_id) cursor
    to get *older* events; use (after_date, after_id) to get *newer* events
    (e.g. when paginating upward after jumping to a past year). Both cursors
    can be supplied to bound a window, but typically only one is set.
    """
    viewer_id = user["_id"]

    thread_clause, _ = await _visible_thread_filter(viewer_id, thread_id)
    if thread_clause is None:
        return []

    query: dict = {"thread_id": thread_clause}
    if event_type:
        query["event_type"] = event_type
    if tag:
        query["tags"] = tag
    if person_id:
        query["people"] = {"$in": person_id}

    if limit is None:
        cursor = events_collection.find(query).sort("date", 1)
        docs = [doc async for doc in cursor]
        context = await _build_denorm_context(docs, viewer_id)
        return [await _serialize(doc, context) for doc in docs]

    capped_limit = max(1, min(int(limit), _MAX_PAGE_SIZE))

    # Cursor clauses are appended to the base query as additional $and terms.
    extra_clauses = []

    if before_date:
        try:
            cursor_dt = datetime.fromisoformat(before_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid before_date")
        if before_id:
            try:
                cursor_oid = ObjectId(before_id)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid before_id")
            extra_clauses.append({
                "$or": [
                    {"date": {"$lt": cursor_dt}},
                    {"date": cursor_dt, "_id": {"$lt": cursor_oid}},
                ]
            })
        else:
            extra_clauses.append({"date": {"$lt": cursor_dt}})

    if after_date:
        try:
            after_dt = datetime.fromisoformat(after_date.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid after_date")
        if after_id:
            try:
                after_oid = ObjectId(after_id)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid after_id")
            extra_clauses.append({
                "$or": [
                    {"date": {"$gt": after_dt}},
                    {"date": after_dt, "_id": {"$gt": after_oid}},
                ]
            })
        else:
            extra_clauses.append({"date": {"$gt": after_dt}})

    if extra_clauses:
        query = {"$and": [query, *extra_clauses]}

    # Pagination order: when paginating upward (after_date and no before_date),
    # we want the events *closest* to the cursor on the newer side, not the
    # newest events overall. Sort ASC, take N, then reverse so the response is
    # always newest-first.
    upward = bool(after_date) and not before_date
    sort_spec = [("date", 1), ("_id", 1)] if upward else [("date", -1), ("_id", -1)]

    cursor = (
        events_collection.find(query)
        .sort(sort_spec)
        .limit(capped_limit)
    )
    docs = [doc async for doc in cursor]
    if upward:
        docs.reverse()
    context = await _build_denorm_context(docs, viewer_id)
    return [await _serialize(doc, context) for doc in docs]


@router.get("/years")
async def list_event_years(
    event_type: Optional[str] = None,
    tag: Optional[str] = None,
    person_id: Optional[list[str]] = Query(None),
    thread_id: Optional[list[str]] = Query(None),
    user: dict = Depends(require_auth),
):
    """Return a year-bucket index for the timeline sidebar:
    [{ "year": 2025, "count": 14 }, …] in descending order. Respects the same
    filter set as the event list so years with zero matching events disappear
    from the rail when filters narrow the view."""
    viewer_id = user["_id"]

    thread_clause, _ = await _visible_thread_filter(viewer_id, thread_id)
    if thread_clause is None:
        return []

    match: dict = {"thread_id": thread_clause}
    if event_type:
        match["event_type"] = event_type
    if tag:
        match["tags"] = tag
    if person_id:
        match["people"] = {"$in": person_id}

    pipeline = [
        {"$match": match},
        {"$group": {"_id": {"$year": "$date"}, "count": {"$sum": 1}}},
        {"$sort": {"_id": -1}},
    ]
    return [
        {"year": doc["_id"], "count": doc["count"]}
        async for doc in events_collection.aggregate(pipeline)
    ]


@router.get("/search")
async def search_events(
    q: str = "",
    event_type: Optional[str] = None,
    tag: Optional[str] = None,
    person_id: Optional[list[str]] = Query(None),
    thread_id: Optional[list[str]] = Query(None),
    limit: int = 50,
    user: dict = Depends(require_auth),
):
    """Keyword (substring) search across event title, description, location
    name/address, tags, and person names. Narrowed by the same filter chips
    the timeline list endpoint accepts so the UI's active filters keep
    applying. NOT vector/AI search — for that, use the chat endpoint.

    People are matched by pre-resolving the viewer's people collection to
    *string* IDs (events store person refs as stringified ObjectIds —
    see EventBase.people: list[str]). A person rename takes effect
    immediately without re-indexing event docs.
    """
    q = q.strip()
    if not q:
        return []

    viewer_id = user["_id"]
    thread_clause, _ = await _visible_thread_filter(viewer_id, thread_id)
    if thread_clause is None:
        return []

    capped_limit = max(1, min(int(limit), _MAX_PAGE_SIZE))

    needle = {"$regex": re.escape(q), "$options": "i"}
    # Events store person refs as strings, not ObjectIds, so stringify here
    # to match the storage type. Using ObjectIds in the $in below would
    # silently never match.
    matching_people_ids = [
        str(p["_id"]) async for p in people_collection.find(
            {"owner_id": viewer_id, "name": needle},
            {"_id": 1},
        )
    ]

    or_clauses = [
        {"title": needle},
        {"description": needle},
        {"location.name": needle},
        {"location.address": needle},
        {"tags": needle},
    ]
    if matching_people_ids:
        or_clauses.append({"people": {"$in": matching_people_ids}})

    query: dict = {"thread_id": thread_clause}
    if event_type:
        query["event_type"] = event_type
    if tag:
        query["tags"] = tag
    if person_id:
        # Filter chip narrows alongside the search match — both must hold.
        query["people"] = {"$in": person_id}
    query["$or"] = or_clauses

    cursor = (
        events_collection.find(query)
        .sort([("date", -1), ("_id", -1)])
        .limit(capped_limit)
    )
    docs = [doc async for doc in cursor]
    context = await _build_denorm_context(docs, viewer_id)
    return [await _serialize(doc, context) for doc in docs]


@router.post("")
async def create_event(event: EventCreate, user: dict = Depends(require_auth)):
    await _validate_event_type(event.event_type, user["_id"])
    resolved_thread = await _resolve_thread_id(event.thread_id, user["_id"])
    now = datetime.now(timezone.utc)
    doc = event.model_dump()
    doc["owner_id"] = user["_id"]
    doc["thread_id"] = resolved_thread
    doc["created_at"] = now
    doc["updated_at"] = now
    result = await events_collection.insert_one(doc)
    created = await events_collection.find_one({"_id": result.inserted_id})
    serialized = await _serialize(created)
    await embedding_service.upsert_event(serialized, owner_id=str(user["_id"]))
    return serialized


@router.get("/{event_id}")
async def get_event(event_id: str, user: dict = Depends(require_auth)):
    doc = await events_collection.find_one({"_id": ObjectId(event_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    # Access check: caller owns the event OR is subscribed (visible=true) to its thread.
    if doc.get("owner_id") != user["_id"]:
        sub = await thread_subscriptions_collection.find_one({
            "thread_id": doc.get("thread_id"),
            "subscriber_user_id": user["_id"],
            "visible": True,
        })
        if not sub:
            raise HTTPException(status_code=404, detail="Event not found")
    context = await _build_denorm_context([doc], user["_id"])
    return await _serialize(doc, context)


@router.put("/{event_id}")
async def update_event(event_id: str, event: EventUpdate, user: dict = Depends(require_auth)):
    await _validate_event_type(event.event_type, user["_id"])
    updates = event.model_dump(exclude_unset=True)
    # If the caller is changing the thread, validate the new one before write.
    if "thread_id" in updates and updates["thread_id"] is not None:
        updates["thread_id"] = await _resolve_thread_id(updates["thread_id"], user["_id"])
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await events_collection.update_one(
        {"_id": ObjectId(event_id), "owner_id": user["_id"]},
        {"$set": updates},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    updated = await events_collection.find_one({"_id": ObjectId(event_id)})
    serialized = await _serialize(updated)
    await embedding_service.upsert_event(serialized, owner_id=str(user["_id"]))
    return serialized


@router.delete("/{event_id}")
async def delete_event(event_id: str, user: dict = Depends(require_auth)):
    doc = await events_collection.find_one(
        {"_id": ObjectId(event_id), "owner_id": user["_id"]}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")

    # Best-effort: clean up any R2 objects attached to this event
    if storage.is_configured():
        attached = doc.get("media") or doc.get("photos") or []
        for m in attached:
            for k in (m.get("key"), m.get("thumb_key")):
                if not k:
                    continue
                try:
                    await storage.delete_object(k)
                except Exception:
                    pass

    await events_collection.delete_one({"_id": ObjectId(event_id)})
    await embedding_service.delete_event(event_id)
    return {"deleted": True}


class MediaAttachRequest(BaseModel):
    kind: str = "photo"  # photo | video | audio
    key: str
    thumb_key: Optional[str] = None
    content_type: str
    width: Optional[int] = None
    height: Optional[int] = None
    duration_seconds: Optional[float] = None


@router.post("/{event_id}/media")
async def attach_media(event_id: str, media: MediaAttachRequest, user: dict = Depends(require_auth)):
    if not storage.is_configured():
        raise HTTPException(status_code=503, detail="Storage backend not configured")

    if media.kind not in {"photo", "video", "audio"}:
        raise HTTPException(status_code=400, detail=f"Unsupported media kind: {media.kind}")

    if not await storage.object_exists(media.key):
        raise HTTPException(status_code=400, detail="Uploaded object not found in storage")

    now = datetime.now(timezone.utc)
    media_doc = {
        "kind": media.kind,
        "key": media.key,
        "thumb_key": media.thumb_key,
        "content_type": media.content_type,
        "width": media.width,
        "height": media.height,
        "duration_seconds": media.duration_seconds,
        "uploaded_at": now,
    }
    result = await events_collection.update_one(
        {"_id": ObjectId(event_id), "owner_id": user["_id"]},
        {"$push": {"media": media_doc}, "$set": {"updated_at": now}},
    )
    if result.matched_count == 0:
        try:
            await storage.delete_object(media.key)
            if media.thumb_key:
                await storage.delete_object(media.thumb_key)
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="Event not found")

    updated = await events_collection.find_one({"_id": ObjectId(event_id)})
    return await _serialize(updated)


@router.delete("/{event_id}/media/{key:path}")
async def remove_media(event_id: str, key: str, user: dict = Depends(require_auth)):
    doc = await events_collection.find_one(
        {"_id": ObjectId(event_id), "owner_id": user["_id"]}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    attached = doc.get("media") or doc.get("photos") or []
    target = next((m for m in attached if m.get("key") == key), None)

    await events_collection.update_one(
        {"_id": ObjectId(event_id), "owner_id": user["_id"]},
        {
            "$pull": {"media": {"key": key}, "photos": {"key": key}},
            "$set": {"updated_at": datetime.now(timezone.utc)},
        },
    )

    if storage.is_configured():
        keys_to_delete = [key]
        if target and target.get("thumb_key"):
            keys_to_delete.append(target["thumb_key"])
        for k in keys_to_delete:
            try:
                await storage.delete_object(k)
            except Exception:
                pass

    updated = await events_collection.find_one({"_id": ObjectId(event_id)})
    return await _serialize(updated)
