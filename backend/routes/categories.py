import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from auth import require_auth
from database import categories_collection, events_collection
from models import CategoryCreate, CategoryUpdate

router = APIRouter(prefix="/api/categories")

ALLOWED_COLORS = {
    "blue", "emerald", "violet", "amber", "rose",
    "cyan", "fuchsia", "lime", "orange", "slate",
}

_SLUG_RE = re.compile(r"^[a-z0-9_-]{1,32}$")


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


def _validate_name(name: str):
    if not _SLUG_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="name must be 1-32 chars, lowercase letters/digits/hyphen/underscore only",
        )


@router.get("")
async def list_categories(user: dict = Depends(require_auth)):
    cursor = categories_collection.find({"owner_id": user["_id"]}).sort("label", 1)
    return [_serialize(doc) async for doc in cursor]


@router.post("")
async def create_category(category: CategoryCreate, user: dict = Depends(require_auth)):
    _validate_name(category.name)
    _validate_color(category.color)
    if not category.label.strip():
        raise HTTPException(status_code=400, detail="label is required")
    existing = await categories_collection.find_one(
        {"name": category.name, "owner_id": user["_id"]}
    )
    if existing:
        raise HTTPException(status_code=409, detail=f"category '{category.name}' already exists")
    now = datetime.now(timezone.utc)
    doc = category.model_dump()
    doc["label"] = doc["label"].strip()
    doc["owner_id"] = user["_id"]
    doc["created_at"] = now
    doc["updated_at"] = now
    result = await categories_collection.insert_one(doc)
    created = await categories_collection.find_one({"_id": result.inserted_id})
    return _serialize(created)


@router.put("/{category_id}")
async def update_category(category_id: str, patch: CategoryUpdate, user: dict = Depends(require_auth)):
    updates = patch.model_dump(exclude_unset=True)
    if "color" in updates:
        _validate_color(updates["color"])
    if "label" in updates:
        label = (updates["label"] or "").strip()
        if not label:
            raise HTTPException(status_code=400, detail="label cannot be blank")
        updates["label"] = label
    updates["updated_at"] = datetime.now(timezone.utc)
    result = await categories_collection.update_one(
        {"_id": ObjectId(category_id), "owner_id": user["_id"]},
        {"$set": updates},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Category not found")
    updated = await categories_collection.find_one({"_id": ObjectId(category_id)})
    return _serialize(updated)


@router.delete("/{category_id}")
async def delete_category(category_id: str, user: dict = Depends(require_auth)):
    doc = await categories_collection.find_one(
        {"_id": ObjectId(category_id), "owner_id": user["_id"]}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Category not found")
    # Block deletion if any of this user's events still use this category.
    in_use = await events_collection.count_documents(
        {"event_type": doc["name"], "owner_id": user["_id"]}
    )
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"{in_use} event(s) still use this category — reassign them first",
        )
    await categories_collection.delete_one({"_id": ObjectId(category_id)})
    return {"deleted": True}
