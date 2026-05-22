import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import ExifTags, Image
from pillow_heif import register_heif_opener
from pydantic import BaseModel

from auth import require_auth
from storage import (
    ALLOWED_IMAGE_TYPES,
    EXT_FOR_TYPE,
    is_configured,
    presign_put,
)

register_heif_opener()

router = APIRouter(prefix="/api/uploads", dependencies=[Depends(require_auth)])

_TAG_BY_NAME = {v: k for k, v in ExifTags.TAGS.items()}
_DATETIME_ORIGINAL = _TAG_BY_NAME.get("DateTimeOriginal", 36867)
_DATETIME = _TAG_BY_NAME.get("DateTime", 306)
_GPS_INFO = _TAG_BY_NAME.get("GPSInfo", 34853)


class PresignRequest(BaseModel):
    content_type: str


@router.post("/presign")
async def presign(req: PresignRequest):
    if not is_configured():
        raise HTTPException(status_code=503, detail="Storage backend not configured")
    if req.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported content type: {req.content_type}",
        )
    ext = EXT_FOR_TYPE[req.content_type]
    key = f"events/{uuid.uuid4()}.{ext}"
    url = await presign_put(key, req.content_type)
    return {"upload_url": url, "key": key}


def _dms_to_degrees(dms, ref):
    d, m, s = (float(x) for x in dms)
    val = d + m / 60 + s / 3600
    if ref in ("S", "W"):
        val = -val
    return val


def _parse_exif_datetime(raw):
    # EXIF format: "YYYY:MM:DD HH:MM:SS". Treat as naive local time.
    try:
        return datetime.strptime(raw, "%Y:%m:%d %H:%M:%S")
    except (TypeError, ValueError):
        return None


@router.post("/extract-exif")
async def extract_exif(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        img = Image.open(io.BytesIO(raw))
        exif = img.getexif()
    except Exception:
        return {"has_exif": False}

    out = {"has_exif": False}

    dt_raw = exif.get(_DATETIME_ORIGINAL) or exif.get(_DATETIME)
    dt = _parse_exif_datetime(dt_raw) if dt_raw else None
    if dt is not None:
        # Express as UTC so the frontend's existing UTC-ISO assumption holds.
        dt_utc = dt.replace(tzinfo=timezone.utc)
        out["date"] = dt_utc.date().isoformat()
        out["time"] = dt_utc.strftime("%H:%M")
        out["has_exif"] = True

    try:
        gps = exif.get_ifd(_GPS_INFO) if _GPS_INFO in exif else {}
    except Exception:
        gps = {}
    if gps and 2 in gps and 4 in gps:
        try:
            out["lat"] = _dms_to_degrees(gps[2], gps.get(1, "N"))
            out["lng"] = _dms_to_degrees(gps[4], gps.get(3, "E"))
            out["has_exif"] = True
        except Exception:
            pass

    return out
