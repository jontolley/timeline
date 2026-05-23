# Personal Timeline

A self-hosted timeline for personal life events with AI-powered chat. Add events by typing into a chat box, search and ask questions across your history with semantic retrieval, attach photos, and tag people. Built as a small family-scale project.

## Stack

- **Frontend:** React 18 + Vite + Tailwind, served from nginx in Docker
- **Backend:** FastAPI + Uvicorn (Python 3.12)
- **Database:** MongoDB (events, people)
- **Vector search:** Qdrant (semantic retrieval for chat)
- **Chat:** Anthropic Claude (default: Sonnet 4.6 for chat, Haiku 4.5 for photo captions)
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim)
- **Media storage:** Cloudflare R2 (photos, videos, audio)
- **Auth:** magic-link email via Resend

## Quick start

You need Docker Desktop running, plus an Anthropic API key and an OpenAI API key.

```bash
git clone <this-repo>
cd personal-timeline
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY, OPENAI_API_KEY, and ALLOWED_EMAIL.
# For local-only experimentation you can also set AUTH_DISABLED=true to skip
# the magic-link flow entirely.

docker compose up --build
```

Then open <http://localhost:3000>.

- **Frontend:** <http://localhost:3000>
- **Backend API:** <http://localhost:8000>
- **Health check:** <http://localhost:8000/api/health>

To stop everything: `docker compose down`. Data persists in `./data/mongo` and `./data/qdrant`.

## Features

- **Chat-driven event entry.** "Add a trip to Tokyo last March with Sam" creates an event with the right type, date, and people. Relative dates ("3 days ago", "last June") are resolved against today's date.
- **Photo-driven event entry.** Drop a photo, get an event with the date and GPS pre-filled from EXIF; optionally have Claude vision generate the title and description from the image.
- **Photo, video, and audio attachments.** Upload to any event; videos get a poster frame and audio gets a waveform thumbnail, both rendered client-side.
- **Semantic search via chat.** "Where have I travelled in the last two years?" hits a Qdrant nearest-neighbour search and feeds the matches to Claude as context.
- **People with color coding.** Attach people to events; filter the timeline by who was there.
- **Day One importer.** A standalone script (`tools/import_dayone.py`) ingests a Day One JSON export — entries, locations, photos, videos, audio — with Claude-summarized titles for entries that don't have one.
- **Paginated timeline.** Loads 20 events at a time; remembers scroll position across event-detail navigation.
- **Magic-link auth.** Email allowlist + Resend-delivered sign-in links, no passwords.
- **Backup/restore.** Lossless JSON export, with a confirmation-gated restore.
- **Mobile-friendly.** Responsive layout tested on phone and desktop.

## Documentation

- [**CLAUDE.md**](./CLAUDE.md) — full architecture overview, file layout, key invariants, and the local-dev-vs-production conventions. Read this if you're going to make changes.
- [**.env.example**](./.env.example) — every environment variable, with comments.

## Deployment

This repo includes deployment configs for the stack used by the original author:

- `backend/fly.toml` — backend on Fly.io
- `infra/qdrant/fly.toml` — Qdrant on Fly with a mounted volume for the vector index
- `frontend/functions/api/[[path]].js` — Cloudflare Pages Function that proxies `/api/*` to the Fly backend so the site stays same-origin (cookies + no CORS gymnastics)
- MongoDB is on Atlas (M0 free tier)

See `CLAUDE.md > Local dev vs. production` for the boundaries between the dockerized dev stack and the deployed stack.

## License

Personal project; use at your own risk. No warranty implied.
