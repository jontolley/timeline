"""Import a Day One JSON export into the personal-timeline.

Usage:
    python tools/import_dayone.py path/to/DayOne.zip \\
        --target https://personal-timeline-api.fly.dev \\
        --email you@example.com \\
        [--limit 5]            # cap for testing
        [--dry-run]            # parse + summarize, no API calls
        [--no-claude]          # disable Claude title fallback

Auth: provide --token, or set TIMELINE_TOKEN, or omit both for interactive
magic-link login. Claude title fallback requires ANTHROPIC_API_KEY.
ffmpeg must be on PATH for video poster extraction.
"""

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests
from PIL import Image

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PHOTO_FULL_MAX = 2000
PHOTO_THUMB_MAX = 400
PHOTO_FULL_QUALITY = 85
PHOTO_THUMB_QUALITY = 80
VIDEO_POSTER_MAX = 400

# File ext → MIME type for upload presign. We re-encode photos as JPEG,
# so source photo extensions don't matter for the upload content type.
VIDEO_MIME = {"mov": "video/quicktime", "mp4": "video/mp4"}
AUDIO_MIME = {"m4a": "audio/mp4", "mp3": "audio/mpeg"}


CLAUDE_SUMMARIZE_SYSTEM = (
    "You write short, warm titles for personal-timeline events. "
    "Given the body of a journal entry, respond with ONLY a title — "
    "3 to 7 words, no quotes, no trailing punctuation, no preamble. "
    "Capture the moment in plain language."
)


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


class Api:
    """Thin wrapper around requests.Session with the Bearer token attached."""

    def __init__(self, base: str, token: str):
        self.base = base.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"

    def get(self, path, **kwargs):
        return self.session.get(self.base + path, **kwargs)

    def post(self, path, **kwargs):
        return self.session.post(self.base + path, **kwargs)


def authenticate(api_base: str, email: str) -> str:
    """Interactive magic-link login. Returns a Bearer token."""
    res = requests.post(f"{api_base}/api/auth/request-code", json={"email": email})
    res.raise_for_status()
    code = input(f"Enter the 6-digit code emailed to {email}: ").strip()
    res = requests.post(
        f"{api_base}/api/auth/exchange-code", json={"email": email, "code": code}
    )
    if not res.ok:
        raise SystemExit(f"Login failed: {res.status_code} {res.text}")
    return res.json()["token"]


def presign_and_put(api: Api, payload_bytes: bytes, content_type: str) -> str:
    """Presign + PUT to R2, return the storage key."""
    res = api.post("/api/uploads/presign", json={"content_type": content_type})
    if not res.ok:
        raise RuntimeError(f"presign failed: {res.status_code} {res.text}")
    data = res.json()
    put_res = requests.put(
        data["upload_url"], data=payload_bytes, headers={"Content-Type": content_type}
    )
    if not put_res.ok:
        raise RuntimeError(f"R2 PUT failed: {put_res.status_code}")
    return data["key"]


# ---------------------------------------------------------------------------
# Day One field mappers
# ---------------------------------------------------------------------------


def extract_title_from_richtext(rt_str):
    """Day One marks titles as header-level lines in richText.contents[]."""
    if not rt_str:
        return None
    try:
        rt = json.loads(rt_str)
    except Exception:
        return None
    for block in rt.get("contents", []):
        attrs = block.get("attributes") or {}
        line = attrs.get("line") or {}
        if line.get("header") and block.get("text"):
            return block["text"].strip() or None
    return None


def unescape_dayone(text):
    """Day One escapes punctuation in the plain-text mirror with backslashes."""
    if not text:
        return ""
    return re.sub(r"\\([.!?,;:])", r"\1", text)


# Day One embeds media as Markdown image refs with three shapes:
#   ![](dayone-moment://<UUID>)          — photos
#   ![](dayone-moment:/video/<UUID>)     — videos
#   ![](dayone-moment:/audio/<UUID>)     — audio
_IMAGE_REF_RE = re.compile(r"!\[\]\(dayone-moment:(?://|/(?:video|audio)/)[A-F0-9]+\)\n?")


