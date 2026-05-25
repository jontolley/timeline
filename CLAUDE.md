# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisites (host machine)

Two API keys must be exported before `docker compose up` (or written to a `.env` file in the project root, which compose reads automatically):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

- `ANTHROPIC_API_KEY` powers chat (default model `claude-sonnet-4-6`) and the photo caption endpoint (default `claude-haiku-4-5-20251001`).
- `OPENAI_API_KEY` powers vector embeddings (default model `text-embedding-3-small`, 1536 dims).

Optional overrides: `ANTHROPIC_MODEL` (chat), `ANTHROPIC_CAPTION_MODEL` (photo captions), `OPENAI_EMBED_MODEL`. Changing the embedding model changes vector dimensions — see "Changing models" below.

Auth-related env vars:

- `ALLOWED_EMAIL` — used **once** by the startup migration to seed the first admin user(s). After that, the `users` Mongo collection IS the allowlist; admins add users from Settings → Users.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — optional. When set, the "Continue with Google" button on the sign-in screen lights up. Registered redirect URIs in Google Cloud Console must match `{APP_BASE_URL}/api/auth/google/callback` for both dev and prod.
- `RESEND_API_KEY` / `RESEND_FROM` — magic-link emails. Resend's sandbox `onboarding@resend.dev` FROM only delivers to the account owner's email; for cross-recipient delivery (e.g. inviting other users), verify a sending domain in Resend. Until then, the Users tab shows a copyable sign-in URL as a fallback.

## Running the app

```bash
# Start everything (builds if needed)
docker compose up --build

# Start without rebuilding
docker compose up -d

# Rebuild a single service
docker compose build backend
docker compose build frontend

# Restart a single service after rebuild
docker compose up -d backend

# View logs
docker compose logs backend --tail 50
docker compose logs frontend --tail 20

# Stop
docker compose down
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Health check: http://localhost:8000/api/health

## Frontend local dev (without Docker)

The Vite dev server proxies `/api` to `http://localhost:8000`, so the backend must be running (in Docker or locally).

```bash
cd frontend
npm install
npm run dev      # dev server at http://localhost:5173
npm run build    # production build to dist/
```

## Local dev vs. production

The app is deployed publicly (backend + Qdrant on Fly, MongoDB Atlas, frontend on Cloudflare Pages). Local dev runs the full stack from `docker-compose.yml` against the in-cluster Mongo + Qdrant. Things that keep the two environments cleanly separated:

- **Mongo:** `docker-compose.yml` has `MONGO_URL: ${MONGO_URL:-mongodb://mongo:27017}` — falls back to the local container if `MONGO_URL` is unset. The Atlas connection string lives in `.env` under `ATLAS_MONGO_URL` (deliberately not `MONGO_URL`) so it does NOT override the local default. Renaming it to `MONGO_URL` would silently point dev at prod.
- **Auth defaults:** `COOKIE_SECURE` defaults to `false`, `APP_BASE_URL` to `http://localhost:3000`, `CORS_ORIGINS` to the localhost origins. Magic-link emails still send via Resend in dev using the real `RESEND_API_KEY`. Set `AUTH_DISABLED=true` to bypass the flow entirely for API testing.
- **Media (photos / videos / audio):** R2 is shared between dev and prod — there is no separate dev bucket. Test uploads land in the prod bucket, so clean them up. CORS allowlist for `timeline-photos` is managed via `wrangler r2 bucket cors`; both `localhost:3000`/`localhost:5173` and the prod origin must be in `allowed_origins`.
- **`/api` routing:** the Cloudflare Pages Function at `frontend/functions/api/[[path]].js` only runs in production. Locally, nginx (Docker frontend) or the Vite dev server proxy (`vite.config.js`) handles `/api/*` → `localhost:8000`.

## Architecture overview

### Services

| Service | Tech | Port |
|---------|------|------|
| Frontend | React 18 + Vite + plain CSS (Hindsite design system) | 3000 (nginx in Docker) |
| Backend | FastAPI + Uvicorn | 8000 |
| MongoDB | Motor (async driver) | 27017 |
| Qdrant | Vector DB for semantic search | 6333 |
| Anthropic API | Chat (Claude Sonnet 4.6 by default) | — |
| OpenAI API | Embeddings (text-embedding-3-small, 1536-dim) | — |

The product is branded **Hindsite** ("Look back, on purpose."). The repo/package is still `personal-timeline`; only the UI carries the Hindsite name.

Persistent data lives in `./data/mongo` and `./data/qdrant`.

### Backend (`backend/`)

