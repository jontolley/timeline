from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException
from bson import ObjectId
from database import events_collection
from models import EventCreate, EventUpdate
from embeddings import EmbeddingService

router = APIRouter(prefix="/api/events")
embedding_service = EmbeddingService()


def _serialize(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    for field in ("date", "created_at", "updated_at"):
        val = doc.get(field)
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            doc[field] = val.isoformat()
    # Normalize legacy string locations to LocationDetail format
    loc = doc.get("location")
    if isinstance(loc, str):
        doc["location"] = {"name": loc, "address": None, "lat": None, "lng": None}
    return doc


@router.get("")
async def list_events(event_type: Optional[str] = None, tag: Optional[str] = None):
    query = {}
    if event_type:
        query["event_type"] = event_type
    if tag:
        query["tags"] = tag
    cursor = events_collection.find(query).sort("date", 1)
    return [_serialize(doc) async for doc in cursor]


@router.post("")
async def create_event(event: EventCreate):
    now = datetime.now(timezone.utc)
    doc = event.model_dump()
    doc["created_at"] = now
    doc["updated_at"] = now
    result = await events_collection.insert_one(doc)
    created = await events_collection.find_one({"_id": result.inserted_id})
    serialized = _serialize(created)
    await embedding_service.upsert_event(serialized)
    return serialized


@router.get("/{event_id}")
async def get_event(event_id: str):
    doc = await events_collection.find_one({"_id": ObjectId(event_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Event not found")
    return _serialize(doc)


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
    serialized = _serialize(updated)
    await embedding_service.upsert_event(serialized)
    return serialized


@router.delete("/{event_id}")
async def delete_event(event_id: str):
    result = await events_collection.delete_one({"_id": ObjectId(event_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    await embedding_service.delete_event(event_id)
    return {"deleted": True}
