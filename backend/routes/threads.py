from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from auth import require_auth
from database import (
    events_collection,
    thread_subscriptions_collection,
    threads_collection,
    users_collection,
)
from models import ThreadCreate, ThreadUpdate

router = APIRouter(prefix="/api/threads")

ALLOWED_COLORS = {
    "blue", "emerald", "violet", "amber", "rose",
    "cyan", "fuchsia", "lime", "orange", "slate",
}
ALLOWED_VISIBILITY = {"private", "shared"}


def _serialize_thread(doc: dict, *, viewer_id, subscription=None, owner_email=None) -> dict:
    out = dict(doc)
    out["_id"] = str(out["_id"])
    out["is_owner"] = doc.get("owner_id") == viewer_id
    out["owner_id"] = str(doc.get("owner_id")) if doc.get("owner_id") else None
    if owner_email:
        out["owner_email"] = owner_email
    for field in ("created_at", "updated_at"):
        val = out.get(field)
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            out[field] = val.isoformat()
    if subscription is not None:
        out["subscription"] = {
            "_id": str(subscription["_id"]),
            "visible": bool(subscription.get("visible", True)),
        }
    return out


def _validate_color(color: str):
    if color not in ALLOWED_COLORS:
        raise HTTPException(
            status_code=400,
            detail=f"color must be one of {sorted(ALLOWED_COLORS)}",
        )


@router.get("")
async def list_threads(user: dict = Depends(require_auth)):
    """Threads visible to the current user — both ones they own and ones
    they're subscribed to. Subscribed threads carry a `subscription` object
    so the UI can show the visible toggle. Owned threads carry a
    `subscriber_count` so the Settings page can render the accordion
    trigger without an extra round trip."""
    viewer_id = user["_id"]

    # Owned threads + per-thread subscriber counts (aggregate in one call).
    own_threads: list = []
    own_thread_docs = [t async for t in threads_collection.find(
        {"owner_id": viewer_id}
    ).sort("created_at", 1)]
    sub_counts: dict = {}
    if own_thread_docs:
        own_thread_ids = [t["_id"] for t in own_thread_docs]
        async for grp in thread_subscriptions_collection.aggregate([
            {"$match": {"thread_id": {"$in": own_thread_ids}}},
            {"$group": {"_id": "$thread_id", "n": {"$sum": 1}}},
        ]):
            sub_counts[grp["_id"]] = grp["n"]
    for doc in own_thread_docs:
        entry = _serialize_thread(doc, viewer_id=viewer_id)
        entry["subscriber_count"] = sub_counts.get(doc["_id"], 0)
        own_threads.append(entry)

    # Subscribed threads — join with thread doc + owner email.
    subscribed: list = []
    sub_cursor = thread_subscriptions_collection.find({"subscriber_user_id": viewer_id})
    sub_docs = [s async for s in sub_cursor]
    if sub_docs:
        thread_ids = [s["thread_id"] for s in sub_docs]
        threads_by_id = {}
        async for t in threads_collection.find({"_id": {"$in": thread_ids}}):
            threads_by_id[t["_id"]] = t
        owner_ids = {t["owner_id"] for t in threads_by_id.values()}
        owners_by_id = {}
        async for u in users_collection.find({"_id": {"$in": list(owner_ids)}}):
            owners_by_id[u["_id"]] = u.get("email")
        for s in sub_docs:
            t = threads_by_id.get(s["thread_id"])
            if not t:
                continue  # orphaned subscription — thread was deleted
            subscribed.append(_serialize_thread(
                t,
                viewer_id=viewer_id,
                subscription=s,
                owner_email=owners_by_id.get(t["owner_id"]),
            ))

    return own_threads + subscribed


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
    return _serialize_thread(created, viewer_id=user["_id"])


@router.put("/{thread_id}")
async def update_thread(thread_id: str, patch: ThreadUpdate, user: dict = Depends(require_auth)):
    target = await threads_collection.find_one(
        {"_id": ObjectId(thread_id), "owner_id": user["_id"]}
    )
    if not target:
        raise HTTPException(status_code=404, detail="Thread not found")

    updates = patch.model_dump(exclude_unset=True)
    if "color" in updates:
        _validate_color(updates["color"])
    if "name" in updates:
        name = (updates["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be blank")
        updates["name"] = name
    new_visibility = None
    if "visibility" in updates and updates["visibility"] is not None:
        vis = updates["visibility"]
        vis = vis.value if hasattr(vis, "value") else vis
        if vis not in ALLOWED_VISIBILITY:
            raise HTTPException(status_code=400, detail="invalid visibility")
        updates["visibility"] = vis
        new_visibility = vis
    updates["updated_at"] = datetime.now(timezone.utc)
    await threads_collection.update_one(
        {"_id": ObjectId(thread_id)}, {"$set": updates}
    )

    # If the owner toggled the thread back to private, wipe any existing
    # subscriptions so subscribers lose access immediately.
    if new_visibility == "private" and target.get("visibility") == "shared":
        await thread_subscriptions_collection.delete_many(
            {"thread_id": ObjectId(thread_id)}
        )

    updated = await threads_collection.find_one({"_id": ObjectId(thread_id)})
    return _serialize_thread(updated, viewer_id=user["_id"])


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str, user: dict = Depends(require_auth)):
    doc = await threads_collection.find_one(
        {"_id": ObjectId(thread_id), "owner_id": user["_id"]}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Thread not found")
    in_use = await events_collection.count_documents(
        {"thread_id": doc["_id"], "owner_id": user["_id"]}
    )
    if in_use:
        raise HTTPException(
            status_code=409,
            detail=f"{in_use} event(s) still belong to this thread — move them first",
        )
    remaining = await threads_collection.count_documents({"owner_id": user["_id"]})
    if remaining <= 1:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete your only thread — create another first",
        )
    # Cascade subscriptions for this thread.
    await thread_subscriptions_collection.delete_many(
        {"thread_id": ObjectId(thread_id)}
    )
    await threads_collection.delete_one({"_id": ObjectId(thread_id)})
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Subscription flow — owners invite, subscribers toggle / unsubscribe.
# ---------------------------------------------------------------------------