- **`main.py`** — FastAPI app with lifespan. On startup: ensures the Qdrant collection exists, runs a series of idempotent migrations (photos→media rename, multi-user seed + owner_id backfill, default-thread seed + thread_id backfill, Qdrant payload thread_id backfill), and syncs any unindexed events to Qdrant. Registers every router below.
- **`database.py`** — Motor async client; exposes `users_collection`, `events_collection`, `people_collection`, `categories_collection`, `threads_collection`, `thread_subscriptions_collection`, `auth_codes_collection`.
- **`models.py`** — Pydantic models. The big ones: `User` (admin/user role), `EventBase` with `owner_id` + `thread_id`, `MediaRef` with `kind` ∈ {photo, video, audio}, `Category` (per-user, with palette `color`), `Thread` (per-user grouping with `visibility: private | shared`), `ThreadSubscription`. `LocationDetail` is the canonical location type; legacy string locations are normalised on read.
- **`storage.py`** — R2 client + `ALLOWED_MEDIA_TYPES` (images + `video/mp4`, `video/quicktime`, `audio/mpeg`, `audio/mp4`) and `EXT_FOR_TYPE` map. `presign_put` / `presign_get` produce one-hour-valid URLs; the events list endpoint signs GETs for every attached media item on every read.
- **`embeddings.py`** — `EmbeddingService` wraps Qdrant + the OpenAI embeddings API (`text-embedding-3-small`, 1536-dim vectors). Point IDs are `uuid5(NAMESPACE_DNS, mongo_id_string)` for deterministic, collision-free IDs. `search()` takes a `visible_thread_ids` list and adds it as a `MatchAny` must-clause so chat queries stay inside the viewer's owned + subscribed-visible threads. Existing points have `thread_id` in their payload via a one-shot `set_payload` migration in main.py.
- **`auth.py`** — Session token signing (`itsdangerous`), magic-link + session helpers, Google OAuth state token, and the FastAPI dependencies `require_auth` (returns the user dict) and `require_admin` (additionally checks role). `is_allowed(email)` is now an **async** function that hits `users_collection` — don't call it sync.
- **`routes/auth.py`** — Magic-link endpoints (`/request`, `/verify`, `/request-code`, `/exchange-code`) and the Google OAuth flow (`/google/start`, `/google/callback`). `/me` returns the user's role + user_id so the frontend can hide admin-only UI.
- **`routes/users.py`** — Admin-only CRUD for users. `POST /users` invites by email, seeds the new user with a default thread + 5 default categories, then best-effort sends a welcome email via Resend (sandbox limits — see Auth env vars). `GET /users/:id/footprint` returns counts for the cascade-delete confirm dialog. `DELETE /users/:id` cascades: R2 objects, Qdrant points (by owner_id), events / people / categories / threads / subscriptions, then the user record.
- **`routes/events.py`** — Standard CRUD plus `POST /events/:id/media` and `DELETE /events/:id/media/:key`. The reads (list + get) include events from threads the caller is subscribed to with `visible=true`; writes still require ownership of the event's thread (read-only sharing). `_serialize()` strips `owner_id`, signs R2 URLs, and — for cross-user reads — embeds the owner's category label/color (`category_display`) and people names (`people_display`) so the viewer's UI can render shared events without cross-tenant store lookups. `GET /events` is bidirectional when `limit` is set: `before_date+before_id` paginates older (sorts DESC); `after_date+after_id` paginates newer (sorts ASC then reverses so the response carries the events closest to the cursor, not the newest overall). Without `limit` it returns all events ascending (kept for the backup endpoint and Day One importer). `GET /events/years` returns `[{year, count}]` for the sidebar year-rail, respecting the same filter set.
- **`routes/threads.py`** — `GET /threads` returns owned + subscribed threads (with `subscriber_count` on owned ones and `subscription: {_id, visible}` on subscribed ones), `POST/PUT/DELETE` standard CRUD. Sharing endpoints: `POST /threads/:id/invite` (owner invites by email; invitee must already be a registered user), `GET /threads/:id/subscribers`, `DELETE /threads/:id/subscribers/:user_id`. Subscriber-side endpoints live on a sibling router: `PUT /api/subscriptions/:id { visible }` and `DELETE /api/subscriptions/:id`. Flipping a thread back to private wipes its subscriptions immediately.
- **`routes/categories.py`** — Per-user CRUD. Each user has their own category set with palette colors. Delete is blocked while any of the user's events reference the category.
- **`routes/people.py`** — Per-user CRUD. Delete cascades through events to pull the person out and re-embed.
- **`routes/uploads.py`** — `POST /uploads/presign` (R2 presigned PUT for any allowed MIME), `POST /uploads/extract-exif` (Pillow + pillow-heif, returns `{date, time, lat, lng}` from photo EXIF), `POST /uploads/describe-photo` (Claude Haiku vision; returns `{title, description}`). Photo bytes for the caption call are resized to ≤1568px server-side first to keep the round trip cheap.
- **`routes/chat.py`** — SSE streaming endpoint. Three flows: **create**, **edit**, **query**. Search calls (`_keyword_search`, `_hybrid_event_search`, `embedding_service.search`) take a `visible_thread_ids` list so chat queries reach shared-thread events. Edit intent restricts to owner-only threads (you can't chat-edit someone else's shared event). SSE event types: `sources`, `token`, `event_created`, `event_updated`, `done`.
- **`routes/backup.py`** — `GET /backup/json` exports the current user's events + people; `POST /backup/restore` wipes the current user's events + people (other users untouched) and re-inserts from the JSON, then re-indexes only that user's Qdrant points. The restore path tolerates legacy `photos[]` shape by mapping into `media[]` on import.