def clean_description(entry, title):
    """Plain prose only — drop the leading title line and image refs."""
    text = unescape_dayone(entry.get("text") or "")
    if title:
        # Day One stores title as either "# Title" or just "Title" on the first line.
        lines = text.split("\n", 1)
        first = lines[0].lstrip("# ").strip()
        if first.casefold() == title.casefold():
            text = lines[1] if len(lines) > 1 else ""
    text = _IMAGE_REF_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None


def build_location(entry):
    loc = entry.get("location")
    if not loc:
        return None
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    place = (loc.get("placeName") or "").strip() or None
    locality = (loc.get("localityName") or "").strip() or None
    admin = (loc.get("administrativeArea") or "").strip() or None
    country = (loc.get("country") or "").strip() or None
    name = place or locality
    parts = [p for p in (place, locality, admin, country) if p]
    return {
        "name": name,
        "address": ", ".join(parts) if parts else None,
        "lat": lat,
        "lng": lng,
    }


def date_in_local_tz(creation_date_iso, tz_name):
    """Convert UTC ISO → entry's local wall clock, then write back as a
    UTC-suffixed ISO so the app's UTC-display convention shows the
    correct calendar date.

    e.g. 2022-04-06T02:00:20Z with America/Los_Angeles → 2022-04-05T19:00:20Z
    """
    if not creation_date_iso:
        return None
    dt = datetime.fromisoformat(creation_date_iso.replace("Z", "+00:00"))
    if tz_name:
        try:
            local = dt.astimezone(ZoneInfo(tz_name))
            return local.replace(tzinfo=None).isoformat(timespec="milliseconds") + "Z"
        except Exception:
            pass
    return (
        dt.astimezone(timezone.utc).replace(tzinfo=None).isoformat(timespec="milliseconds")
        + "Z"
    )


def summarize_with_claude(client, text):
    if not text or len(text.strip()) < 5:
        return None
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=40,
            system=[
                {
                    "type": "text",
                    "text": CLAUDE_SUMMARIZE_SYSTEM,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": text[:2000]}],
        )
        out = next((b.text for b in response.content if b.type == "text"), "").strip()
        return out.strip("\"' ").rstrip(".") or None
    except Exception as exc:
        print(f"    [claude] {exc}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Media upload pipelines
# ---------------------------------------------------------------------------


def _resize_jpeg(img, max_dim, quality):
    longest = max(img.width, img.height)
    scale = max_dim / longest if longest > max_dim else 1
    resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))))
    buf = io.BytesIO()
    resized.save(buf, format="JPEG", quality=quality)
    return buf.getvalue(), resized.width, resized.height


def process_photo(api, zf, ref):
    md5 = ref["md5"]
    ext = ref.get("type", "jpeg")
    src = f"photos/{md5}.{ext}"
    with zf.open(src) as f:
        img = Image.open(io.BytesIO(f.read()))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")

    full_bytes, w, h = _resize_jpeg(img, PHOTO_FULL_MAX, PHOTO_FULL_QUALITY)
    thumb_bytes, _, _ = _resize_jpeg(img, PHOTO_THUMB_MAX, PHOTO_THUMB_QUALITY)

    full_key = presign_and_put(api, full_bytes, "image/jpeg")
    thumb_key = presign_and_put(api, thumb_bytes, "image/jpeg")

    return {
        "kind": "photo",
        "key": full_key,
        "thumb_key": thumb_key,
        "content_type": "image/jpeg",
        "width": w,
        "height": h,
    }


def process_video(api, zf, ref, tmpdir):
    md5 = ref["md5"]
    ext = ref.get("type", "mov").lower()
    src = f"videos/{md5}.{ext}"
    content_type = VIDEO_MIME.get(ext, f"video/{ext}")

    with zf.open(src) as f:
        video_bytes = f.read()

    video_key = presign_and_put(api, video_bytes, content_type)

    # Best-effort poster via ffmpeg.
    thumb_key = None
    src_path = os.path.join(tmpdir, f"{md5}.{ext}")
    poster_path = os.path.join(tmpdir, f"{md5}.jpg")
    try:
        with open(src_path, "wb") as fp:
            fp.write(video_bytes)
        # Seek to 1s (or start if shorter), grab one frame, scale to <=400 width.
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-ss",
                "1",
                "-i",
                src_path,
                "-frames:v",
                "1",
                "-q:v",
                "2",
                "-vf",
                f"scale='min({VIDEO_POSTER_MAX},iw)':-2",
                poster_path,
            ],
            check=True,
            timeout=30,
        )
        with open(poster_path, "rb") as fp:
            poster_bytes = fp.read()
        thumb_key = presign_and_put(api, poster_bytes, "image/jpeg")
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError) as exc:
        print(f"    [poster] {exc}", file=sys.stderr)
    finally:
        for p in (src_path, poster_path):
            try:
                os.remove(p)
            except OSError:
                pass

    return {
        "kind": "video",
        "key": video_key,
        "thumb_key": thumb_key,
        "content_type": content_type,
        "width": ref.get("width"),
        "height": ref.get("height"),
        "duration_seconds": ref.get("duration"),
    }


