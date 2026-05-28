from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from auth import require_admin, send_invitation
from database import (
    events_collection,
    people_collection,
    thread_subscriptions_collection,
    threads_collection,
    users_collection,
)
from embeddings import EmbeddingService, COLLECTION_NAME
from models import UserCreate, UserUpdate
import storage


async def _seed_new_user(user_id):
    """Idempotent seed of a fresh user's baseline data: one default thread
    ('My Timeline'). Called from invite_user so newly invited users can
    start using the app immediately, without waiting for the next backend
    startup."""
    now = datetime.now(timezone.utc)
    if await threads_collection.count_documents({"owner_id": user_id}) == 0:
        await threads_collection.insert_one({
            "owner_id": user_id,
            "name": "My Timeline",
            "color": "slate",
            "visibility": "private",
            "created_at": now,
            "updated_at": now,
        })

router = APIRouter(prefix="/api/users", dependencies=[Depends(require_admin)])
embedding_service = EmbeddingService()


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
async def invite_user(body: UserCreate, admin=Depends(require_admin)):
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
    # Seed the invitee with their default thread so they're not locked out
    # of creating events until the next backend restart.
    await _seed_new_user(created["_id"])
    # Send the welcome / sign-in email — best-effort. If Resend is down or the
    # address bounces, the user record still exists and the admin can resend
    # later by removing + re-inviting.
    try:
        await send_invitation(email, inviter_email=admin.get("email"))
    except Exception as exc:
        print(f"[users] Failed to send invitation to {email}: {exc}", flush=True)
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


async def _user_footprint(user_oid: ObjectId) -> dict:
    """Count of every resource owned by the user — used both for the
    pre-delete confirmation in the UI and for telemetry on cascade delete."""
    events = await events_collection.count_documents({"owner_id": user_oid})
    people = await people_collection.count_documents({"owner_id": user_oid})
    media = 0
    async for doc in events_collection.find(
        {"owner_id": user_oid}, {"media": 1}
    ):
        media += len(doc.get("media") or [])
    return {"events": events, "people": people, "media": media}


@router.get("/{user_id}/footprint")
async def user_footprint(user_id: str):
    target = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    counts = await _user_footprint(target["_id"])
    return {"email": target["email"], **counts}


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

    owner_id = target["_id"]
    counts = await _user_footprint(owner_id)

    # 1) Delete every R2 object referenced by this user's events.
    media_deleted = 0
    media_failed = 0
    if storage.is_configured():
        async for doc in events_collection.find(
            {"owner_id": owner_id}, {"media": 1}
        ):
            for m in doc.get("media") or []:
                for key in (m.get("key"), m.get("thumb_key")):
                    if not key:
                        continue
                    try:
                        await storage.delete_object(key)
                        media_deleted += 1
                    except Exception:
                        media_failed += 1

    # 2) Delete this user's Qdrant points by owner_id filter. Best-effort —
    # a Qdrant outage shouldn't block the Mongo + R2 cleanup.
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue, FilterSelector
        await embedding_service.qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=FilterSelector(filter=Filter(must=[
                FieldCondition(key="owner_id", match=MatchValue(value=str(owner_id))),
            ])),
        )
    except Exception as exc:
        print(f"[users] Qdrant cleanup failed for {target['email']}: {exc}", flush=True)

    # 3) Delete the Mongo docs owned by this user, plus any subscriptions
    # they hold OR that exist against their threads.
    await events_collection.delete_many({"owner_id": owner_id})
    await people_collection.delete_many({"owner_id": owner_id})
    await threads_collection.delete_many({"owner_id": owner_id})
    await thread_subscriptions_collection.delete_many({
        "$or": [
            {"owner_id": owner_id},          # subscriptions FOR their threads
            {"subscriber_user_id": owner_id}, # subscriptions HELD by them
        ],
    })

    # 4) Finally, delete the user record itself.
    await users_collection.delete_one({"_id": owner_id})

    return {
        "deleted": True,
        "email": target["email"],
        "events_deleted": counts["events"],
        "people_deleted": counts["people"],
        "media_deleted": media_deleted,
        "media_failed": media_failed,
    }
