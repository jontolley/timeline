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
- `RESEND_API_KEY` / `RESEND_FROM` — magic-link + invite emails. Prod is set to `RESEND_FROM=noreply@hindsite.app` (the `hindsite.app` sending domain is verified in Resend as of 2026-05-28, so we deliver to any recipient, not just the Resend account owner). The HTML shell is branded Hindsite indigo (see `backend/auth.py:_email_html`), with the clock brand-mark referenced as `<img src="https://hindsite.app/brand-mark.svg">` (inline `<svg>` gets stripped by Gmail). For local dev without `RESEND_API_KEY`, the helpers print the link/code to stdout so it surfaces in `docker compose logs backend`.

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

The app is deployed publicly at **`https://hindsite.app`** (backend + Qdrant on Fly, MongoDB Atlas, frontend on Cloudflare Pages project `hindsite`). `hindsite.app` is a Cloudflare zone attached to the Pages project as a custom domain; `www.hindsite.app` is 301'd to the apex via a Redirect Rule on the zone; the legacy `https://hindsite.pages.dev` URL also still resolves to the same site (it's the Pages project's default domain). The Pages project is Git-connected to `jontolley/timeline` with the `frontend/` directory as the build root, so **pushing to `main` triggers an auto-deploy** — no manual `wrangler` step required. Local dev runs the full stack from `docker-compose.yml` against the in-cluster Mongo + Qdrant. Things that keep the two environments cleanly separated:

- **Mongo:** `docker-compose.yml` has `MONGO_URL: ${MONGO_URL:-mongodb://mongo:27017}` — falls back to the local container if `MONGO_URL` is unset. The Atlas connection string lives in `.env` under `ATLAS_MONGO_URL` (deliberately not `MONGO_URL`) so it does NOT override the local default. Renaming it to `MONGO_URL` would silently point dev at prod.
- **Auth defaults:** `COOKIE_SECURE` defaults to `false`, `APP_BASE_URL` to `http://localhost:3000`, `CORS_ORIGINS` to the localhost origins. Magic-link emails still send via Resend in dev using the real `RESEND_API_KEY`. Set `AUTH_DISABLED=true` to bypass the flow entirely for API testing.
- **Media (photos / videos / audio / PDFs):** R2 is shared between dev and prod — there is no separate dev bucket. Test uploads land in the prod bucket, so clean them up. CORS allowlist for `timeline-photos` is managed via `wrangler r2 bucket cors`; the current set is `localhost:3000` + `localhost:5173` + `https://hindsite.app` + `https://www.hindsite.app` + `https://hindsite.pages.dev`. A new frontend origin must be added or photo uploads silently fail with a CORS error.
- **`/api` routing:** the Cloudflare Pages Function at `frontend/functions/api/[[path]].js` only runs in production. Locally, nginx (Docker frontend) or the Vite dev server proxy (`vite.config.js`) handles `/api/*` → `localhost:8000`.

## Deployment

- **Frontend:** Cloudflare Pages project `hindsite`, served at `https://hindsite.app` (custom domain) and `https://hindsite.pages.dev` (default). Production branch `main`, root directory `frontend`, build command `npm install && npm run build`, output `dist`. **Push-to-main auto-deploys via the Git integration.** For a manual one-off (e.g. CF build broken), run `npx wrangler pages deploy dist --project-name=hindsite --branch=main` from `frontend/` — you must be in `frontend/` so wrangler picks up the sibling `functions/` directory; running from the repo root silently skips the Function and the API proxy breaks.
- **Backend:** `fly deploy` from `backend/` (Fly app `personal-timeline-api`, region `sjc`). `min_machines_running = 1` keeps one machine warm so first-page loads never pay a wake-up; the second machine still auto-suspends/auto-starts under load. Don't drop this to 0 without re-checking that cold-start latency clears CF's 100s edge timeout. Secrets — `flyctl secrets set X=Y -a personal-timeline-api` triggers a rolling restart.
- **Qdrant:** `fly deploy` from `infra/qdrant/` (Fly app `timeline-qdrant`, persistent volume `qdrant_data`).
- **Mongo:** Atlas M0 — managed via the Atlas UI, connection string lives in Fly secret `MONGO_URL`.
- **Verifying a deploy:** the `/about` page renders the build's git short SHA (injected at build time by `vite.config.js`) plus the build timestamp — useful when CF/HTML caching disagrees with the latest deploy. Check there before debugging "why isn't my change showing up" issues.

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

