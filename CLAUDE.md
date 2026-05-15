# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisites (host machine)

Ollama must be running natively on the host before any Docker services start:

```bash
ollama serve
ollama pull mistral
ollama pull nomic-embed-text
```

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

## Architecture overview

### Services

| Service | Tech | Port |
|---------|------|------|
| Frontend | React 18 + Vite + Tailwind CSS | 3000 (nginx in Docker) |
| Backend | FastAPI + Uvicorn | 8000 |
| MongoDB | Motor (async driver) | 27017 |
| Qdrant | Vector DB for semantic search | 6333 |
| Ollama | LLM + embeddings (host process) | 11434 |

Persistent data lives in `./data/mongo` and `./data/qdrant`. Ollama models are in `~/.ollama`.

### Backend (`backend/`)

- **`main.py`** — FastAPI app with lifespan. On startup: ensures Qdrant collection exists, seeds MongoDB with sample events if empty, syncs any unindexed events to Qdrant. Registers the events and chat routers.
- **`database.py`** — Motor async client; exposes `events_collection` (the single collection used throughout).
- **`models.py`** — Pydantic models: `EventBase` / `EventCreate` / `EventUpdate` / `Event`. The `LocationDetail` model (`{name, address, lat, lng}`) is the canonical location type; legacy string locations are normalised to this shape on read in both `_serialize` functions.
- **`embeddings.py`** — `EmbeddingService` wraps Qdrant. Uses `nomic-embed-text` (768-dim vectors). Point IDs are `uuid5(NAMESPACE_DNS, mongo_id_string)` for deterministic, collision-free IDs. Uses `query_points()` (not the removed `search()`) from qdrant-client ≥1.7.
- **`routes/events.py`** — Standard CRUD. `_serialize()` converts ObjectId→str, datetimes→ISO, and normalises legacy string locations.
- **`routes/chat.py`** — SSE streaming endpoint. Three flows: **create**, **edit**, **query**. Intent is detected via a non-streaming Ollama JSON-mode call (`_ollama_json`). The full conversation transcript is sent each turn so the model can track multi-turn state. SSE event types: `sources`, `token`, `event_created`, `event_updated`, `done`.

### Chat intent flow

1. Full conversation transcript → `INTENT_SYSTEM` prompt → Ollama JSON → `{intent, fields, missing_required, event_search}`
2. `missing_required` can include `title`, `date`, `event_type`, `location`, `description`. The LLM reads the transcript to avoid re-asking fields already requested in a previous turn.
3. **create**: if `missing_required` non-empty → clarify; else → insert to MongoDB + upsert to Qdrant + stream confirmation.
4. **edit**: semantic search for target event → apply `fields` changes → update MongoDB + Qdrant.
5. **query**: semantic search top-5 → RAG context injected into streaming Ollama chat.

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

Set `OLLAMA_MODEL` or `OLLAMA_EMBED_MODEL` in `docker-compose.yml`. **Changing the embedding model requires clearing Qdrant** since vector dimensions will differ:

```bash
docker compose down
rm -rf ./data/qdrant
docker compose up --build
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
