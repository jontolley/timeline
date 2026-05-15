import os
import uuid
import httpx
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
    PointIdsList,
)

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
COLLECTION_NAME = "timeline_events"
VECTOR_SIZE = 768


def _point_id(event_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, event_id))


class EmbeddingService:
    def __init__(self):
        self.qdrant = AsyncQdrantClient(url=QDRANT_URL)

    async def ensure_collection(self):
        collections = await self.qdrant.get_collections()
        names = [c.name for c in collections.collections]
        if COLLECTION_NAME not in names:
            await self.qdrant.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )

    async def embed(self, text: str) -> list[float]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": OLLAMA_EMBED_MODEL, "prompt": text},
            )
            resp.raise_for_status()
            return resp.json()["embedding"]

    async def upsert_event(self, event: dict):
        date = event.get("date", "")
        if hasattr(date, "isoformat"):
            date = date.isoformat()
        tags = ", ".join(event.get("tags") or [])
        loc = event.get("location") or {}
        if isinstance(loc, str):
            loc_text = loc
        elif isinstance(loc, dict):
            parts = [loc.get("name"), loc.get("address")]
            loc_text = ", ".join(p for p in parts if p)
            if loc.get("lat") is not None and loc.get("lng") is not None:
                loc_text += f" ({loc['lat']:.5f}, {loc['lng']:.5f})"
        else:
            loc_text = ""
        end_date = event.get("end_date", "")
        if hasattr(end_date, "isoformat"):
            end_date = end_date.isoformat()
        date_range = f"{date} to {end_date}" if end_date else date
        text = (
            f"{date_range} {event.get('event_type', '')}: {event.get('title', '')}. "
            f"{event.get('description', '')}. "
            f"Location: {loc_text}. Tags: {tags}"
        )
        vector = await self.embed(text)
        point_id = _point_id(str(event["_id"]))
        await self.qdrant.upsert(
            collection_name=COLLECTION_NAME,
            points=[PointStruct(id=point_id, vector=vector, payload=event)],
        )

    async def delete_event(self, event_id: str):
        point_id = _point_id(event_id)
        await self.qdrant.delete(
            collection_name=COLLECTION_NAME,
            points_selector=PointIdsList(points=[point_id]),
        )

    async def search(
        self,
        question: str,
        top_k: int = 5,
        event_type_filter: str = None,
    ) -> list[dict]:
        vector = await self.embed(question)
        query_filter = None
        if event_type_filter and event_type_filter != "all":
            query_filter = Filter(
                must=[
                    FieldCondition(
                        key="event_type",
                        match=MatchValue(value=event_type_filter),
                    )
                ]
            )
        result = await self.qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=vector,
            limit=top_k,
            query_filter=query_filter,
            with_payload=True,
        )
        return [r.payload for r in result.points]