- **`main.py`** — FastAPI app with a **two-phase lifespan**. Fast path (synchronous, before serving): `_ensure_text_index` + `_ensure_auth_indexes` only. Background path (`_background_startup` task spawned right before `yield`, cancelled on shutdown): `embedding_service.ensure_collection()`, all idempotent migrations (photos→media, owner_id backfill, default-thread seed + thread_id backfill, Qdrant payload thread_id backfill), and a Qdrant catch-up loop. Driven by Cloudflare's ~100s edge timeout — a cold Fly + Atlas + Qdrant wake + full migrations used to return 524. **Don't move deferred work back into the sync block.** Also defines `GET /api/health` and unauthenticated `GET /api/stats/public` (`{event_count}` for the landing hero).
- **`database.py`** — Motor async client; exposes `users_collection`, `events_collection`, `people_collection`, `threads_collection`, `thread_subscriptions_collection`, `auth_codes_collection`.
- **`models.py`** — Pydantic models. `EventBase` has `owner_id` + `thread_id`; `MediaRef.kind` ∈ {photo, video, audio, pdf} with optional `page_count` set for PDFs; `Thread.visibility` ∈ {private, shared}. `LocationDetail` is canonical; legacy string locations normalise on read.
- **`storage.py`** — R2 client. `ALLOWED_MEDIA_TYPES` = images + `video/mp4`, `video/quicktime`, `audio/mpeg`, `audio/mp4`, `application/pdf`. `presign_put` / `presign_get` produce 1h URLs; events list signs GETs for every media item on every read.
- **`embeddings.py`** — Qdrant + OpenAI embeddings (`text-embedding-3-small`, 1536-dim). Point IDs are `uuid5(NAMESPACE_DNS, mongo_id_string)` — deterministic, idempotent upsert. `search()` takes a `visible_thread_ids` list and adds it as a `MatchAny` must-clause so chat stays inside owned + subscribed-visible threads.
- **`auth.py`** — Session signing (`itsdangerous`), magic-link / Google OAuth helpers, and the `require_auth` / `require_admin` deps. **`is_allowed(email)` is async** (hits `users_collection`) — don't call it sync.
- **`routes/auth.py`** — Magic-link (`/request`, `/verify`, `/request-code`, `/exchange-code`) + Google OAuth (`/google/start`, `/google/callback`); `/me` returns role + user_id. **Browser-facing endpoints (Google callback, magic-link verify) 302 to `{APP_BASE_URL}/unauthorized?email=…` via `_unauthorized_redirect`** instead of returning a JSON 403, so the user lands on the friendly screen. Non-browser endpoints return generic `{ok: true}` / 400 so callers can't probe the allowlist.
- **`routes/users.py`** — Admin-only CRUD. `POST /users` invites + seeds default thread + best-effort branded welcome email. `GET /users/:id/footprint` powers the delete-confirm dialog. `DELETE /users/:id` cascades R2 → Qdrant (by owner_id) → events / people / threads / subscriptions → user.
- **`routes/events.py`** — CRUD + `POST/DELETE /events/:id/media/:key`. Reads include subscribed `visible=true` threads; writes still require thread ownership. `_serialize()` strips `owner_id`, signs R2 URLs, and embeds `people_display` for cross-user reads. `GET /events/years` returns `[{year, count}]` for the rail. `GET /events/search?q=…` is regex `$or` over `title`, `description`, `location.name/address`, `tags`; pre-resolves matching person names to **string** IDs (events store person refs as strings — ObjectIds in `$in` silently never match). Capped at `_MAX_PAGE_SIZE`; for semantic, use chat. Pagination contract is in invariants.
- **`routes/threads.py`** — `GET /threads` returns owned + subscribed (with `subscriber_count` / `subscription: {_id, visible}`). Sharing: `POST /threads/:id/invite` (invitee must already be a registered user), `GET/DELETE /threads/:id/subscribers/:user_id`. Subscriber-side: `PUT/DELETE /api/subscriptions/:id`. Flipping back to private wipes subscriptions immediately.
- **`routes/people.py`** — Per-user CRUD. Delete cascades through events to pull the person out and re-embed.
- **`routes/uploads.py`** — `POST /uploads/presign` (R2 PUT), `POST /uploads/extract-exif` (Pillow + pillow-heif → `{date, time, lat, lng}`), `POST /uploads/describe-photo` (Claude Haiku vision → `{title, description}`; bytes resized to ≤1568px first).
- **`routes/chat.py`** — SSE endpoint. Three flows: **create**, **edit**, **query**. Search (`_keyword_search`, `_hybrid_event_search`, `embedding_service.search`) takes `visible_thread_ids` so chat reaches shared-thread events. Edit restricts to owner-only threads. SSE events: `sources`, `token`, `event_created`, `event_updated`, `done`.
- **`routes/threads_io.py`** — Per-thread export/import (replaced the old wipe-and-restore `/api/backup`). `POST /threads/import` is **additive**: creates a new thread, dedupes incoming people by lowercased name, remaps person IDs, stamps new owner + thread, re-indexes in Qdrant. Media R2 keys preserved as-is (no copy — cross-account imports share storage). Tolerates legacy `photos[]` and `version: 1` whole-account exports.

