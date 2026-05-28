import asyncio
import uuid
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth import ALLOWED_EMAILS
from database import (
    auth_codes_collection,
    db,
    events_collection,
    people_collection,
    threads_collection,
    users_collection,
)
from embeddings import EmbeddingService, COLLECTION_NAME
from routes.events import router as events_router
from routes.chat import router as chat_router
from routes.people import router as people_router
from routes.threads import router as threads_router, subs_router as subscriptions_router
from routes.users import router as users_router
from routes.threads_io import router as threads_io_router
from routes.uploads import router as uploads_router
from routes.auth import router as auth_router

embedding_service = EmbeddingService()


def _serialize_doc(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
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
    return doc


async def _seed_default_thread_for(owner_id):
    """Ensure the user has at least one thread. Creates 'My Timeline' as a
    default if they have none. Returns the user's oldest thread either way."""
    existing = await threads_collection.find_one(
        {"owner_id": owner_id}, sort=[("created_at", 1)]
    )
    if existing:
        return existing
    now = datetime.now(timezone.utc)
    doc = {
        "owner_id": owner_id,
        "name": "My Timeline",
        "color": "slate",
        "visibility": "private",
        "created_at": now,
        "updated_at": now,
    }
    result = await threads_collection.insert_one(doc)
    print(f"[startup] Seeded default thread for {owner_id}")
    return await threads_collection.find_one({"_id": result.inserted_id})


async def _backfill_qdrant_thread_id():
    """One-shot: ensure every Qdrant point's payload has `thread_id` so
    chat semantic search can filter by visible threads. Uses set_payload —
    no re-embedding required, so this completes in a fraction of the time
    of a full re-index. Idempotent: checks the first point and bails if it
    already has the field."""
    try:
        scroll = await embedding_service.qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=1,
            with_payload=True,
        )
        first = scroll[0]
        if first and (first[0].payload or {}).get("thread_id"):
            return  # migration already ran
    except Exception:
        return

    print("[startup] Backfilling thread_id on existing Qdrant points")
    updated = 0
    async for doc in events_collection.find(
        {"thread_id": {"$exists": True}}, {"_id": 1, "thread_id": 1}
    ):
        point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, str(doc["_id"])))
        try:
            await embedding_service.qdrant.set_payload(
                collection_name=COLLECTION_NAME,
                payload={"thread_id": str(doc["thread_id"])},
                points=[point_id],
            )
            updated += 1
        except Exception:
            pass
    if updated:
        print(f"[startup] Backfilled thread_id on {updated} Qdrant point(s)")


async def _backfill_event_threads():
    """For every user, ensure their events all have a thread_id pointing at a
    thread they own. Events without one get stamped with the user's oldest
    thread (creating 'My Timeline' for them if necessary). Idempotent."""
    async for user in users_collection.find():
        owner_id = user["_id"]
        # Only do anything if this user has events that lack thread_id.
        needs = await events_collection.count_documents(
            {"owner_id": owner_id, "thread_id": {"$exists": False}}
        )
        if needs == 0:
            continue
        default_thread = await _seed_default_thread_for(owner_id)
        result = await events_collection.update_many(
            {"owner_id": owner_id, "thread_id": {"$exists": False}},
            {"$set": {"thread_id": default_thread["_id"]}},
        )
        if result.modified_count:
            print(
                f"[startup] Stamped {result.modified_count} event(s) with default thread for {user['email']}"
            )


