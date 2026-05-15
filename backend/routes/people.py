from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from bson import ObjectId

from database import people_collection, events_collection
from models import PersonCreate, PersonUpdate
from embeddings import EmbeddingService

router = APIRouter(prefix="/api/people")
embedding_service = EmbeddingService()

ALLOWED_COLORS = {
    "blue", "emerald", "violet", "amber", "rose",
    "cyan", "fuchsia", "lime", "orange", "slate",
}


def _serialize(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    for field in ("created_at", "updated_at"):
        val = doc.get(field)
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            doc[field] = val.isoformat()
    return doc


def _serialize_event(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        val = doc.get(field)
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            doc[field] = val.isoformat()
    return doc


def _validate_color(color: str):
    if color not in ALLOWED_COLORS:
        raise HTTPException(
            status_code=400,
            detail=f"color must be one of {sorted(ALLOWED_COLORS)}",
        )


@router.get("")
async def list_people():
    cursor = people_collection.find().sort("name", 1)
    return [_serialize(doc) async for doc in cursor]


@router.post("")
async def create_person(person: PersonCreate):
    _validate_color(person.color)
    now = datetime.now(timezone.utc)
    doc = person.model_dump()
    doc["created_at"] = now
    doc["updated_at"] = now
    result = await people_collection.insert_one(doc)
    created = await people_collection.find_one({"_id": result.inserted_id})
    return _serialize(created)


@router.get("/{person_id}")
async def get_person(person_id: str):
    doc = await people_collection.find_one({"_id": ObjectId(person_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Person not found")
    return _serialize(doc)


@router.put("/{person_id}")
async def update_person(person_id: str, person: PersonUpdate):
    updates = person.model_dump(exclude_unset=True)
    if "color" in updates:
        _validate_color(updates["color"])
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await people_collection.update_one(
        {"_id": ObjectId(person_id)}, {"$set": updates}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Person not found")

    # If the name changed, re-embed events that reference this person so
    # semantic search picks up the new name.
    if "name" in updates:
        async for event_doc in events_collection.find({"people": person_id}):
            await embedding_service.upsert_event(_serialize_event(event_doc))

    updated = await people_collection.find_one({"_id": ObjectId(person_id)})
    return _serialize(updated)


@router.delete("/{person_id}")
async def delete_person(person_id: str):
    result = await people_collection.delete_one({"_id": ObjectId(person_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Person not found")

    # Cascade: pull this person from every event, then re-embed affected events.
    affected_ids = [doc["_id"] async for doc in events_collection.find(
        {"people": person_id}, {"_id": 1}
    )]
    if affected_ids:
        await events_collection.update_many(
            {"_id": {"$in": affected_ids}},
            {"$pull": {"people": person_id}},
        )
        async for event_doc in events_collection.find({"_id": {"$in": affected_ids}}):
            await embedding_service.upsert_event(_serialize_event(event_doc))

    return {"deleted": True, "events_updated": len(affected_ids)}