### Chat intent flow

1. Full conversation transcript → `INTENT_SYSTEM` prompt → Anthropic JSON → `{intent, fields, missing_required, event_search}`
2. `missing_required` can include `title`, `date`, `event_type`, `location`, `description`. The LLM reads the transcript to avoid re-asking fields already requested in a previous turn.
3. **create**: if `missing_required` non-empty → clarify; else → insert to MongoDB + upsert to Qdrant + stream confirmation.
4. **edit**: semantic search for target event → apply `fields` changes → update MongoDB + Qdrant.
5. **query**: semantic search top-5 → RAG context injected into streaming Anthropic chat.

### Frontend (`frontend/src/`)

- **`api/`** — Thin fetch wrappers. `chat.js` manually parses the SSE stream (no EventSource, since the request is a POST). `events.js`, `people.js`, `categories.js`, `threads.js`, `users.js` are standard REST. `uploads.js` is the kitchen-sink media-pipeline module: `extractExif`, `describePhoto`, `uploadMedia` (dispatches to photo / video / audio paths), plus client-side `extractVideoPosterUrl` and `extractAudioWaveformUrl` for the form preview tiles.
- **`store/index.js`** — Zustand. `useAuthStore` holds session status + email + role + user_id. `useEventStore` holds the bidirectionally-paginated timeline state (events, filters incl. `thread_ids`, `hasMoreOlder`, `hasMoreNewer`, anchorId, loaded). Actions: `appendOlder` (bottom sentinel), `prependNewer` (top sentinel), `jumpToWindow(events, hasMoreOlder, hasMoreNewer)` (year-rail click). Invalidated on event/category/subscription-visibility changes. Scroll restoration anchors on a card's `_id` (`data-event-id`), tracked live via a passive scroll listener — not a `useEffect` cleanup, because React removes the DOM nodes before the cleanup fires. `usePeopleStore`, `useCategoryStore`, `useThreadStore`, `useUserStore` are simple caches loaded once per auth session. `useChatStore` persists chat session messages via localStorage, keyed to an `ownerId` so the chat resets on sign-out and on a different user signing in.
- **`lib/confirm.jsx`** — `ConfirmProvider` + `useConfirm()` / `useAlert()` hooks that replace `window.confirm` / `window.alert`. Returns Promises with the same semantics, renders in the existing `sheet-backdrop`/`sheet` styling. The provider is wrapped around the router in `App.jsx`.
- **`lib/photoHandoff.js`** — One-shot in-memory slots that carry a File and an in-flight caption Promise from `TimelineView` to `EventForm` during the "Event from photo" / "Photo with AI captions" flows. Cleared on consume so a page refresh doesn't re-attach.
- **`utils/date.js`** — All date formatting passes `timeZone: 'UTC'` to prevent local-timezone day shift on UTC-midnight dates. `formatDateRange(startIso, endIso)` handles optional end dates.
- **`utils/location.js`** — `locationDisplay()` handles both legacy strings and `LocationDetail` objects. `locationMapUrl()` builds Google Maps links from coords or name.
- **`utils/eventTypes.js`** — `categoryClass`, `categoryStyle`, `categoryLabel`, `useEventTypes()`. For shared events from other users, EventCard / EventDetail prefer the denormalized `category_display` / `people_display` fields on the response over the viewer's local stores.
- **`components/EventCard.jsx`** — Timeline tile. Renders photo thumbnails, video posters (with play badge), and a styled placeholder or waveform thumb for audio. Tagged with `data-event-id` (scroll anchor) and `data-event-date`. Shows a thread chip when the user has 2+ threads and a "shared" badge for events from other users.
- **`components/FilterBar.jsx`** — Category, threads, and people chip rows. Threads row is hidden when the user has only 1 thread.
- **`components/YearRail.jsx`** — Sticky vertical year sidebar on the timeline. Lists every year that has matching events (respects active filters via `GET /api/events/years`), highlights the year currently at the top of the viewport, and jumps the timeline when clicked. Collapses to a horizontal year strip ≤900px.
- **`components/LocationPicker.jsx`** — Leaflet + OpenStreetMap map with Nominatim geocoding (no API key). On mount, auto-geocodes a value that has name/address but no coords; also reverse-geocodes the inverse case (coords but no name) so EXIF-derived locations resolve to a readable address. Nominatim search is debounced 400ms.
- **`components/Topbar.jsx`** — Hindsite wordmark + Timeline / Chat nav, and the account chip on the far right (avatar initial + display name + email → dropdown with Settings + Sign out). Esc and click-outside close the dropdown.
- **`components/Modal.jsx`** — Reusable add/edit dialog used by every Settings section (Threads, Categories, People, Users) plus the user-delete footprint confirm and the backup-restore confirm. Renders an eyebrow + serif headline + sub + close button, a body slot for the form, and a right-aligned footer with cancel + primary action. Locks body scroll while open and wires Escape + scrim click to close. Submitting Enter inside the `<form>` slot triggers `primary` (link the form to its button via `form="..."`).
- **`pages/SettingsView.jsx`** — Settings is a **console layout**: a 280px left rail with the "Settings" label and the Account nav (People / Categories / Threads / Backup, plus Users for admins, each with a live count) and a right "well" that renders the active section. No outer card/border — the console flushes against the page edges. Old `/people` and `/backup` routes redirect here. Each section component renders its own `.hs-well-head` (serif `<h1>` + `.hs-well-count` line) inside the well.
- **`pages/EventDetail.jsx`** — On load, if the event has a location name/address but no coords, geocodes via Nominatim and stores the result in `displayLocation` (display-only, not saved back). Media is split: photos + videos render in a grid with a video lightbox; audio gets its own inline-player strip below the grid. Edit / Delete buttons hide for shared events (`event.is_owner === false`).

