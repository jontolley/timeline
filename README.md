# Hindsite

> Look back, on purpose.

A self-hosted timeline for personal life events with AI-powered chat. Add events by typing into a chat box, search and ask questions across your history with semantic retrieval, attach photos, and tag people. Built as a small family-scale project — multiple users can share one deployment, each with their own private timeline, and selectively share threads with each other.

The repo and package are still named `personal-timeline`; **Hindsite** is the user-facing brand.

## Stack

- **Frontend:** React 18 + Vite, plain CSS design system (Instrument Serif + Geist + JetBrains Mono), served from nginx in Docker
- **Backend:** FastAPI + Uvicorn (Python 3.12)
- **Database:** MongoDB (events, people)
- **Vector search:** Qdrant (semantic retrieval for chat)
- **Chat:** Anthropic Claude (default: Sonnet 4.6 for chat, Haiku 4.5 for photo captions)
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim)
- **Media storage:** Cloudflare R2 (photos, videos, audio)
- **Auth:** Google OAuth or magic-link email (via Resend); per-user data isolation managed in-app

## Quick start

You need Docker Desktop running, plus an Anthropic API key and an OpenAI API key.

```bash
git clone <this-repo>
cd personal-timeline
cp .env.example .env
# Edit .env — at minimum set ANTHROPIC_API_KEY, OPENAI_API_KEY, and ALLOWED_EMAIL
# (used once to seed the first admin user; afterwards the users collection IS
# the allowlist and admins invite new users from Settings → Users).
# Optional: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to enable Sign in with Google.
# For local-only experimentation you can also set AUTH_DISABLED=true to skip
# auth entirely.

docker compose up --build
```

Then open <http://localhost:3000>.

- **Frontend:** <http://localhost:3000>
- **Backend API:** <http://localhost:8000>
- **Health check:** <http://localhost:8000/api/health>

To stop everything: `docker compose down`. Data persists in `./data/mongo` and `./data/qdrant`.

## Features

- **Multi-user with private timelines.** Each user has their own events, people, categories, threads, and media — hard isolation across the data layer. Admins invite people from Settings → Users (or, in dev, they're seeded from the `ALLOWED_EMAIL` env var on first boot).
- **Threads + selective sharing.** Group events into threads (e.g. "Family travels", "Work"). Mark a thread shared and invite specific users — they see its events on their own timeline (read-only) and can toggle visibility per-thread.
- **Chat-driven event entry.** "Add a trip to Tokyo last March with Sam" creates an event with the right type, date, and people. Relative dates ("3 days ago", "last June") are resolved against today's date.
- **Photo-driven event entry.** Drop a photo, get an event with the date and GPS pre-filled from EXIF; optionally have Claude vision generate the title and description from the image.
- **Photo, video, and audio attachments.** Upload to any event; videos get a poster frame and audio gets a waveform thumbnail, both rendered client-side.
- **Semantic search via chat.** "Where have I travelled in the last two years?" hits a Qdrant nearest-neighbour search across your visible threads (own + subscribed) and feeds the matches to Claude as context.
- **Keyword search on the timeline.** A toolbar search box runs a case-insensitive substring match across event title, description, location name/address, tags, and person names (debounced live as you type, no Claude/Qdrant involvement). Active filter chips narrow the results.
- **People with color coding.** Attach people to events; filter the timeline by who was there.
- **Categories.** Each user has their own editable category set with palette colors; events carry the slug, the UI renders the owner's label/color (even on cross-user shared events).
- **Day One importer.** A standalone script (`tools/import_dayone.py`) ingests a Day One JSON export — entries, locations, photos, videos, audio — with Claude-summarized titles for entries that don't have one.
- **Paginated timeline with year navigation.** Events group year → month → day with editorial month headers and a per-day date column. A sticky **year spine** on the left shows every year with a density bar (filter-aware) and jumps you directly to the first month of that year; scrolling back up lazily loads the years in between. Loads 20 events at a time in either direction. Scroll position is preserved across event-detail navigation.
- **Auth.** Sign in with Google OAuth or a magic-link email. The users collection is the live allowlist — adding a user is an admin action in-app.
- **Backup/restore.** Lossless JSON export scoped to the current user, with a confirmation-gated restore.
- **Mobile-friendly.** Responsive layout tested on phone and desktop.

## Documentation

- [**CLAUDE.md**](./CLAUDE.md) — full architecture overview, file layout, key invariants, and the local-dev-vs-production conventions. Read this if you're going to make changes.
- [**.env.example**](./.env.example) — every environment variable, with comments.

## Deployment

The author's live deployment is at <https://hindsite.pages.dev>. This repo includes everything to host your own:

- `backend/fly.toml` — backend on Fly.io
- `infra/qdrant/fly.toml` — Qdrant on Fly with a mounted volume for the vector index
- `frontend/functions/api/[[path]].js` — Cloudflare Pages Function that proxies `/api/*` to the Fly backend so the site stays same-origin (cookies + no CORS gymnastics)
- MongoDB is on Atlas (M0 free tier)

The frontend Pages project is Git-connected, so `git push origin main` auto-deploys; backend + Qdrant deploys are manual `fly deploy` from their respective directories.

See `CLAUDE.md > Local dev vs. production` and `CLAUDE.md > Deployment` for the boundaries between the dockerized dev stack and the deployed stack, plus the exact deploy + verification commands.

## License

[MIT](./LICENSE) — do what you want with the code, just keep the copyright notice and don't hold me liable.
