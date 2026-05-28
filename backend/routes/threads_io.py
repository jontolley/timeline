"""Per-thread export / import.

Replaces the previous `/api/backup` endpoints, which wiped+restored the
caller's entire timeline. The new flow is scoped to a single thread:

  GET  /api/threads/{thread_id}/export  →  JSON download (thread + its events + referenced people)
  POST /api/threads/import              →  multipart {file, thread_name}; creates a NEW thread

Import is additive — never destructive. People are deduped against the
importer's existing people by lowercased name; missing ones are created.
Media keys are preserved as-is (no R2 copy), which is fine for the typical
single-user export-then-re-import case.
"""

import json
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from auth import require_auth
from database import (
    events_collection,
    people_collection,
    threads_collection,
)
from embeddings import EmbeddingService

router = APIRouter(prefix="/api/threads")
embedding_service = EmbeddingService()

ALLOWED_COLORS = {
    "blue", "emerald", "violet", "amber", "rose",
    "cyan", "fuchsia", "lime", "orange", "slate",
}
_VALID_KINDS = {"photo", "video", "audio"}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------


def _iso(val):
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.isoformat()
    return val


def _json_default(o):
    if isinstance(o, datetime):
        return _iso(o)
    if isinstance(o, ObjectId):
        return str(o)
    raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")


def _serialize_thread(doc: dict) -> dict:
    out = dict(doc)
    out["_id"] = str(out["_id"])
    out.pop("owner_id", None)
    for field in ("created_at", "updated_at"):
        out[field] = _iso(out.get(field))
    return out