### Tools (`tools/`)

- **`import_dayone.py`** — One-off importer that reads a Day One JSON export zip and creates one event per entry via the live API. Maps title from `richText` header blocks with a Claude Haiku fallback for the older untitled entries, maps tags to event types via a small heuristic, mirrors locations, and uploads photos (Pillow-resized to 2000px + 400px thumb), videos (ffmpeg-extracted poster), and audio (no thumb). Idempotent via a `dayone:<uuid>` tag, so re-runs after a crash resume cleanly. See the file's docstring for the full usage; requires `pip install -r tools/requirements.txt` and `ffmpeg` on PATH.

### Key invariants

- **Multi-tenant isolation.** Every owned record (events / people / categories / threads) carries an `owner_id`. Every CRUD route filters by the current user; new queries that omit the owner filter are bugs. `require_auth` returns the user dict (not just email); use `current_user["_id"]` in handlers.
- **Every event has a `thread_id`** pointing at a thread that exists. New events default to the user's oldest thread when omitted (used by the Day One importer, chat-create, and backup restore). A user's last thread can't be deleted (events need a thread); a thread with events can't be deleted (must move events first).
- **Sharing is thread-level + read-only.** `thread.visibility` ∈ {`private`, `shared`}. Reads cascade across tenants via `thread_id IN (owned ∪ subscribed-visible)`; writes still require the writer to own the thread. Flipping a thread back to private wipes existing subscriptions immediately. Cross-user reads denormalize the owner's category label/color (`category_display`) and people names (`people_display`) onto the response so the viewer's UI works without the owner's stores.
- **Dates** are always stored as UTC in MongoDB. The form builds ISO strings as `${date}T${time}:00.000Z`. Display always uses `timeZone: 'UTC'`.
- **Location** is stored as `{name, address, lat, lng}`. Legacy string locations in the DB are normalised on every read in `_serialize` / `_serialize_doc`. Frontend helpers also handle the string case.
- **Media** is stored as `media[]` with each item carrying `kind` ∈ {photo, video, audio}, an R2 `key`, an optional `thumb_key`, and dimensions/duration. A startup migration converted any pre-existing `photos[]` field; `_serialize` still falls back to `photos[]` for safety. Thumbnails (photo thumbs, video posters, audio waveforms) are rendered client-side via canvas / Web Audio and uploaded as separate R2 objects.
- **`GET /events` is bidirectionally paginated when `limit` is set.** `before_date`+`before_id` returns older events (sorts DESC). `after_date`+`after_id` returns newer events — handler sorts ASC + reverses so the response carries the events *closest* to the cursor on the newer side rather than the newest events overall. Don't collapse upward queries back to a single DESC sort; the year-rail's scroll-up direction depends on this. Without `limit` the endpoint returns all events ascending — the contract the backup endpoint and `tools/import_dayone.py` rely on, don't remove it.
- **Year-rail jumps straddle the target year.** `handleJumpToYear` in `TimelineView` runs two parallel `GET /events` requests (one `before_date`, one `after_date`, both at `Jan 1 of year+1`) and merges the results so the user lands in the middle of a window with newer-year context above and older-year context below. Top + bottom sentinels then extend the window in either direction. Replacing this with a single before-fetch leaves the user with no upward context.
- **Active year tracking uses `[data-year-marker]` elements**, not event cards. The active year is the last marker whose `getBoundingClientRect().top <= topbarH + 24px`. Card-based tracking has a frame-off blind spot at year boundaries — don't reintroduce it.
- **Sticky topbar offset lives in `--topbar-h`** on `:root`. The year rail's `top:`, `.year-marker` + `.event` `scroll-margin-top`, and the runtime scrollspy threshold all consume it. Bump the var, everything follows.
- **Qdrant payloads carry `thread_id`** so chat semantic search can filter by visible threads. A one-shot `set_payload` migration on startup backfills any pre-Phase-2 points. New writes carry the field automatically because `_serialize` includes it.
- **nginx body limit** is bumped to 50 MB in `frontend/nginx.conf` so iPhone JPEGs and HEICs flow through the proxy on the EXIF / caption endpoints. Direct-to-R2 PUTs (the actual file upload) bypass nginx via presign and aren't affected by this limit.
- **R2 CORS** must include every origin that will PUT to the bucket; see `wrangler r2 bucket cors list timeline-photos`. Without the prod origin in the allowlist, uploads silently fail with a CORS error and only the metadata calls succeed.
- **Qdrant point IDs** are `uuid5` of the MongoDB `_id` string — never random, so upsert is idempotent.
- **SSE buffering** is disabled in nginx (`proxy_buffering off`) so tokens reach the browser without delay.
- **No `window.confirm` / `window.alert`** in the frontend. Use `useConfirm()` / `useAlert()` from `lib/confirm.jsx` so dialogs match the rest of the app.
- **Hindsite design system.** Tokens live at the top of `frontend/src/index.css` under `:root`. Three font roles: Instrument Serif (`--font-serif`) for display headlines + italic accents, Geist (`--font-sans`) for body/UI, JetBrains Mono (`--font-mono`) for eyebrows and labels. Indigo palette: cream `--bg` (#eef1f8) and `--cream`, denim `--accent` (#2e5bb0) with `--accent-d`, gold-on-dark `--gold`. Surfaces use `--feature-bg` (cards/rows), `--rule` (1px borders), `--hi` (highlight tint). Hero gradients (`--hero-1..4`) and dark CTA (`--dark-1/2`) are landing-only. When adding new UI, prefer existing tokens over hex literals so palette changes propagate.

## Changing models

Set `ANTHROPIC_MODEL` or `OPENAI_EMBED_MODEL` in your shell or `.env`. Changing the chat model is a no-op data-wise.

**Changing the embedding model changes vector dimensions and invalidates the existing index.** `EmbeddingService.ensure_collection()` detects this on startup, drops the Qdrant collection, and the startup sync loop re-embeds every event via the new model — no manual cleanup required:

```bash
# In .env or your shell:
OPENAI_EMBED_MODEL=text-embedding-3-large   # 3072-dim instead of 1536
docker compose up -d backend
# Backend startup detects the dim change, recreates the collection, and re-embeds.
```

## Testing

There are no automated tests. When manually testing via API calls that create events, delete the test events after testing is complete.

```bash
# Create test event
curl -s -X POST http://localhost:8000/api/events \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","event_type":"milestone","date":"2024-01-01T00:00:00.000Z"}'

# Delete it (use the _id from the create response)
curl -X DELETE http://localhost:8000/api/events/<id>
```
