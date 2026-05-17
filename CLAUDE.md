# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisites (host machine)

Two API keys must be exported before `docker compose up` (or written to a `.env` file in the project root, which compose reads automatically):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

- `ANTHROPIC_API_KEY` powers chat (default model `claude-sonnet-4-6`).
- `OPENAI_API_KEY` powers vector embeddings (default model `text-embedding-3-small`, 1536 dims).

Optional overrides: `ANTHROPIC_MODEL`, `OPENAI_EMBED_MODEL`. Changing the embedding model changes vector dimensions — see "Changing models" below.

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
- **Photos:** R2 is shared between dev and prod — there is no separate dev bucket. Test uploads land in the prod bucket, so clean them up.
- **`/api` routing:** the Cloudflare Pages Function at `frontend/functions/api/[[path]].js` only runs in production. Locally, nginx (Docker frontend) or the Vite dev server proxy (`vite.config.js`) handles `/api/*` → `localhost:8000`.

## Architecture overview

### Services

| Service | Tech | Port |
|---------|------|------|
| Frontend | React 18 + Vite + Tailwind CSS | 3000 (nginx in Docker) |
| Backend | FastAPI + Uvicorn | 8000 |
| MongoDB | Motor (async driver) | 27017 |
| Qdrant | Vector DB for semantic search | 6333 |
| Anthropic API | Chat (Claude Sonnet 4.6 by default) | — |
| OpenAI API | Embeddings (text-embedding-3-small, 1536-dim) | — |

Persistent data lives in `./data/mongo` and `./data/qdrant`.

### Backend (`backend/`)

- **`main.py`** — FastAPI app with lifespan. On startup: ensures Qdrant collection exists, seeds MongoDB with sample events if empty, syncs any unindexed events to Qdrant. Registers the events and chat routers.
- **`database.py`** — Motor async client; exposes `events_collection` (the single collection used throughout).
- **`models.py`** — Pydantic models: `EventBase` / `EventCreate` / `EventUpdate` / `Event`. The `LocationDetail` model (`{name, address, lat, lng}`) is the canonical location type; legacy string locations are normalised to this shape on read in both `_serialize` functions.
- **`embeddings.py`** — `EmbeddingService` wraps Qdrant + the OpenAI embeddings API (`text-embedding-3-small`, 1536-dim vectors). Point IDs are `uuid5(NAMESPACE_DNS, mongo_id_string)` for deterministic, collision-free IDs. `ensure_collection()` detects vector-dimension mismatches against the stored Qdrant collection and drops + recreates so events get re-embedded by the startup sync loop in `main.py`. Uses `query_points()` (not the removed `search()`) from qdrant-client ≥1.7.
- **`routes/events.py`** — Standard CRUD. `_serialize()` converts ObjectId→str, datetimes→ISO, and normalises legacy string locations.
- **`routes/chat.py`** — SSE streaming endpoint. Three flows: **create**, **edit**, **query**. Intent is detected via a non-streaming Anthropic call (`_anthropic_json`) and parsed as JSON. The full conversation transcript is sent each turn so the model can track multi-turn state. Static system prompts (INTENT_SYSTEM, TIMELINE_SYSTEM, DECOMPOSE_SYSTEM, etc.) get top-level `cache_control: ephemeral` so repeat calls hit the prompt cache. SSE event types: `sources`, `token`, `event_created`, `event_updated`, `done`.

### Chat intent flow

1. Full conversation transcript → `INTENT_SYSTEM` prompt → Anthropic JSON → `{intent, fields, missing_required, event_search}`
2. `missing_required` can include `title`, `date`, `event_type`, `location`, `description`. The LLM reads the transcript to avoid re-asking fields already requested in a previous turn.
3. **create**: if `missing_required` non-empty → clarify; else → insert to MongoDB + upsert to Qdrant + stream confirmation.
4. **edit**: semantic search for target event → apply `fields` changes → update MongoDB + Qdrant.
5. **query**: semantic search top-5 → RAG context injected into streaming Anthropic chat.

### Frontend (`frontend/src/`)

- **`api/`** — Thin fetch wrappers. `chat.js` manually parses the SSE stream (no EventSource, since the request is a POST). `events.js` is standard REST.
- **`store/index.js`** — Zustand store for events list + filters; used by `TimelineView`.
- **`utils/date.js`** — All date formatting passes `timeZone: 'UTC'` to prevent local-timezone day shift on UTC-midnight dates. `formatDateRange(startIso, endIso)` handles optional end dates.
- **`utils/location.js`** — `locationDisplay()` handles both legacy strings and `LocationDetail` objects. `locationMapUrl()` builds Google Maps links from coords or name.
- **`components/LocationPicker.jsx`** — Leaflet + OpenStreetMap map with Nominatim geocoding (no API key). On mount, auto-geocodes a value that has name/address but no coords. Nominatim search is debounced 400ms.
- **`pages/EventDetail.jsx`** — On load, if the event has a location name/address but no coords, geocodes via Nominatim and stores the result in `displayLocation` (display-only, not saved back to the server).

### Key invariants

- **Dates** are always stored as UTC in MongoDB. The form builds ISO strings as `${date}T${time}:00.000Z`. Display always uses `timeZone: 'UTC'`.
- **Location** is stored as `{name, address, lat, lng}`. Legacy string locations in the DB are normalised on every read in `_serialize` / `_serialize_doc`. Frontend helpers also handle the string case.
- **Qdrant point IDs** are `uuid5` of the MongoDB `_id` string — never random, so upsert is idempotent.
- **SSE buffering** is disabled in nginx (`proxy_buffering off`) so tokens reach the browser without delay.

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
