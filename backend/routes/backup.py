import json
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from auth import require_auth
from database import events_collection, people_collection
from embeddings import EmbeddingService

router = APIRouter(prefix="/api/backup")
embedding_service = EmbeddingService()

ALLOWED_COLORS = {
    "blue", "emerald", "violet", "amber", "rose",
    "cyan", "fuchsia", "lime", "orange", "slate",
}


def _iso(val):
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.isoformat()
    return val


def _json_default(o):
    """Fallback encoder for json.dumps so any datetime / ObjectId we forgot to
    convert at the document level (e.g. nested inside media) still serializes
    cleanly instead of 500ing the whole backup."""
    if isinstance(o, datetime):
        return _iso(o)
    if isinstance(o, ObjectId):
        return str(o)
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")


def _serialize_event(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        doc[field] = _iso(doc.get(field))
    loc = doc.get("location")
    if isinstance(loc, str):
        doc["location"] = {"name": loc, "address": None, "lat": None, "lng": None}
    if doc.get("people") is None:
        doc["people"] = []
    if doc.get("tags") is None:
        doc["tags"] = []
    return doc


def _serialize_person(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    for field in ("created_at", "updated_at"):
        doc[field] = _iso(doc.get(field))
    return doc


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


@router.get("/json")
async def backup_json(user: dict = Depends(require_auth)):
    owner_filter = {"owner_id": user["_id"]}
    people = [
        _serialize_person(p)
        async for p in people_collection.find(owner_filter).sort("name", 1)
    ]
    events = [
        _serialize_event(e)
        async for e in events_collection.find(owner_filter).sort("date", 1)
    ]
    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": 1,
        "people": people,
        "events": events,
    }
    body = json.dumps(payload, indent=2, ensure_ascii=False, default=_json_default)
    filename = f"timeline-backup-{_today()}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Restore
# ---------------------------------------------------------------------------

def _parse_iso(val):
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val
    if isinstance(val, str) and val:
        try:
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None
    return None


def _to_object_id(val):
    if isinstance(val, ObjectId):
        return val
    if isinstance(val, str):
        try:
            return ObjectId(val)
        except Exception:
            return None
    return None


def _normalize_person(p: dict) -> dict | None:
    name = (p.get("name") or "").strip()
    if not name:
        return None
    color = p.get("color") or "slate"
    if color not in ALLOWED_COLORS:
        color = "slate"
    now = datetime.now(timezone.utc)
    out = {
        "name": name,
        "color": color,
        "created_at": _parse_iso(p.get("created_at")) or now,
        "updated_at": _parse_iso(p.get("updated_at")) or now,
    }
    oid = _to_object_id(p.get("_id"))
    if oid is not None:
        out["_id"] = oid
    return out


_VALID_KINDS = {"photo", "video", "audio"}


def _normalize_media(m: dict) -> dict | None:
    key = (m.get("key") or "").strip()
    content_type = (m.get("content_type") or "").strip()
    if not key or not content_type:
        return None
    kind = (m.get("kind") or "photo").strip()
    if kind not in _VALID_KINDS:
        kind = "photo"
    out: dict = {"kind": kind, "key": key, "content_type": content_type}
    thumb_key = (m.get("thumb_key") or "").strip()
    if thumb_key:
        out["thumb_key"] = thumb_key
    for dim in ("width", "height"):
        val = m.get(dim)
        if isinstance(val, int):
            out[dim] = val
        elif isinstance(val, str) and val.isdigit():
            out[dim] = int(val)
    duration = m.get("duration_seconds")
    if isinstance(duration, (int, float)):
        out["duration_seconds"] = float(duration)
    uploaded = _parse_iso(m.get("uploaded_at"))
    if uploaded is not None:
        out["uploaded_at"] = uploaded
    return out


def _normalize_event(e: dict) -> dict | None:
    title = (e.get("title") or "").strip()
    event_type = (e.get("event_type") or "").strip()
    date_val = _parse_iso(e.get("date"))
    if not title or not event_type or date_val is None:
        return None
    now = datetime.now(timezone.utc)
    location = e.get("location")
    if not isinstance(location, dict):
        location = None
    tags = e.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    people = e.get("people") or []
    if not isinstance(people, list):
        people = []
    # Prefer the new `media` field; fall back to legacy `photos` from older backups.
    raw_media = e.get("media")
    if not isinstance(raw_media, list):
        raw_media = e.get("photos") or []
    if not isinstance(raw_media, list):
        raw_media = []
    media = [m for m in (_normalize_media(m) for m in raw_media if isinstance(m, dict)) if m]
    out = {
        "title": title,
        "description": e.get("description"),
        "event_type": event_type,
        "date": date_val,
        "end_date": _parse_iso(e.get("end_date")),
        "location": location,
        "tags": [str(t) for t in tags if t],
        "people": [str(p) for p in people if p],
        "media": media,
        "created_at": _parse_iso(e.get("created_at")) or now,
        "updated_at": _parse_iso(e.get("updated_at")) or now,
    }
    oid = _to_object_id(e.get("_id"))
    if oid is not None:
        out["_id"] = oid
    return out


def _parse_json_payload(content: bytes) -> tuple[list[dict], list[dict]]:
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Backup must be a JSON object")
    raw_people = payload.get("people") or []
    raw_events = payload.get("events") or []
    if not isinstance(raw_people, list) or not isinstance(raw_events, list):
        raise HTTPException(status_code=400, detail="people and events must be arrays")
    people = [p for p in (_normalize_person(p) for p in raw_people if isinstance(p, dict)) if p]
    events = [e for e in (_normalize_event(e) for e in raw_events if isinstance(e, dict)) if e]
    return people, events


def _serialize_event_for_index(doc: dict) -> dict:
    """Match the shape the embedding service expects (string _id, ISO dates)."""
    out = dict(doc)
    out["_id"] = str(out["_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        out[field] = _iso(out.get(field))
    return out


@router.post("/restore")
async def restore(
    file: UploadFile = File(...),
    user: dict = Depends(require_auth),
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    people_docs, event_docs = _parse_json_payload(content)

    # Stamp the current user as the owner on every imported doc; their existing
    # data is wiped, but other users' data is left alone.
    owner_id = user["_id"]
    for doc in people_docs:
        doc["owner_id"] = owner_id
    for doc in event_docs:
        doc["owner_id"] = owner_id

    await people_collection.delete_many({"owner_id": owner_id})
    await events_collection.delete_many({"owner_id": owner_id})
    if people_docs:
        await people_collection.insert_many(people_docs)
    if event_docs:
        await events_collection.insert_many(event_docs)

    # Re-index only the restored events into Qdrant — leaving other users'
    # points untouched. Delete-by-filter then re-upsert.
    from qdrant_client.models import Filter, FieldCondition, MatchValue, FilterSelector
    try:
        await embedding_service.qdrant.delete(
            collection_name="timeline_events",
            points_selector=FilterSelector(filter=Filter(must=[
                FieldCondition(key="owner_id", match=MatchValue(value=str(owner_id))),
            ])),
        )
    except Exception:
        pass

    indexed = 0
    async for doc in events_collection.find({"owner_id": owner_id}):
        try:
            await embedding_service.upsert_event(
                _serialize_event_for_index(doc), owner_id=str(owner_id),
            )
            indexed += 1
        except Exception:
            # Skip indexing failures so a partial outage doesn't block restore.
            pass

    return {
        "people_restored": len(people_docs),
        "events_restored": len(event_docs),
        "events_indexed": indexed,
    }
