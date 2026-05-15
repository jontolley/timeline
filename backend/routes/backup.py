import csv
import io
import json
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import Response

from database import events_collection, people_collection

router = APIRouter(prefix="/api/backup")


def _iso(val):
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.isoformat()
    return val


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
    body = json.dumps(payload, indent=2, ensure_ascii=False)
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