### Chat intent flow

1. Full conversation transcript → `INTENT_SYSTEM` prompt → Anthropic JSON → `{intent, fields, missing_required, event_search}`
2. `missing_required` can include `title`, `date`, `location`, `description`, `people`. The LLM reads the transcript to avoid re-asking fields already requested in a previous turn.
3. **create**: if `missing_required` non-empty → clarify; else → insert to MongoDB (stamped with the user's oldest thread) + upsert to Qdrant + stream confirmation.
4. **edit**: semantic search for target event → apply `fields` changes → update MongoDB + Qdrant.
5. **query**: semantic search top-5 → RAG context injected into streaming Anthropic chat.

### Frontend (`frontend/src/`)

- **`api/`** — Thin fetch wrappers. `chat.js` manually parses SSE (request is POST, so no EventSource). `uploads.js` is the media pipeline: `extractExif`, `describePhoto`, `uploadMedia` (dispatches photo/video/audio/pdf), plus client-side `extractVideoPosterUrl` / `extractAudioWaveformUrl` / `extractPdfPosterUrl` (pdf page-1 render via pdf.js).
- **`store/index.js`** — Zustand. `useAuthStore` (session + role + user_id). `useEventStore` holds the bidirectionally-paginated timeline (events, filters incl. `thread_ids`, `hasMoreOlder/Newer`, anchorId). Actions: `appendOlder`, `prependNewer`, `jumpToWindow` (year-rail). Scroll restoration anchors on `data-event-id` via a **passive scroll listener** — not a `useEffect` cleanup, because React removes DOM nodes before the cleanup fires. `usePeopleStore` / `useThreadStore` / `useUserStore` are caches loaded once per session. `useChatStore` persists via localStorage keyed to `ownerId` so chat resets on sign-out.
- **`lib/confirm.jsx`** — `ConfirmProvider` + `useConfirm()` / `useAlert()` hooks replacing `window.confirm` / `window.alert` (see invariant). Wrapped around the router in `App.jsx`.
- **`lib/photoHandoff.js`** — One-shot in-memory slots that carry a File + in-flight caption Promise from `TimelineView` to `EventForm` during the photo capture flows. Cleared on consume.
- **`lib/pdfjs.js`** — Centralised pdf.js worker setup for `uploads.js` (page-1 thumb) and `EventDetail`'s `PdfViewer`. Imported as a side effect; sets `pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()` (see invariant on the `?worker` form vs `?url`).
- **`utils/date.js`** — All date formatting passes `timeZone: 'UTC'` to prevent day shift on UTC-midnight dates. `formatDateRange` handles optional end dates.
- **`utils/location.js`** — `locationDisplay()` handles legacy strings + `LocationDetail` objects. `locationMapUrl()` builds Google Maps links from coords or name.
- **`components/EventCard.jsx`** — Hover-lift `.event` tile. Meta row (thread swatch + name + "shared" badge) only renders when the user has >1 thread *or* the event is shared. `--cat-color` tracks the thread color (left border + swatch). Whole card clickable; tagged `data-event-id` (scroll anchor) and `data-event-date`.
- **`components/FilterBar.jsx`** — Older inline-chip filter UI; not currently mounted (`FilterModal` replaces it). Kept in case inline view comes back.
- **`components/FilterModal.jsx`** — Filter dialog from the toolbar. Manages a draft `{person_ids, thread_ids}` so cancel is non-destructive. **A `useEffect` resyncs the draft from `props.filters` every time `open` flips true** — load-bearing because the empty-state "Clear filters" CTA mutates filters from outside the modal.
- **`components/TimelineToolbar.jsx`** — Sticky toolbar on the timeline. Search input (debounced from `TimelineView`, `Esc` clears, `×` button), Filter with active count, "Add event" split button with EXIF-photo / AI-caption-photo flows in the dropdown. At ≤720px filter + add hide (duplicated as topbar portal icons) so search gets the full row.
- **`components/YearRail.jsx`** — Year spine with density bars from `GET /api/events/years`. Desktop: sticky vertical left column. ≤720px: sticky horizontal strip under the topbar via `grid-template-areas`. Auto-scrolls the active pill into view by walking up to the nearest scrolling ancestor (`.yearspine` desktop, `.yr-list` mobile) — never the page. **Publishes `--year-rail-h` via ref-callback ResizeObserver** (see invariant).
- **`components/BottomNav.jsx`** — Mobile-only fixed tab bar (Timeline / Chat) rendered globally. Honors `env(safe-area-inset-bottom)`. Hidden at >720px.
- **`components/BackToTop.jsx`** — Accent-circle FAB rendered by `TimelineView`. Visibility tracks `window.scrollY > threshold` (default 600px) via passive rAF-throttled listener; hidden state sets `pointer-events: none`. Smart `onClick`: when `hasMoreNewer` (year-jumped window) it refetches page-1 + resets the store; otherwise smooth-scrolls. Uses `document.scrollingElement.scrollTo({behavior:'smooth'})` with a 700ms `scrollTop = 0` fallback because a competing smooth scroll (e.g. YearRail's auto-correct) can cancel the window scroll mid-flight.
- **`components/LocationPicker.jsx`** — Leaflet + OSM with Nominatim geocoding (no API key, debounced 400ms). On mount, auto-geocodes name/address-without-coords and reverse-geocodes coords-without-name (so EXIF locations resolve to readable addresses).
- **`components/Topbar.jsx`** — Wordmark + nav + account chip (Google avatar `<img>` w/ initial-pill `onError` fallback, otherwise initial). Click opens dropdown: full name + email header, Settings / About / Sign out. **Publishes `--topbar-h` via ResizeObserver** (see invariant). Renders an empty `<div id="topbar-actions">` slot before the chip — pages portal contextual icons into it. At ≤720px nav hides (BottomNav takes over).
- **`components/Modal.jsx`** — Reusable dialog (Settings sections, user-delete confirm, thread-import). Eyebrow + serif headline + sub + close, body slot, right-aligned cancel + primary footer. Locks body scroll; Escape + scrim close. Enter inside `<form>` triggers primary (link via `form="..."`).
- **`pages/SettingsView.jsx`** — **Fixed-height console**: `.hs-settings-page` is `100vh - --topbar-h`, the rail (`.hs-rail`) scrolls independently, each section is `.hs-well-head` (static) + `.hs-well-body` (scrolling). On mount, fires idempotent `usePeopleStore.load()` + (admin) `useUserStore.load()` so rail counts are accurate on first paint. Per-thread Import/Export lives in the Threads tab — no standalone Backup section. **New subsections must wrap intro + rows in `<div className="hs-well-body">` or the content won't scroll.**
- **`pages/TimelineView.jsx`** — Two-column desktop: 140px rail + `.tl-col` wrapping head + feed. **`.tl-col` is pinned to `grid-column: 2`** — without it, when YearRail returns `null` (no events) the wrapper auto-flows into the empty rail column and squishes children into a narrow strip. Mobile collapses to `display: contents` with `grid-template-areas: "head" "rail" "feed"`. Portals filter + add icons into the topbar slot on mobile. `[data-year-marker={year}]` lives on the first month-header of each year (scrollspy + jump targets). Bidirectional infinite scroll: top sentinel `loadNewer` (with `useLayoutEffect` anchor preservation), bottom `loadOlder`. **Keyword search:** 250ms-debounced `GET /api/events/search`; substitutes `searchResults`, gates sentinels off, shows `searching…` then `no matches`, and a `railYears` memo collapses the rail to matching years. **Empty state:** centered `.tl-empty` block — "No events yet." + `+ Add event` for empty DB, "Nothing fits those filters." + `Clear filters` when filtered. **Mobile band-hide:** rAF listener with 6px deadband toggles `.tl-band-hidden` on `<html>` to slide rail + toolbar off-screen on scroll-down.
- **`pages/ChatView.jsx`** — Mirrors the Timeline shell: fixed-height `.chat-page`, "Chat." headline, `+ New chat` button. `.chat-thread` scrolls (messages `max-width: 820px`). `.composer` pinned at bottom (backdrop-blurred pill input + accent send button). Empty state: serif "What do you want to know?" — no suggestion chips.
- **`pages/EventDetail.jsx`** — On load, geocodes location-without-coords via Nominatim into `displayLocation` (display-only). Media split: photos + videos in a grid with lightbox; audio in its own inline-player strip; PDFs in `.detail-pdf-list` with a `PdfViewer` (react-pdf) per row that does prev/next paging and sizes the canvas to container width via ResizeObserver. Edit/Delete hidden for shared events (`event.is_owner === false`).
- **`pages/AboutView.jsx`** — `/about` build-verification page (linked from user menu). Reads `__BUILD_COMMIT__` + `__BUILD_TIME__` (injected by `vite.config.js`) and renders short SHA (linking to GitHub) + timestamp. Use to confirm which bundle a browser session is running when CDN caching disagrees with the deploy.
- **`pages/PrivacyView.jsx`** — `/privacy` policy page, linked from the landing footer. Reachable from both the unauthenticated shell (UnauthedShell pathname sniff) and authenticated tree (`<Route path="/privacy">`). Has its own brandmark + wordmark at the top so it reads as part of the app. **Bump `LAST_UPDATED` when the policy text changes.**
- **`pages/NotFoundView.jsx`** — `<Route path="*">` 404 catchall inside the authenticated `<Routes>` (must stay last). Unauthenticated shell does NOT 404 unknown URLs — falls through to LandingPage so a signed-out deep link still hits the sign-in CTA.
- **`components/ErrorBoundary.jsx`** — Class component wrapping both authenticated `<BrowserRouter>` and `<UnauthedShell>`. Renders a branded fallback with Reload / Back-to-home + collapsed `<details>` stack. **Does NOT catch async errors** (promise rejections, event handlers) — outside React's contract. `componentDidCatch` is where Sentry etc. plugs in later.

### Tools (`tools/`)

- **`import_dayone.py`** — One-off importer that reads a Day One JSON export zip and creates one event per entry via the live API. Maps title from `richText` header blocks with a Claude Haiku fallback for the older untitled entries, maps tags to event types via a small heuristic, mirrors locations, and uploads photos (Pillow-resized to 2000px + 400px thumb), videos (ffmpeg-extracted poster), and audio (no thumb). Idempotent via a `dayone:<uuid>` tag, so re-runs after a crash resume cleanly. See the file's docstring for the full usage; requires `pip install -r tools/requirements.txt` and `ffmpeg` on PATH.

### Key invariants

- **Multi-tenant isolation.** Every owned record (events / people / threads) carries an `owner_id`. Every CRUD route filters by the current user; new queries that omit the owner filter are bugs. `require_auth` returns the user dict (not just email); use `current_user["_id"]` in handlers.
- **Every event has a `thread_id`** pointing at a thread that exists. New events default to the user's oldest thread when omitted (used by the Day One importer and chat-create); thread import always stamps every event into the freshly-created target thread. A user's last thread can't be deleted (events need a thread); a thread with events can't be deleted (must move events first).
- **Sharing is thread-level + read-only.** `thread.visibility` ∈ {`private`, `shared`}. Reads cascade across tenants via `thread_id IN (owned ∪ subscribed-visible)`; writes still require the writer to own the thread. Flipping a thread back to private wipes existing subscriptions immediately. Cross-user reads denormalize the owner's people names (`people_display`) onto the response so the viewer's UI works without the owner's people store. Thread name + color are resolved client-side from the viewer's `useThreadStore` — the subscriber already has the thread record because they're subscribed to it.
- **Dates** are always stored as UTC in MongoDB. The form builds ISO strings as `${date}T${time}:00.000Z`. Display always uses `timeZone: 'UTC'`.
- **Location** is stored as `{name, address, lat, lng}`. Legacy string locations in the DB are normalised on every read in `_serialize` / `_serialize_doc`. Frontend helpers also handle the string case.
- **Media** is stored as `media[]` with each item carrying `kind` ∈ {photo, video, audio, pdf}, an R2 `key`, an optional `thumb_key`, and dimensions / duration / page_count (PDFs). A startup migration converted any pre-existing `photos[]` field; `_serialize` still falls back to `photos[]` for safety. Thumbnails (photo thumbs, video posters, audio waveforms, PDF page-1 renders) are rendered client-side via canvas / Web Audio / pdf.js and uploaded as separate R2 objects. PDFs are excluded from the photo lightbox and rendered in `EventDetail`'s dedicated `.detail-pdf-list` with a react-pdf-driven multi-page viewer per row.
- **`GET /events` is bidirectionally paginated when `limit` is set.** `before_date`+`before_id` returns older events (sorts DESC). `after_date`+`after_id` returns newer events — handler sorts ASC + reverses so the response carries the events *closest* to the cursor on the newer side rather than the newest events overall. Don't collapse upward queries back to a single DESC sort; the year-rail's scroll-up direction depends on this. Without `limit` the endpoint returns all events ascending — the contract `tools/import_dayone.py` relies on, don't remove it.
- **Year-rail jumps straddle the target year.** `handleJumpToYear` in `TimelineView` first checks whether the year's `[data-year-marker]` is already in the DOM — if yes, just `scrollIntoView` and we're done (this branch is what keeps year clicks inside the current search results when search mode is active; clicking a year shown on the rail scrolls within the matches instead of dropping out of search). Otherwise — and only then — exit search mode if active and run two parallel `GET /events` requests (one `before_date`, one `after_date`, both at `Jan 1 of year+1`) and merge the results so the user lands in the middle of a window with newer-year context above and older-year context below. Top + bottom sentinels then extend the window in either direction. Replacing this with a single before-fetch leaves the user with no upward context. The jump uses a dedicated `jumping` state (**not** `loading`) — `loading=true` swaps the events list for a "loading…" placeholder, which removes every `[data-year-marker]` from the DOM, so the subsequent `scrollIntoView` silently falls back to `scrollTo(0,0)` and the user lands on the newest event in the window instead of the target year. With `jumping`, the previous events list stays rendered during the fetch, then `jumpToWindow` swaps it for the new window; the top + bottom sentinel observers are gated on `!jumping` so they don't mount until after the scroll settles. After updating the store, `handleJumpToYear` **awaits two `requestAnimationFrame` paints in-line** (one for React's commit so the *new* `[data-year-marker]` exists, one for the `scrollIntoView` to take effect) *before* `finally` clears `jumping` — otherwise the top sentinel mounts at scroll 0 and fires `loadNewer`, prepending a third page that pushes the user off the year they clicked. Don't move the scroll back into a fire-and-forget `requestAnimationFrame`, and don't swap `jumping` back to `loading`.
- **Active year tracking uses `[data-year-marker]` elements**, not event cards. The active year is the last marker whose `getBoundingClientRect().top <= topbarH + 24px`. Card-based tracking has a frame-off blind spot at year boundaries — don't reintroduce it.
- **Sticky topbar offset `--topbar-h` is runtime-measured**, not a fixed token. The `:root` value (80px) is just a fallback; `Topbar` writes the actual `getBoundingClientRect().height` to `--topbar-h` on mount and on every resize via `ResizeObserver`, so the variable tracks the real topbar across desktop/tablet/phone. Consumed by `.tl-toolbar` and `.yearspine` sticky `top:`, `.tl-month` + `.event` `scroll-margin-top`, the fixed-height `.hs-settings-page` and `.chat-page` shells, and the runtime scrollspy threshold in `TimelineView`. Don't replace the ResizeObserver with a static value — the topbar's height differs by breakpoint and the previous hardcoded 80px left a sub-pixel gap on phone that bled scrolled-under content.
- **`--year-rail-h` is runtime-measured too**, set by a **ref-callback** ResizeObserver in `YearRail` (not a `useEffect` — the rail returns `null` until `years` loads, so `[]`-deps effects fire once with no DOM node and never re-run). The mobile `.tl-toolbar` consumes it as `top: calc(var(--topbar-h) + var(--year-rail-h, 0px))` to stick directly below the horizontal rail strip. Falling back to `0px` would tuck the search input behind the rail — don't break the ref-callback pattern.
- **Mobile bottom-nav reserves space via `--bottom-nav-h`** on `:root` (0 by default, 64px at ≤720px). Subtracted from `.chat-page` and `.hs-settings-page`'s `100dvh - var(--topbar-h) - var(--bottom-nav-h)` height calcs so the chat composer + settings rail don't slide under the tab bar. Use `100dvh` (with a `100vh` declaration first as a fallback for older browsers) — `100vh` on iOS reports the *large* viewport (URL bar hidden), so the shell overflowed under the bottom-nav whenever the bar was visible. New full-viewport shells must use the same `100vh`-then-`100dvh` pair and subtract both vars.
- **Mobile form inputs are 16px** via a single `@media (max-width: 720px)` block at the **very bottom** of `frontend/src/index.css`. iOS Safari + Chrome auto-zoom whenever a focused input has `font-size < 16px` — that's what made the chat composer, login email, timeline search, and Settings modals zoom in the moment the virtual keyboard appeared (and what made LoginView land already-zoomed on first paint because of its `autoFocus`). The bottom-of-file location is load-bearing: most form-input rules higher up (`.input`, `.composer-input textarea`, `.tl-search input`, `.hs-modal-body .field-input`, etc.) are specificity 0,1,1 or 0,2,1, and a `font-size: 16px` declaration earlier in the file ties on specificity but loses on source order. **When you add a new form input with `font-size < 16px`, add its selector to the override block** (search for `iOS zoom-on-focus prevention`). The override deliberately doesn't use `!important` so individual pages can opt out if they ever need to.
- **Qdrant payloads carry `thread_id`** so chat semantic search can filter by visible threads. A one-shot `set_payload` migration on startup backfills any pre-Phase-2 points. New writes carry the field automatically because `_serialize` includes it.
- **nginx body limit** is bumped to 50 MB in `frontend/nginx.conf` so iPhone JPEGs and HEICs flow through the proxy on the EXIF / caption endpoints. Direct-to-R2 PUTs (the actual file upload) bypass nginx via presign and aren't affected by this limit.
- **R2 CORS** must include every origin that will PUT to the bucket; see `wrangler r2 bucket cors list timeline-photos`. Without the prod origin in the allowlist, uploads silently fail with a CORS error and only the metadata calls succeed.
- **pdf.js worker uses Vite's `?worker` form, not `?url`.** `lib/pdfjs.js` does `import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker'` and sets `pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()`. The `?url` form (which sets `workerSrc` to a `.mjs` URL) breaks production: alpine nginx serves `.mjs` as `application/octet-stream`, and the browser refuses to instantiate a module worker from a non-JS MIME type — both the upload-time page-1 thumbnail (`extractPdfPosterUrl`) and the inline viewer fail silently / with "Could not load PDF". `frontend/nginx.conf` also has a `.mjs → text/javascript` location override as belt-and-suspenders for any future ESM worker. Don't switch back to `?url`.
- **Qdrant point IDs** are `uuid5` of the MongoDB `_id` string — never random, so upsert is idempotent.
- **SSE buffering** is disabled in nginx (`proxy_buffering off`) so tokens reach the browser without delay.
- **No `window.confirm` / `window.alert`** in the frontend. Use `useConfirm()` / `useAlert()` from `lib/confirm.jsx` so dialogs match the rest of the app.
- **`/unauthorized` is a coordinated handoff** between backend and frontend, not a React Router route. The backend's browser-facing sign-in endpoints (Google OAuth callback + magic-link verify) 302 to `{APP_BASE_URL}/unauthorized?email=…` whenever the address isn't on the allowlist. The frontend's `UnauthedShell` in `App.jsx` sniffs `window.location.pathname` on mount and renders `pages/UnauthorizedView.jsx` (the friendly "Not on the list" screen) — the page exists *only* in the unauthenticated shell, not inside `<BrowserRouter>`, because by definition a 302-redirected user is unauthenticated. The "Use a different email" / "Back to home" CTAs `replaceState('/')` to scrub the URL before switching modes. If you add a new auth path that can reject an already-redirected-from-OAuth user, redirect to `/unauthorized` too — never raise an HTTPException that the browser would land on directly.
- **`UnauthedShell` pathname-sniffs for multiple unauthenticated routes**, not just `/unauthorized`. It currently handles `/privacy` (renders `pages/PrivacyView.jsx`) and `/unauthorized` (`pages/UnauthorizedView.jsx`); anything else falls through to LoginView / LandingPage. Any new public-but-no-auth-needed page (e.g. `/terms`) belongs here too — add a pathname check before the existing `if (showUnauthorized)` block, **after** the `useState` calls (the early-return-before-hooks bug is easy to reintroduce; the comment in `UnauthedShell` flags it). Same page component should ALSO be mounted as a `<Route>` inside the authenticated `<BrowserRouter>` so signed-in users can reach it too — `App.jsx` does this for both `/privacy` and `/unauthorized` already.
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
  -d '{"title":"Test","date":"2024-01-01T00:00:00.000Z"}'

# Delete it (use the _id from the create response)
curl -X DELETE http://localhost:8000/api/events/<id>
```
