import base64
import io
import json
import os
import re
import uuid
from datetime import datetime, timezone

from anthropic import AsyncAnthropic
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

# Vision captioning uses Haiku for cost — the task is short captioning, not reasoning.
CAPTION_MODEL = os.getenv("ANTHROPIC_CAPTION_MODEL", "claude-haiku-4-5-20251001")
CAPTION_SYSTEM = (
    "You write short, warm captions for personal-timeline photos. "
    "Given a photo, respond with ONLY a JSON object: "
    '{"title": "...", "description": "..."}. '
    "Title: 4-7 words, capture the moment, no trailing punctuation. "
    "Description: 1-2 sentences that note who/what/where in a personal, "
    "album-caption voice (not clinical). If people are visible, describe "
    "them generically (no name guesses)."
)
_caption_client = AsyncAnthropic()


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


def _resize_for_vision(raw: bytes) -> tuple[bytes, str]:
    """Decode + downscale to ~1568px max dim and re-encode as JPEG. Anthropic
    resizes server-side anyway; doing it here keeps the upload to a few hundred
    KB regardless of source size, which speeds the API call."""
    img = Image.open(io.BytesIO(raw))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    longest = max(img.width, img.height)
    if longest > 1568:
        scale = 1568 / longest
        img = img.resize((int(img.width * scale), int(img.height * scale)))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue(), "image/jpeg"


@router.post("/describe-photo")
async def describe_photo(file: UploadFile = File(...)):
    raw = await file.read()
    try:
        jpeg_bytes, media_type = _resize_for_vision(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode image")

    image_b64 = base64.b64encode(jpeg_bytes).decode("ascii")
    try:
        response = await _caption_client.messages.create(
            model=CAPTION_MODEL,
            max_tokens=300,
            system=[
                {
                    "type": "text",
                    "text": CAPTION_SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_b64,
                            },
                        },
                        {"type": "text", "text": "Caption this photo as JSON."},
                    ],
                }
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Caption model failed: {exc}")

    text = next((b.text for b in response.content if b.type == "text"), "")
    match = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        parsed = json.loads(match.group() if match else text)
    except (json.JSONDecodeError, AttributeError):
        raise HTTPException(status_code=502, detail="Model did not return JSON")

    return {
        "title": (parsed.get("title") or "").strip(),
        "description": (parsed.get("description") or "").strip(),
    }
