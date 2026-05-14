import uuid
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import events_collection
from embeddings import EmbeddingService, COLLECTION_NAME
from routes.events import router as events_router
from routes.chat import router as chat_router

embedding_service = EmbeddingService()

SEED_EVENTS = [
    {
        "title": "Started first job as Software Engineer",
        "description": "Joined a startup in San Francisco as a junior software engineer, working on backend APIs.",
        "event_type": "career",
        "date": datetime(2018, 6, 1, tzinfo=timezone.utc),
        "location": {"name": "San Francisco, CA", "address": None, "lat": 37.7749, "lng": -122.4194},
        "tags": ["engineering", "startup"],
    },
    {
        "title": "Backpacking trip through Southeast Asia",
        "description": "Three-week adventure through Thailand, Vietnam, and Cambodia.",
        "event_type": "travel",
        "date": datetime(2019, 3, 15, tzinfo=timezone.utc),
        "location": {"name": "Southeast Asia", "address": "Thailand, Vietnam, Cambodia", "lat": None, "lng": None},
        "tags": ["backpacking", "adventure", "asia"],
    },
    {
        "title": "Promoted to Senior Engineer",
        "description": "Recognised for leading the migration to microservices architecture.",
        "event_type": "career",
        "date": datetime(2020, 9, 1, tzinfo=timezone.utc),
        "location": {"name": "San Francisco, CA", "address": None, "lat": 37.7749, "lng": -122.4194},
        "tags": ["promotion", "engineering"],
    },
    {
        "title": "Completed first marathon",
        "description": "Ran the Big Sur International Marathon after six months of training.",
        "event_type": "milestone",
        "date": datetime(2021, 4, 25, tzinfo=timezone.utc),
        "location": {"name": "Big Sur, CA", "address": None, "lat": 36.2704, "lng": -121.8081},
        "tags": ["running", "fitness", "personal"],
    },
    {
        "title": "Solo trip to Japan",
        "description": "Spent two weeks in Tokyo, Kyoto, and Osaka exploring culture, food, and temples.",
        "event_type": "travel",
        "date": datetime(2023, 10, 5, tzinfo=timezone.utc),
        "location": {"name": "Japan", "address": "Tokyo, Kyoto, and Osaka, Japan", "lat": 35.6762, "lng": 139.6503},
        "tags": ["japan", "solo", "culture"],
    },
]


def _serialize_doc(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    for field in ("date", "created_at", "updated_at"):
        val = doc.get(field)
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            doc[field] = val.isoformat()
    loc = doc.get("location")
    if isinstance(loc, str):
        doc["location"] = {"name": loc, "address": None, "lat": None, "lng": None}
    return doc


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await embedding_service.ensure_collection()

        count = await events_collection.count_documents({})
        if count == 0:
            now = datetime.now(timezone.utc)
            docs = [dict(e, created_at=now, updated_at=now) for e in SEED_EVENTS]
            result = await events_collection.insert_many(docs)
            async for doc in events_collection.find({"_id": {"$in": result.inserted_ids}}):
                await embedding_service.upsert_event(_serialize_doc(doc))
        else:
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
                    await embedding_service.upsert_event(_serialize_doc(doc))
    except Exception as exc:
        print(f"[startup] Warning: {exc}")

    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events_router)
app.include_router(chat_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
