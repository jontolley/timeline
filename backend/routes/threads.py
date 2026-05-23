from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from auth import require_auth
from database import events_collection, threads_collection
from models import ThreadCreate, ThreadUpdate

router = APIRouter(prefix="/api/threads")

ALLOWED_COLORS = {
    "blue", "emerald", "violet", "amber", "rose",
    "cyan", "fuchsia", "lime", "orange", "slate",
}
ALLOWED_VISIBILITY = {"private", "shared"}


def _serialize(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    doc.pop("owner_id", None)
    for field in ("created_at", "updated_at"):
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
async def list_threads(user: dict = Depends(require_auth)):
    cursor = threads_collection.find({"owner_id": user["_id"]}).sort("created_at", 1)
    return [_serialize(doc) async for doc in cursor]


@router.post("")
async def create_thread(thread: ThreadCreate, user: dict = Depends(require_auth)):
    name = thread.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    _validate_color(thread.color)
    visibility = thread.visibility.value if hasattr(thread.visibility, "value") else thread.visibility
    if visibility not in ALLOWED_VISIBILITY:
        raise HTTPException(status_code=400, detail="invalid visibility")
    now = datetime.now(timezone.utc)
    doc = {
        "owner_id": user["_id"],
        "name": name,
        "color": thread.color,
        "visibility": visibility,
        "created_at": now,
        "updated_at": now,
    }
    result = await threads_collection.insert_one(doc)
    created = await threads_collection.find_one({"_id": result.inserted_id})
    return _serialize(created)


@router.put("/{thread_id}")
async def update_thread(thread_id: str, patch: ThreadUpdate, user: dict = Depends(require_auth)):
    updates = patch.model_dump(exclude_unset=True)
    if "color" in updates:
        _validate_color(updates["color"])
    if "name" in updates:
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be blank")
        updates["name"] = name
    if "visibility" in updates and updates["visibility"] is not None:
        vis = updates["visibility"]
        vis = vis.value if hasattr(vis, "value") else vis
        if vis not in ALLOWED_VISIBILITY:
            raise HTTPException(status_code=400, detail="invalid visibility")
        updates["visibility"] = vis
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await threads_collection.update_one(
        {"_id": ObjectId(thread_id), "owner_id": user["_id"]},
        {"$set": updates},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Thread not found")
    updated = await threads_collection.find_one({"_id": ObjectId(thread_id)})
    return _serialize(updated)


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str, user: dict = Depends(require_auth)):
    doc = await threads_collection.find_one(
        {"_id": ObjectId(thread_id), "owner_id": user["_id"]}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Thread not found")
    # Block deletion while any of this user's events still reference the thread.
    in_use = await events_collection.count_documents(
        {"thread_id": doc["_id"], "owner_id": user["_id"]}
    )
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"{in_use} event(s) still belong to this thread — move them first",
        )
    # Don't let a user delete their last thread — every event needs one.
    remaining = await threads_collection.count_documents({"owner_id": user["_id"]})
    if remaining <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete your only thread — create another first",
        )
    await threads_collection.delete_one({"_id": ObjectId(thread_id)})
    return {"deleted": True}
