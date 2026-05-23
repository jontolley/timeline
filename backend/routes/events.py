from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from bson import ObjectId
from auth import require_auth
from database import categories_collection, events_collection, threads_collection
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


async def _serialize(doc: dict) -> dict:
    """Serialize an event doc for the API. Generates fresh presigned GET URLs
    for any attached media on every read (signing is local and cheap).
    Tolerates legacy docs that still have `photos` instead of `media`."""
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
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
    return doc


_MAX_PAGE_SIZE = 200


@router.get("")
async def list_events(
    event_type: Optional[str] = None,
    tag: Optional[str] = None,
    person_id: Optional[list[str]] = Query(None),
    thread_id: Optional[list[str]] = Query(None),
    limit: Optional[int] = None,
    before_date: Optional[str] = None,
    before_id: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    """List events owned by the current user.

    Default (no `limit`) — returns every event ascending by date. With
    `limit` — paginated newest-first via the (before_date, before_id) cursor.
    """
    query: dict = {"owner_id": user["_id"]}
    if event_type:
        query["event_type"] = event_type
    if tag:
        query["tags"] = tag
    if person_id:
        query["people"] = {"$in": person_id}
    if thread_id:
        try:
            thread_oids = [ObjectId(t) for t in thread_id if t]
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid thread_id filter")
        if thread_oids:
            query["thread_id"] = {"$in": thread_oids}

    if limit is None:
        cursor = events_collection.find(query).sort("date", 1)
        return [await _serialize(doc) async for doc in cursor]

    capped_limit = max(1, min(int(limit), _MAX_PAGE_SIZE))

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
            query = {
                "$and": [
                    query,
                    {
                        "$or": [
                            {"date": {"$lt": cursor_dt}},
                            {"date": cursor_dt, "_id": {"$lt": cursor_oid}},
                        ]
                    },
                ]
            }
        else:
            query = {"$and": [query, {"date": {"$lt": cursor_dt}}]}

    cursor = (
        events_collection.find(query)
        .sort([("date", -1), ("_id", -1)])
        .limit(capped_limit)
    )
    return [await _serialize(doc) async for doc in cursor]


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
    doc = await events_collection.find_one({"_id": ObjectId(event_id), "owner_id": user["_id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    return await _serialize(doc)


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
