import csv
import io
import json
import zipfile
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response

from auth import require_auth
from database import events_collection, people_collection
from embeddings import EmbeddingService

router = APIRouter(prefix="/api/backup", dependencies=[Depends(require_auth)])
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
    convert at the document level (e.g. nested inside photos) still serializes
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
async def backup_json():
    people = [_serialize_person(p) async for p in people_collection.find().sort("name", 1)]
    events = [_serialize_event(e) async for e in events_collection.find().sort("date", 1)]
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


def _people_csv(people: list[dict]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["_id", "name", "color", "created_at", "updated_at"])
    for p in people:
        writer.writerow([
            p.get("_id", ""),
            p.get("name", ""),
            p.get("color", ""),
            p.get("created_at", "") or "",
            p.get("updated_at", "") or "",
        ])
    return buf.getvalue()


def _events_csv(events: list[dict], people_by_id: dict) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "_id", "title", "description", "event_type",
        "date", "end_date",
        "location_name", "location_address", "location_lat", "location_lng",
        "tags", "people_ids", "people_names",
        "created_at", "updated_at",
    ])
    for e in events:
        loc = e.get("location") or {}
        if not isinstance(loc, dict):
            loc = {}
        people_ids = e.get("people") or []
        people_names = [people_by_id.get(pid, {}).get("name", "") for pid in people_ids]
        writer.writerow([
            e.get("_id", ""),
            e.get("title", "") or "",
            e.get("description", "") or "",
            e.get("event_type", "") or "",
            e.get("date", "") or "",
            e.get("end_date", "") or "",
            loc.get("name") or "",
            loc.get("address") or "",
            loc.get("lat") if loc.get("lat") is not None else "",
            loc.get("lng") if loc.get("lng") is not None else "",
            "|".join(e.get("tags") or []),
            "|".join(people_ids),
            "|".join(n for n in people_names if n),
            e.get("created_at", "") or "",
            e.get("updated_at", "") or "",
        ])
    return buf.getvalue()


@router.get("/csv")
async def backup_csv():
    people = [_serialize_person(p) async for p in people_collection.find().sort("name", 1)]
    events = [_serialize_event(e) async for e in events_collection.find().sort("date", 1)]
    people_by_id = {p["_id"]: p for p in people}

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("people.csv", _people_csv(people))
        zf.writestr("events.csv", _events_csv(events, people_by_id))

    filename = f"timeline-backup-{_today()}.zip"
    return Response(
        content=zip_buf.getvalue(),
        media_type="application/zip",
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
    out = {
        "title": title,
        "description": e.get("description"),
        "event_type": event_type,
        "date": date_val,
        "end_date": _parse_iso(e.get("end_date")),
        "location": location,
        "tags": [str(t) for t in tags if t],
        "people": [str(p) for p in people if p],
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


def _row_to_event(row: dict) -> dict | None:
    name = (row.get("location_name") or "").strip()
    address = (row.get("location_address") or "").strip()
    lat = (row.get("location_lat") or "").strip()
    lng = (row.get("location_lng") or "").strip()
    location = None
    if name or address or lat or lng:
        location = {
            "name": name or None,
            "address": address or None,
            "lat": float(lat) if lat else None,
            "lng": float(lng) if lng else None,
        }
    tags = [t for t in (row.get("tags") or "").split("|") if t]
    people_ids = [p for p in (row.get("people_ids") or "").split("|") if p]
    return _normalize_event({
        "_id": row.get("_id"),
        "title": row.get("title"),
        "description": row.get("description") or None,
        "event_type": row.get("event_type"),
        "date": row.get("date") or None,
        "end_date": row.get("end_date") or None,
        "location": location,
        "tags": tags,
        "people": people_ids,
        "created_at": row.get("created_at") or None,
        "updated_at": row.get("updated_at") or None,
    })


def _parse_csv_zip(content: bytes) -> tuple[list[dict], list[dict]]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail=f"Invalid zip file: {exc}")
    names = zf.namelist()
    people: list[dict] = []
    events: list[dict] = []
    if "people.csv" in names:
        with zf.open("people.csv") as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8"))
            for row in reader:
                norm = _normalize_person({
                    "_id": row.get("_id"),
                    "name": row.get("name"),
                    "color": row.get("color"),
                    "created_at": row.get("created_at") or None,
                    "updated_at": row.get("updated_at") or None,
                })
                if norm:
                    people.append(norm)
    if "events.csv" in names:
        with zf.open("events.csv") as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8"))
            for row in reader:
                norm = _row_to_event(row)
                if norm:
                    events.append(norm)
    return people, events


def _serialize_event_for_index(doc: dict) -> dict:
    """Match the shape the embedding service expects (string _id, ISO dates)."""
    out = dict(doc)
    out["_id"] = str(out["_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        out[field] = _iso(out.get(field))
    return out


@router.post("/restore")
async def restore(file: UploadFile = File(...)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    filename = (file.filename or "").lower()
    is_zip = filename.endswith(".zip") or content[:2] == b"PK"
    if is_zip:
        people_docs, event_docs = _parse_csv_zip(content)
    else:
        people_docs, event_docs = _parse_json_payload(content)

    # Replace data: drop both collections, insert from backup.
    await people_collection.delete_many({})
    await events_collection.delete_many({})
    if people_docs:
        await people_collection.insert_many(people_docs)
    if event_docs:
        await events_collection.insert_many(event_docs)

    # Rebuild Qdrant from scratch.
    await embedding_service.reset_collection()
    indexed = 0
    async for doc in events_collection.find():
        try:
            await embedding_service.upsert_event(_serialize_event_for_index(doc))
            indexed += 1
        except Exception:
            # Skip indexing failures so a partial Ollama outage doesn't block restore.
            pass

    return {
        "people_restored": len(people_docs),
        "events_restored": len(event_docs),
        "events_indexed": indexed,
        "format": "zip" if is_zip else "json",
    }