class InviteRequest(BaseModel):
    email: EmailStr


@router.post("/{thread_id}/invite")
async def invite_to_thread(
    thread_id: str, body: InviteRequest, user: dict = Depends(require_auth)
):
    target = await threads_collection.find_one(
        {"_id": ObjectId(thread_id), "owner_id": user["_id"]}
    )
    if not target:
        raise HTTPException(status_code=404, detail="Thread not found")
    if target.get("visibility") != "shared":
        raise HTTPException(
            status_code=400,
            detail="Thread is private — mark it as shared before inviting",
        )
    invitee = await users_collection.find_one({"email": body.email.lower()})
    if not invitee:
        raise HTTPException(
            status_code=404,
            detail="That email isn't a registered user yet — add them under Users first",
        )
    if invitee["_id"] == user["_id"]:
        raise HTTPException(status_code=400, detail="You already see your own thread")
    existing = await thread_subscriptions_collection.find_one({
        "thread_id": target["_id"],
        "subscriber_user_id": invitee["_id"],
    })
    if existing:
        raise HTTPException(status_code=409, detail="Already shared with this user")
    now = datetime.now(timezone.utc)
    await thread_subscriptions_collection.insert_one({
        "thread_id": target["_id"],
        "subscriber_user_id": invitee["_id"],
        "owner_id": target["owner_id"],
        "visible": True,
        "created_at": now,
        "updated_at": now,
    })
    return {"ok": True, "email": invitee["email"]}


@router.get("/{thread_id}/subscribers")
async def list_subscribers(thread_id: str, user: dict = Depends(require_auth)):
    """Owner-only — list users this thread is shared with."""
    target = await threads_collection.find_one(
        {"_id": ObjectId(thread_id), "owner_id": user["_id"]}
    )
    if not target:
        raise HTTPException(status_code=404, detail="Thread not found")
    sub_cursor = thread_subscriptions_collection.find({"thread_id": ObjectId(thread_id)})
    subs = [s async for s in sub_cursor]
    if not subs:
        return []
    ids = [s["subscriber_user_id"] for s in subs]
    users_by_id = {}
    async for u in users_collection.find({"_id": {"$in": ids}}, {"_id": 1, "email": 1}):
        users_by_id[u["_id"]] = u["email"]
    return [
        {
            "_id": str(s["_id"]),
            "subscriber_user_id": str(s["subscriber_user_id"]),
            "subscriber_email": users_by_id.get(s["subscriber_user_id"], "(unknown)"),
            "visible": s.get("visible", True),
        }
        for s in subs
    ]


@router.delete("/{thread_id}/subscribers/{subscriber_user_id}")
async def revoke_subscription(
    thread_id: str, subscriber_user_id: str, user: dict = Depends(require_auth)
):
    """Owner removes a subscriber from a thread."""
    target = await threads_collection.find_one(
        {"_id": ObjectId(thread_id), "owner_id": user["_id"]}
    )
    if not target:
        raise HTTPException(status_code=404, detail="Thread not found")
    result = await thread_subscriptions_collection.delete_one({
        "thread_id": ObjectId(thread_id),
        "subscriber_user_id": ObjectId(subscriber_user_id),
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"revoked": True}


class SubscriptionPatch(BaseModel):
    visible: bool


# Subscriptions a viewer holds — used to toggle visibility / unsubscribe.

subs_router = APIRouter(prefix="/api/subscriptions")


@subs_router.put("/{subscription_id}")
async def toggle_subscription_visibility(
    subscription_id: str,
    body: SubscriptionPatch,
    user: dict = Depends(require_auth),
):
    """Subscriber toggles a shared thread on/off for their own timeline view."""
    result = await thread_subscriptions_collection.update_one(
        {"_id": ObjectId(subscription_id), "subscriber_user_id": user["_id"]},
        {"$set": {"visible": body.visible, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"visible": body.visible}


@subs_router.delete("/{subscription_id}")
async def unsubscribe(subscription_id: str, user: dict = Depends(require_auth)):
    result = await thread_subscriptions_collection.delete_one(
        {"_id": ObjectId(subscription_id), "subscriber_user_id": user["_id"]},
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"unsubscribed": True}