def process_audio(api, zf, ref):
    md5 = ref["md5"]
    ext = ref.get("type", "m4a").lower()
    src = f"audios/{md5}.{ext}"
    content_type = AUDIO_MIME.get(ext, f"audio/{ext}")
    with zf.open(src) as f:
        audio_bytes = f.read()
    audio_key = presign_and_put(api, audio_bytes, content_type)
    return {
        "kind": "audio",
        "key": audio_key,
        "thumb_key": None,
        "content_type": content_type,
        "duration_seconds": ref.get("duration"),
    }


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def fetch_imported_uuids(api):
    """Return the set of Day One UUIDs that have already been imported."""
    res = api.get("/api/events")
    res.raise_for_status()
    seen = set()
    for ev in res.json():
        for tag in ev.get("tags", []) or []:
            if isinstance(tag, str) and tag.startswith("dayone:"):
                seen.add(tag.split(":", 1)[1])
    return seen


# ---------------------------------------------------------------------------
# Per-entry processing
# ---------------------------------------------------------------------------


def process_entry(api, anthropic_client, zf, entry, tmpdir, dry_run, idx, total, stats):
    uuid = entry.get("uuid", "?")
    date_short = (entry.get("creationDate") or "")[:10]
    print(f"[{idx}/{total}] {date_short}  uuid={uuid}")

    # Title
    title = extract_title_from_richtext(entry.get("richText"))
    if not title:
        text = unescape_dayone(entry.get("text") or "")
        if anthropic_client:
            title = summarize_with_claude(anthropic_client, text)
        if not title:
            first_line = text.split("\n", 1)[0].strip().lstrip("# ").strip()
            title = first_line[:80] or f"Entry from {date_short}"

    tags = list(entry.get("tags") or [])
    if f"dayone:{uuid}" not in tags:
        tags.append(f"dayone:{uuid}")

    description = clean_description(entry, title)
    location = build_location(entry)
    date_iso = date_in_local_tz(entry.get("creationDate"), entry.get("timeZone"))

    print(f"    title : {title!r}")
    if location and location.get("name"):
        print(f"    loc   : {location['name']}")

    # Media — upload first, then attach in the create payload.
    media_items = []

    # Default extensions when the JSON ref omits `type` (audio entries in
    # particular sometimes carry `format` instead).
    KIND_DEFAULT_EXT = {"photo": "jpeg", "video": "mov", "audio": "m4a"}
    for kind, refs, src_dir, processor in (
        ("photo", entry.get("photos") or [], "photos", lambda r: process_photo(api, zf, r)),
        ("video", entry.get("videos") or [], "videos", lambda r: process_video(api, zf, r, tmpdir)),
        ("audio", entry.get("audios") or [], "audios", lambda r: process_audio(api, zf, r)),
    ):
        ordered = sorted(refs, key=lambda r: r.get("orderInEntry", 0))
        for ref in ordered:
            md5 = ref.get("md5", "?")
            ext = ref.get("type") or KIND_DEFAULT_EXT[kind]
            ref["type"] = ext  # downstream processors expect a populated `type`
            # Fallback: scan zip for any file matching the md5 prefix in case
            # the source extension differs from what we guessed.
            zip_path = f"{src_dir}/{md5}.{ext}"
            if zip_path not in zf.namelist():
                matches = [n for n in zf.namelist() if n.startswith(f"{src_dir}/{md5}.")]
                if matches:
                    zip_path = matches[0]
                    ref["type"] = zip_path.rsplit(".", 1)[-1]
                else:
                    print(f"    [{kind}] {md5[:8]} MISSING in zip — skipping")
                    stats["media_missing"] += 1
                    continue
            print(f"    {kind} {md5[:8]}.{ext}", end=" ... ", flush=True)
            if dry_run:
                print("(dry-run)")
                continue
            try:
                item = processor(ref)
                media_items.append(item)
                print("ok")
            except Exception as exc:
                print(f"FAILED: {exc}")
                stats["media_failed"] += 1

    payload = {
        "title": title,
        "description": description,
        "date": date_iso,
        "end_date": None,
        "location": location,
        "tags": tags,
        "people": [],
        "media": media_items,
    }

    if dry_run:
        stats["events_dry"] += 1
        print()
        return

    res = api.post("/api/events", json=payload)
    if not res.ok:
        print(f"    EVENT CREATE FAILED: {res.status_code} {res.text}\n")
        stats["events_failed"] += 1
        return
    created = res.json()
    print(f"    created event {created['_id']} with {len(media_items)} media item(s)\n")
    stats["events_created"] += 1


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("zip_path", help="Path to the Day One export zip")
    parser.add_argument("--target", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--email", help="Email for magic-link login (if --token absent)")
    parser.add_argument("--token", help="Bearer token; overrides TIMELINE_TOKEN env var")
    parser.add_argument("--limit", type=int, help="Process only the first N un-imported entries")
    parser.add_argument("--dry-run", action="store_true", help="Skip API calls, just print plan")
    parser.add_argument("--no-claude", action="store_true", help="Skip Claude title fallback")
    args = parser.parse_args()

    if not os.path.exists(args.zip_path):
        print(f"Zip not found: {args.zip_path}", file=sys.stderr)
        sys.exit(1)

    token = args.token or os.environ.get("TIMELINE_TOKEN")
    if not token and not args.dry_run:
        if not args.email:
            print("Provide --email (for magic-link login) or --token", file=sys.stderr)
            sys.exit(1)
        token = authenticate(args.target, args.email)
        print(f"Logged in. Re-use this token with: export TIMELINE_TOKEN={token}\n")

    api = Api(args.target, token or "dry-run") if not args.dry_run else None

    if api:
        res = api.get("/api/auth/me")
        if not res.ok:
            print(f"Auth check failed: {res.status_code} {res.text}", file=sys.stderr)
            sys.exit(1)
        print(f"Authenticated as {res.json().get('email')}\n")

    anthropic_client = None
    if not args.no_claude and HAS_ANTHROPIC and os.environ.get("ANTHROPIC_API_KEY"):
        anthropic_client = anthropic.Anthropic()
        print("Claude title fallback enabled.\n")
    elif not args.no_claude:
        print("Claude title fallback NOT enabled (no ANTHROPIC_API_KEY); will use first-line fallback.\n")

    stats = {
        "events_created": 0,
        "events_failed": 0,
        "events_dry": 0,
        "events_skipped": 0,
        "media_missing": 0,
        "media_failed": 0,
    }

    with zipfile.ZipFile(args.zip_path) as zf:
        with zf.open("Journal.json") as f:
            journal = json.load(f)
        entries = sorted(journal["entries"], key=lambda e: e.get("creationDate", ""))
        print(f"Journal has {len(entries)} entries")

        if api:
            imported = fetch_imported_uuids(api)
            print(f"Already imported: {len(imported)}")
        else:
            imported = set()

        todo = [e for e in entries if e.get("uuid") not in imported]
        stats["events_skipped"] = len(entries) - len(todo)
        if args.limit:
            todo = todo[: args.limit]
        print(f"Will process: {len(todo)}\n")

        tmpdir = tempfile.mkdtemp(prefix="dayone-import-")
        try:
            for i, entry in enumerate(todo, 1):
                process_entry(api, anthropic_client, zf, entry, tmpdir, args.dry_run, i, len(todo), stats)
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    print("Done.")
    print(f"  Events created : {stats['events_created']}")
    print(f"  Events failed  : {stats['events_failed']}")
    print(f"  Dry-run plans  : {stats['events_dry']}")
    print(f"  Already had    : {stats['events_skipped']}")
    print(f"  Media missing  : {stats['media_missing']}")
    print(f"  Media failed   : {stats['media_failed']}")


if __name__ == "__main__":
    main()
