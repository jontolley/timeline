"""Import an Evernote notebook JSON export into the personal-timeline.

The export is a folder of per-notebook JSON files plus an `attachments/`
tree (produced by a separate Evernote exporter). Each JSON file is a list of
notes:

    {
      "id": 1, "title": "...", "description": "...",
      "created": "2026-04-14T22:30:01Z", "updated": "...",
      "tags": [...], "author": "...", "source_url": null,
      "attachments": [{"filename","mime","size","md5","path"}, ...],
      "images_pdf": "attachments/<nb>/<note>/<note>.pdf" | null
    }

Media rule (set by the exporter): when a note had >1 image, the exporter
merged them into a single PDF referenced by `images_pdf`. In that case we
import ONLY that PDF and skip the individual image attachments. When
`images_pdf` is null we import the raw `attachments` instead.

  - image/jpeg, image/png  -> re-encoded JPEG photo (+400px thumb)
  - image/gif              -> SKIPPED (storage rejects gif)
  - application/pdf        -> imported as a pdf media item (no page-1 thumb;
                              the detail-page viewer renders pages itself)

All events from all notebooks land in a single thread named "evernote".

Usage:
    python tools/import_evernote.py /tmp/evernote_output/cars.json \\
        --target http://localhost:8000 \\
        --email you@example.com \\
        [--root /tmp/evernote_output]  # base dir for attachment paths
        [--limit 5]                     # cap for testing
        [--dry-run]                     # parse + summarize, no API calls

Auth: provide --token, or set TIMELINE_TOKEN, or omit both for interactive
magic-link login (same flow as import_dayone.py).

Idempotent: a sidecar tools/.evernote_import_state.json records which notes
have been imported (keyed per target + notebook), so re-runs resume cleanly
and the local-then-prod second pass doesn't duplicate.
"""

import argparse
import io
import json
import os
import sys

import requests
from PIL import Image

try:
    import fitz  # PyMuPDF — renders a page-1 thumbnail for pdf media
    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PHOTO_FULL_MAX = 2000
PHOTO_THUMB_MAX = 400
PHOTO_FULL_QUALITY = 85
PHOTO_THUMB_QUALITY = 80

THREAD_NAME = "evernote"
THREAD_COLOR = "violet"        # one of the timeline's ALLOWED_COLORS
THREAD_VISIBILITY = "private"

STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".evernote_import_state.json")


# ---------------------------------------------------------------------------
# HTTP helpers (mirrors import_dayone.py)
# ---------------------------------------------------------------------------


class Api:
    def __init__(self, base: str, token: str):
        self.base = base.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {token}"

    def get(self, path, **kwargs):
        return self.session.get(self.base + path, **kwargs)

    def post(self, path, **kwargs):
        return self.session.post(self.base + path, **kwargs)


def authenticate(api_base: str, email: str) -> str:
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
# Thread resolution
# ---------------------------------------------------------------------------


def ensure_thread(api: Api) -> str:
    """Find the 'evernote' thread or create it; return its id."""
    res = api.get("/api/threads")
    res.raise_for_status()
    for t in res.json():
        if t.get("name") == THREAD_NAME:
            return t["_id"]
    res = api.post(
        "/api/threads",
        json={"name": THREAD_NAME, "color": THREAD_COLOR, "visibility": THREAD_VISIBILITY},
    )
    if not res.ok:
        raise SystemExit(f"Thread create failed: {res.status_code} {res.text}")
    return res.json()["_id"]


# ---------------------------------------------------------------------------
# Local idempotency state
# ---------------------------------------------------------------------------


def load_state() -> dict:
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_state(state: dict):
    with open(STATE_PATH, "w") as f:
        json.dump(state, f, indent=2)


# ---------------------------------------------------------------------------
# Media processors
# ---------------------------------------------------------------------------