def _serialize_event(doc: dict) -> dict:
    out = dict(doc)
    out["_id"] = str(out["_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        out[field] = _iso(out.get(field))
    loc = out.get("location")
    if isinstance(loc, str):
        out["location"] = {"name": loc, "address": None, "lat": None, "lng": None}
    if out.get("people") is None:
        out["people"] = []
    if out.get("tags") is None:
        out["tags"] = []
    # Internal fields the importer recreates per-thread / per-owner.
    out.pop("owner_id", None)
    out.pop("thread_id", None)
    return out


def _serialize_person(doc: dict) -> dict:
    out = dict(doc)
    out["_id"] = str(out["_id"])
    for field in ("created_at", "updated_at"):
        out[field] = _iso(out.get(field))
    out.pop("owner_id", None)
    return out


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _filename_slug(name: str) -> str:
    cleaned = "".join(c if c.isalnum() else "-" for c in (name or "").lower())
    cleaned = cleaned.strip("-")
    return (cleaned[:48] or "thread")


@router.get("/{thread_id}/export")
async def export_thread(thread_id: str, user: dict = Depends(require_auth)):
    """Download a single owned thread along with its events and the people
    those events reference. Owner-only — shared subscribers can't export."""
    try:
        thread_oid = ObjectId(thread_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid thread_id")

    thread = await threads_collection.find_one(
        {"_id": thread_oid, "owner_id": user["_id"]}
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    events = [
        e async for e in events_collection.find(
            {"thread_id": thread_oid, "owner_id": user["_id"]}
        ).sort("date", 1)
    ]

    referenced_ids: set[str] = set()
    for e in events:
        for pid in (e.get("people") or []):
            if isinstance(pid, str):
                referenced_ids.add(pid)
    people_docs: list = []
    if referenced_ids:
        try:
            oids = [ObjectId(pid) for pid in referenced_ids]
        except Exception:
            oids = []
        if oids:
            people_docs = [
                p async for p in people_collection.find(
                    {"_id": {"$in": oids}, "owner_id": user["_id"]}
                ).sort("name", 1)
            ]

    payload = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "version": 2,
        "thread": _serialize_thread(thread),
        "people": [_serialize_person(p) for p in people_docs],
        "events": [_serialize_event(e) for e in events],
    }
    body = json.dumps(payload, indent=2, ensure_ascii=False, default=_json_default)
    filename = f"thread-{_filename_slug(thread['name'])}-{_today()}.json"
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Import
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
    date_val = _parse_iso(e.get("date"))
    if not title or date_val is None:
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
    raw_media = e.get("media")
    if not isinstance(raw_media, list):
        raw_media = e.get("photos") or []
    if not isinstance(raw_media, list):
        raw_media = []
    media = [m for m in (_normalize_media(m) for m in raw_media if isinstance(m, dict)) if m]
    return {
        "title": title,
        "description": e.get("description"),
        "date": date_val,
        "end_date": _parse_iso(e.get("end_date")),
        "location": location,
        "tags": [str(t) for t in tags if t],
        "people": [str(p) for p in people if p],
        "media": media,
        "created_at": _parse_iso(e.get("created_at")) or now,
        "updated_at": _parse_iso(e.get("updated_at")) or now,
    }


def _serialize_event_for_index(doc: dict) -> dict:
    """Shape the embedding service expects (string _id + thread_id, ISO dates)."""
    out = dict(doc)
    out["_id"] = str(out["_id"])
    if out.get("thread_id") is not None:
        out["thread_id"] = str(out["thread_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        out[field] = _iso(out.get(field))
    return out


@router.post("/import")
async def import_thread(
    file: UploadFile = File(...),
    thread_name: str = Form(...),
    user: dict = Depends(require_auth),
):
    """Create a brand-new thread named `thread_name` and load every event
    from the uploaded export JSON into it. Existing data is untouched.

    People are deduped against the importer's existing people by lowercased
    name — same-name people are reused, novel ones are created. Media keys
    are preserved as-is; no R2 copy happens, so cross-account imports will
    share storage with the original."""
    name = (thread_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="thread_name is required")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Export must be a JSON object")

    raw_events = payload.get("events") or []
    raw_people = payload.get("people") or []
    if not isinstance(raw_events, list) or not isinstance(raw_people, list):
        raise HTTPException(status_code=400, detail="events and people must be arrays")

    src_thread = payload.get("thread") if isinstance(payload.get("thread"), dict) else {}
    color = src_thread.get("color") or "slate"
    if color not in ALLOWED_COLORS:
        color = "slate"

    owner_id = user["_id"]
    now = datetime.now(timezone.utc)

    # 1) Create the new thread (always private; user can flip to shared later).
    thread_doc = {
        "owner_id": owner_id,
        "name": name,
        "color": color,
        "visibility": "private",
        "created_at": now,
        "updated_at": now,
    }
    thread_result = await threads_collection.insert_one(thread_doc)
    new_thread_id = thread_result.inserted_id

    # 2) Resolve people: dedupe by lowercased name against importer's existing
    # set. Build src_person_id -> new_person_id map for event remapping.
    existing_people: dict = {}
    async for p in people_collection.find({"owner_id": owner_id}):
        existing_people[(p.get("name") or "").strip().lower()] = p
    person_id_map: dict[str, str] = {}
    people_created = 0
    for p in raw_people:
        if not isinstance(p, dict):
            continue
        src_id = p.get("_id")
        name_val = (p.get("name") or "").strip()
        if not name_val or not isinstance(src_id, str):
            continue
        key = name_val.lower()
        if key in existing_people:
            person_id_map[src_id] = str(existing_people[key]["_id"])
            continue
        color_val = p.get("color") or "slate"
        if color_val not in ALLOWED_COLORS:
            color_val = "slate"
        new_person = {
            "owner_id": owner_id,
            "name": name_val,
            "color": color_val,
            "created_at": _parse_iso(p.get("created_at")) or now,
            "updated_at": _parse_iso(p.get("updated_at")) or now,
        }
        inserted = await people_collection.insert_one(new_person)
        person_id_map[src_id] = str(inserted.inserted_id)
        existing_people[key] = {**new_person, "_id": inserted.inserted_id}
        people_created += 1

    # 3) Normalize + insert events, remapping people IDs and stamping the new
    # thread + owner.
    event_docs = []
    skipped = 0
    for e in raw_events:
        if not isinstance(e, dict):
            skipped += 1
            continue
        normalized = _normalize_event(e)
        if normalized is None:
            skipped += 1
            continue
        normalized["people"] = [
            person_id_map[pid] for pid in normalized["people"] if pid in person_id_map
        ]
        normalized["owner_id"] = owner_id
        normalized["thread_id"] = new_thread_id
        event_docs.append(normalized)

    if event_docs:
        await events_collection.insert_many(event_docs)

    # 4) Index the new events in Qdrant so chat semantic search reaches them.
    indexed = 0
    if event_docs:
        async for doc in events_collection.find({
            "owner_id": owner_id,
            "thread_id": new_thread_id,
        }):
            try:
                await embedding_service.upsert_event(
                    _serialize_event_for_index(doc), owner_id=str(owner_id),
                )
                indexed += 1
            except Exception:
                pass

    return {
        "thread_id": str(new_thread_id),
        "thread_name": name,
        "events_imported": len(event_docs),
        "events_skipped": skipped,
        "people_added": people_created,
        "events_indexed": indexed,
    }
