from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin
from database import users_collection
from models import UserCreate, UserUpdate

router = APIRouter(prefix="/api/users", dependencies=[Depends(require_admin)])


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


@router.get("")
async def list_users():
    cursor = users_collection.find().sort("email", 1)
    return [_serialize(doc) async for doc in cursor]


@router.post("")
async def invite_user(body: UserCreate):
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email")
    existing = await users_collection.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")
    now = datetime.now(timezone.utc)
    doc = {
        "email": email,
        "role": body.role.value if hasattr(body.role, "value") else body.role,
        "created_at": now,
        "updated_at": now,
    }
    result = await users_collection.insert_one(doc)
    created = await users_collection.find_one({"_id": result.inserted_id})
    return _serialize(created)


@router.put("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, admin=Depends(require_admin)):
    updates = body.model_dump(exclude_unset=True)
    if "role" in updates and updates["role"] is not None:
        role = updates["role"]
        updates["role"] = role.value if hasattr(role, "value") else role
    updates["updated_at"] = datetime.now(timezone.utc)

    target = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    # Prevent demoting the last admin — otherwise nobody could manage users.
    if (
        target.get("role") == "admin"
        and updates.get("role") == "user"
    ):
        admin_count = await users_collection.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last admin")

    await users_collection.update_one({"_id": ObjectId(user_id)}, {"$set": updates})
    updated = await users_collection.find_one({"_id": ObjectId(user_id)})
    return _serialize(updated)


@router.delete("/{user_id}")
async def delete_user(user_id: str, admin=Depends(require_admin)):
    target = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if str(target["_id"]) == str(admin["_id"]):
        raise HTTPException(status_code=400, detail="You can't delete yourself")
    if target.get("role") == "admin":
        admin_count = await users_collection.count_documents({"role": "admin"})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    await users_collection.delete_one({"_id": ObjectId(user_id)})
    return {"deleted": True}