def _resize_jpeg(img, max_dim, quality):
    longest = max(img.width, img.height)
    scale = max_dim / longest if longest > max_dim else 1
    resized = img.resize((max(1, int(img.width * scale)), max(1, int(img.height * scale))))
    buf = io.BytesIO()
    resized.save(buf, format="JPEG", quality=quality)
    return buf.getvalue(), resized.width, resized.height


def process_photo(api, path):
    with open(path, "rb") as f:
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


def _pdf_thumb_and_pages(pdf_bytes):
    """Render page 1 to a JPEG thumb and return (thumb_bytes, page_count).

    Mirrors the frontend's pdf.js page-1 poster. Returns (None, None) if
    PyMuPDF isn't installed so the import still proceeds without a thumb.
    """
    if not HAS_FITZ:
        return None, None
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_count = doc.page_count
        page = doc.load_page(0)
        rect = page.rect
        zoom = PHOTO_THUMB_MAX / max(rect.width, rect.height) if max(rect.width, rect.height) else 1
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)  # alpha=False -> white bg
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    finally:
        doc.close()
    thumb_bytes, _, _ = _resize_jpeg(img, PHOTO_THUMB_MAX, PHOTO_THUMB_QUALITY)
    return thumb_bytes, page_count


def process_pdf(api, path):
    with open(path, "rb") as f:
        pdf_bytes = f.read()
    key = presign_and_put(api, pdf_bytes, "application/pdf")
    thumb_bytes, page_count = _pdf_thumb_and_pages(pdf_bytes)
    thumb_key = presign_and_put(api, thumb_bytes, "image/jpeg") if thumb_bytes else None
    item = {
        "kind": "pdf",
        "key": key,
        "thumb_key": thumb_key,
        "content_type": "application/pdf",
    }
    if page_count:
        item["page_count"] = page_count
    return item


# ---------------------------------------------------------------------------
# Note -> event
# ---------------------------------------------------------------------------


def build_description(note):
    desc = (note.get("description") or "").strip()
    url = (note.get("source_url") or "").strip()
    if url:
        desc = f"{desc}\n\nSource: {url}".strip()
    return desc or None


def collect_media_plan(note, root):
    """Return a list of (kind, abspath) to import, applying the images_pdf rule."""
    plan = []
    images_pdf = note.get("images_pdf")
    if images_pdf:
        plan.append(("pdf", os.path.join(root, images_pdf)))
        return plan
    for att in note.get("attachments") or []:
        mime = att.get("mime", "")
        path = os.path.join(root, att.get("path", ""))
        if mime == "image/gif":
            plan.append(("skip-gif", path))
        elif mime.startswith("image/"):
            plan.append(("photo", path))
        elif mime == "application/pdf":
            plan.append(("pdf", path))
        else:
            plan.append(("skip-other", path))
    return plan