async def _multiuser_migration():
    """Multi-user bootstrap, run on every startup but only acts on first
    encounter:
      1. Ensure a user record exists for every email in ALLOWED_EMAILS.
         The first allowed email is the admin; later ones are normal users.
      2. Find any events / people without an owner_id and backfill them
         with the admin user's id.
      3. Re-index those events in Qdrant so the owner_id ends up in the
         vector-search payload.
    """
    now = datetime.now(timezone.utc)

    # Step 1: seed users from the env allowlist. Idempotent via unique-email.
    allowed = sorted(ALLOWED_EMAILS)
    if not allowed:
        # No allowlist — nothing to seed. Multi-user features just don't work
        # until at least one user exists.
        return

    admin_email = allowed[0]
    for i, email in enumerate(allowed):
        existing = await users_collection.find_one({"email": email})
        if existing:
            continue
        await users_collection.insert_one({
            "email": email,
            "role": "admin" if i == 0 else "user",
            "created_at": now,
            "updated_at": now,
        })
        print(f"[startup] Seeded {'admin' if i == 0 else 'user'} {email}")

    admin = await users_collection.find_one({"email": admin_email})
    if not admin:
        print("[startup] WARNING: failed to seed admin user")
        return
    admin_id = admin["_id"]

    # Step 2: backfill owner_id on any pre-multi-user docs.
    for collection, label in (
        (events_collection, "events"),
        (people_collection, "people"),
    ):
        result = await collection.update_many(
            {"owner_id": {"$exists": False}},
            {"$set": {"owner_id": admin_id, "updated_at": now}},
        )
        if result.modified_count:
            print(f"[startup] Backfilled owner_id on {result.modified_count} {label}")

    # Step 3: re-index every event into Qdrant so the owner_id payload
    # reaches search. Only does work for points that haven't been re-indexed
    # under the new schema (we detect by point absence of owner_id payload).
    # Simpler heuristic: check if any point has owner_id in its payload; if
    # not, we assume the migration hasn't run yet.
    try:
        scroll_result = await embedding_service.qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=1,
            with_payload=True,
            with_vectors=False,
        )
        first = scroll_result[0]
        needs_reindex = bool(first) and not (first[0].payload or {}).get("owner_id")
    except Exception:
        needs_reindex = False

    if needs_reindex:
        print("[startup] Re-indexing events in Qdrant with owner_id payload")
        reindexed = 0
        async for doc in events_collection.find():
            try:
                await embedding_service.upsert_event(
                    _serialize_doc(doc),
                    owner_id=str(doc.get("owner_id") or admin_id),
                )
                reindexed += 1
            except Exception as exc:
                print(f"[startup] Re-index failed for {doc.get('_id')}: {exc}")
        print(f"[startup] Re-indexed {reindexed} event(s)")


async def _drop_event_type_and_categories():
    """One-shot: strip the `event_type` field from every event, drop the
    `categories` collection, and re-embed every event in Qdrant so the
    stored vectors no longer carry the category word baked into their text.
    Idempotent: each step only acts if there's anything left to do."""
    unset_result = await events_collection.update_many(
        {"event_type": {"$exists": True}},
        {"$unset": {"event_type": ""}},
    )
    if unset_result.modified_count:
        print(f"[startup] Unset event_type on {unset_result.modified_count} event(s)")

    # `db.drop_collection` is a no-op when the collection doesn't exist.
    collection_names = await db.list_collection_names()
    if "categories" in collection_names:
        await db.drop_collection("categories")
        print("[startup] Dropped legacy `categories` collection")

    # Re-embed every event so the stored vector no longer encodes the now-
    # removed category word. Tracked via a one-shot doc in a tiny `meta`
    # collection so we don't re-embed on every boot.
    meta = db.meta
    flag = await meta.find_one({"key": "reembed_after_category_removal"})
    if flag:
        return
    reembedded = 0
    failed = 0
    async for doc in events_collection.find():
        try:
            await embedding_service.upsert_event(
                _serialize_doc(doc),
                owner_id=str(doc.get("owner_id")) if doc.get("owner_id") else None,
            )
            reembedded += 1
        except Exception as exc:
            failed += 1
            print(f"[startup] Re-embed failed for {doc.get('_id')}: {exc}")
    print(f"[startup] Re-embedded {reembedded} event(s) without category text ({failed} failed)")
    # Only flip the flag when every event succeeded — otherwise a partial run
    # would block the next boot from retrying.
    if failed == 0:
        await meta.insert_one({
            "key": "reembed_after_category_removal",
            "completed_at": datetime.now(timezone.utc),
        })


async def _migrate_photos_to_media():
    """One-shot rename of `photos[]` → `media[]` with each entry tagged
    kind:"photo". Idempotent: only acts on docs that have `photos` and no
    `media`. Safe to run on startup of every process."""
    cursor = events_collection.find(
        {"photos": {"$exists": True}, "media": {"$exists": False}},
        projection={"_id": 1, "photos": 1},
    )
    migrated = 0
    async for doc in cursor:
        photos = doc.get("photos") or []
        media = []
        for p in photos:
            if isinstance(p, dict):
                item = dict(p)
                item.setdefault("kind", "photo")
                media.append(item)
        await events_collection.update_one(
            {"_id": doc["_id"]},
            {"$set": {"media": media}, "$unset": {"photos": ""}},
        )
        migrated += 1
    if migrated:
        print(f"[startup] Migrated {migrated} event(s) photos→media")


