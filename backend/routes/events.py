from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from bson import ObjectId
from database import events_collection
from models import EventCreate, EventUpdate
from embeddings import EmbeddingService
import storage

router = APIRouter(prefix="/api/events")
embedding_service = EmbeddingService()


async def _serialize(doc: dict) -> dict:
    """Serialize an event doc for the API. Generates fresh presigned GET URLs
    for any attached photos on every read (signing is local and cheap)."""
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
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

    photos = doc.get("photos") or []
    enriched = []
    for p in photos:
        p = dict(p)
        uploaded = p.get("uploaded_at")
        if isinstance(uploaded, datetime):
            if uploaded.tzinfo is None:
                uploaded = uploaded.replace(tzinfo=timezone.utc)
            p["uploaded_at"] = uploaded.isoformat()
        if storage.is_configured() and p.get("key"):
            try:
                p["url"] = await storage.presign_get(p["key"])
            except Exception:
                p["url"] = None
            # Sign the thumbnail too if one exists. Older photos won't have
            # a thumb_key — frontend falls back to `url` in that case.
            if p.get("thumb_key"):
                try:
                    p["thumb_url"] = await storage.presign_get(p["thumb_key"])
                except Exception:
                    p["thumb_url"] = None
        enriched.append(p)
    doc["photos"] = enriched
    return doc


@router.get("")
async def list_events(
    event_type: Optional[str] = None,
    tag: Optional[str] = None,
    person_id: Optional[list[str]] = Query(None),
):
    query = {}
    if event_type:
        query["event_type"] = event_type
    if tag:
        query["tags"] = tag
    if person_id:
        query["people"] = {"$in": person_id}
    cursor = events_collection.find(query).sort("date", 1)
    return [await _serialize(doc) async for doc in cursor]


@router.post("")
async def create_event(event: EventCreate):
    now = datetime.now(timezone.utc)
    doc = event.model_dump()
    doc["created_at"] = now
    doc["updated_at"] = now
    result = await events_collection.insert_one(doc)
    created = await events_collection.find_one({"_id": result.inserted_id})
    serialized = await _serialize(created)
    await embedding_service.upsert_event(serialized)
    return serialized


@router.get("/{event_id}")
async def get_event(event_id: str):
    doc = await events_collection.find_one({"_id": ObjectId(event_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    return await _serialize(doc)


@router.put("/{event_id}")
async def update_event(event_id: str, event: EventUpdate):
    updates = event.model_dump(exclude_unset=True)
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await events_collection.update_one(
        {"_id": ObjectId(event_id)}, {"$set": updates}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    updated = await events_collection.find_one({"_id": ObjectId(event_id)})
    serialized = await _serialize(updated)
    await embedding_service.upsert_event(serialized)
    return serialized


@router.delete("/{event_id}")
async def delete_event(event_id: str):
    doc = await events_collection.find_one({"_id": ObjectId(event_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")

    # Best-effort: clean up any R2 objects attached to this event
    if storage.is_configured():
        for p in (doc.get("photos") or []):
            for k in (p.get("key"), p.get("thumb_key")):
                if not k:
                    continue
                try:
                    await storage.delete_object(k)
                except Exception:
                    pass

    await events_collection.delete_one({"_id": ObjectId(event_id)})
    await embedding_service.delete_event(event_id)
    return {"deleted": True}


class PhotoAttachRequest(BaseModel):
    key: str
    thumb_key: Optional[str] = None
    content_type: str
    width: Optional[int] = None
    height: Optional[int] = None


@router.post("/{event_id}/photos")
async def attach_photo(event_id: str, photo: PhotoAttachRequest):
    if not storage.is_configured():
        raise HTTPException(status_code=503, detail="Storage backend not configured")

    # The key was just presigned + PUT by the client — confirm the object
    # actually exists before recording it on the event.
    if not await storage.object_exists(photo.key):
        raise HTTPException(
            status_code=400,
            detail="Uploaded object not found in storage",
        )

    now = datetime.now(timezone.utc)
    photo_doc = {
        "key": photo.key,
        "thumb_key": photo.thumb_key,
        "content_type": photo.content_type,
        "width": photo.width,
        "height": photo.height,
        "uploaded_at": now,
    }
    result = await events_collection.update_one(
        {"_id": ObjectId(event_id)},
        {"$push": {"photos": photo_doc}, "$set": {"updated_at": now}},
    )
    if result.matched_count == 0:
        # Object is now orphaned in R2 — delete it so the bucket stays clean.
        try:
            await storage.delete_object(photo.key)
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="Event not found")

    updated = await events_collection.find_one({"_id": ObjectId(event_id)})
    return await _serialize(updated)


@router.delete("/{event_id}/photos/{key:path}")
async def remove_photo(event_id: str, key: str):
    # Look up the photo first so we know its thumb_key (if any) before $pull.
    doc = await events_collection.find_one({"_id": ObjectId(event_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    target = next(
        (p for p in (doc.get("photos") or []) if p.get("key") == key),
        None,
    )

    await events_collection.update_one(
        {"_id": ObjectId(event_id)},
        {
            "$pull": {"photos": {"key": key}},
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