def process_note(api, note, root, thread_id, notebook_tag, dry_run, idx, total, stats):
    title = (note.get("title") or "Untitled").strip() or "Untitled"
    date_iso = note.get("created")
    description = build_description(note)
    tags = list(note.get("tags") or [])
    if notebook_tag not in tags:
        tags.append(notebook_tag)  # e.g. "evernote-cars" — provenance marker on every event

    print(f"[{idx}/{total}] {title!r}  ({date_iso})")
    plan = collect_media_plan(note, root)

    media_items = []
    for kind, path in plan:
        label = os.path.basename(path)
        if kind == "skip-gif":
            print(f"    skip gif {label}")
            stats["media_skipped_gif"] += 1
            continue
        if kind == "skip-other":
            print(f"    skip non-media {label}")
            stats["media_skipped_other"] += 1
            continue
        if not os.path.exists(path):
            print(f"    [{kind}] MISSING on disk: {path}")
            stats["media_missing"] += 1
            continue
        print(f"    {kind} {label}", end=" ... ", flush=True)
        if dry_run:
            print("(dry-run)")
            continue
        try:
            item = process_photo(api, path) if kind == "photo" else process_pdf(api, path)
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
        "location": None,
        "tags": tags,
        "people": [],
        "media": media_items,
        "thread_id": thread_id,
    }

    if dry_run:
        stats["events_dry"] += 1
        print(f"    (dry-run) {len(plan)} attachment(s) planned\n")
        return None

    res = api.post("/api/events", json=payload)
    if not res.ok:
        print(f"    EVENT CREATE FAILED: {res.status_code} {res.text}\n")
        stats["events_failed"] += 1
        return None
    created = res.json()
    print(f"    created event {created['_id']} with {len(media_items)} media item(s)\n")
    stats["events_created"] += 1
    return created["_id"]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("json_path", help="Path to a notebook JSON file (e.g. cars.json)")
    parser.add_argument("--target", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--email", help="Email for magic-link login (if --token absent)")
    parser.add_argument("--token", help="Bearer token; overrides TIMELINE_TOKEN env var")
    parser.add_argument("--root", help="Base dir for attachment paths (default: JSON file's dir)")
    parser.add_argument("--limit", type=int, help="Process only the first N un-imported notes")
    parser.add_argument("--dry-run", action="store_true", help="Skip API calls, just print plan")
    args = parser.parse_args()

    if not os.path.exists(args.json_path):
        print(f"JSON not found: {args.json_path}", file=sys.stderr)
        sys.exit(1)

    root = args.root or os.path.dirname(os.path.abspath(args.json_path))
    notebook = os.path.splitext(os.path.basename(args.json_path))[0]

    with open(args.json_path) as f:
        notes = json.load(f)
    if not isinstance(notes, list):
        print("Expected the JSON to be a list of notes", file=sys.stderr)
        sys.exit(1)
    print(f"Notebook {notebook!r}: {len(notes)} notes")

    token = args.token or os.environ.get("TIMELINE_TOKEN")
    if not token and not args.dry_run:
        if not args.email:
            print("Provide --email (for magic-link login) or --token", file=sys.stderr)
            sys.exit(1)
        token = authenticate(args.target, args.email)
        print(f"Logged in. Re-use this token with: export TIMELINE_TOKEN={token}\n")

    api = Api(args.target, token or "dry-run") if not args.dry_run else None
    thread_id = None
    if api:
        res = api.get("/api/auth/me")
        if not res.ok:
            print(f"Auth check failed: {res.status_code} {res.text}", file=sys.stderr)
            sys.exit(1)
        print(f"Authenticated as {res.json().get('email')}")
        thread_id = ensure_thread(api)
        print(f"Thread {THREAD_NAME!r}: {thread_id}\n")

    state = load_state()
    state_key = f"{args.target.rstrip('/')}|{notebook}"
    done = state.setdefault(state_key, {})  # note_id(str) -> event_id

    todo = [n for n in notes if str(n.get("id")) not in done]
    skipped = len(notes) - len(todo)
    if args.limit:
        todo = todo[: args.limit]
    print(f"Already imported: {skipped}   Will process: {len(todo)}\n")

    stats = {
        "events_created": 0,
        "events_failed": 0,
        "events_dry": 0,
        "media_missing": 0,
        "media_failed": 0,
        "media_skipped_gif": 0,
        "media_skipped_other": 0,
    }

    notebook_tag = f"evernote-{notebook}"
    for i, note in enumerate(todo, 1):
        event_id = process_note(api, note, root, thread_id, notebook_tag, args.dry_run, i, len(todo), stats)
        if event_id:
            done[str(note.get("id"))] = event_id
            save_state(state)  # persist after each success so crashes resume cleanly

    print("Done.")
    print(f"  Events created : {stats['events_created']}")
    print(f"  Events failed  : {stats['events_failed']}")
    print(f"  Dry-run plans  : {stats['events_dry']}")
    print(f"  Already had    : {skipped}")
    print(f"  Media missing  : {stats['media_missing']}")
    print(f"  Media failed   : {stats['media_failed']}")
    print(f"  GIFs skipped   : {stats['media_skipped_gif']}")
    print(f"  Other skipped  : {stats['media_skipped_other']}")


if __name__ == "__main__":
    main()