async def _ensure_auth_indexes():
    """TTL index so expired login codes self-delete; unique index on email so concurrent request-code calls can't create duplicates."""
    existing = await auth_codes_collection.index_information()
    if "auth_codes_ttl" not in existing:
        await auth_codes_collection.create_index(
            "expires_at",
            expireAfterSeconds=0,
            name="auth_codes_ttl",
        )
    if "auth_codes_email_unique" not in existing:
        await auth_codes_collection.create_index(
            "email", unique=True, name="auth_codes_email_unique"
        )


async def _ensure_text_index():
    """Create the Mongo full-text index used by the chat keyword search if it
    doesn't already exist. Field weights make title hits dominate, then tags,
    then location, with description as the lowest-priority haystack."""
    existing = await events_collection.index_information()
    if "events_text_search" in existing:
        return
    await events_collection.create_index(
        [
            ("title", "text"),
            ("tags", "text"),
            ("location.name", "text"),
            ("location.address", "text"),
            ("description", "text"),
        ],
        weights={
            "title": 10,
            "tags": 5,
            "location.name": 3,
            "location.address": 3,
            "description": 1,
        },
        name="events_text_search",
        default_language="english",
    )


async def _background_startup():
    """Heavy startup work that runs *after* FastAPI is already serving
    requests. Everything here is idempotent — if the process is killed
    mid-run, the next boot picks up where it left off.

    Why this isn't in the synchronous lifespan: Fly auto-suspends idle
    machines, and Cloudflare's edge gives the origin ~100s before it
    returns a 524. Doing the Qdrant catch-up sync (~300ms per missing
    event) plus a Qdrant wake-up hop plus Atlas cold-connect *before*
    serving the first /api/auth/me used to push first-request latency
    past that ceiling. Moving these out means /me, /events, /people,
    etc. respond as soon as the Mongo connection is up — Qdrant-backed
    chat semantic search just misses any newly-created events until
    the catch-up loop here finishes (idempotent, runs every boot)."""
    try:
        await embedding_service.ensure_collection()
        await _migrate_photos_to_media()
        # Multi-user bootstrap: seeds users from ALLOWED_EMAILS, backfills
        # owner_id on legacy docs, and re-indexes Qdrant with owner_id payload.
        await _multiuser_migration()
        # Threads: seed one default thread per user + backfill thread_id on
        # any pre-Phase-2 events, then make sure existing Qdrant points
        # carry thread_id so chat search can filter on it.
        await _backfill_event_threads()
        await _backfill_qdrant_thread_id()
        # Drop categories entirely: $unset event_type on events, drop the
        # `categories` collection, and re-embed every event (one-time) so
        # the stored vector no longer encodes the now-removed category word.
        await _drop_event_type_and_categories()

        # Ensure every event has a Qdrant point. Useful after data restores.
        scroll_result = await embedding_service.qdrant.scroll(
            collection_name=COLLECTION_NAME,
            limit=10000,
            with_payload=False,
            with_vectors=False,
        )
        existing_ids = {str(p.id) for p in scroll_result[0]}
        async for doc in events_collection.find():
            doc_id = str(doc["_id"])
            point_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, doc_id))
            if point_id not in existing_ids:
                await embedding_service.upsert_event(
                    _serialize_doc(doc),
                    owner_id=str(doc.get("owner_id")) if doc.get("owner_id") else None,
                )
        print("[startup-bg] Background startup complete", flush=True)
    except Exception as exc:
        print(f"[startup-bg] Warning: {exc}", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fast path: only the Mongo index creations stay synchronous because
    # request handlers depend on those indexes existing (text search,
    # auth-code TTL). Everything else is deferred — see _background_startup.
    try:
        await _ensure_text_index()
        await _ensure_auth_indexes()
    except Exception as exc:
        print(f"[startup] Warning during index ensure: {exc}", flush=True)

    bg_task = asyncio.create_task(_background_startup())
    try:
        yield
    finally:
        # On shutdown, cancel the migrations if still running. They're
        # idempotent and the next process will re-run them.
        if not bg_task.done():
            bg_task.cancel()


app = FastAPI(lifespan=lifespan)

import os

_origins_env = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173",
)
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth_router)
app.include_router(events_router)
app.include_router(chat_router)
app.include_router(people_router)
app.include_router(threads_router)
app.include_router(subscriptions_router)
app.include_router(users_router)
app.include_router(threads_io_router)
app.include_router(uploads_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/stats/public")
async def public_stats():
    total = await events_collection.count_documents({})
    return {"event_count": total}
