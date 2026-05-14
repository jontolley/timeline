# Personal Timeline

A personal life-event timeline with AI-powered chat, powered by FastAPI, React, MongoDB, Qdrant, and Ollama.

## Prerequisites

- Docker Desktop installed and running
- Homebrew installed

Run these commands **before** starting the app:

```bash
brew install ollama
ollama serve                      # start Ollama as a background service
ollama pull mistral
ollama pull nomic-embed-text
```

Ollama must be running on the host before Docker services start.

## Starting the app

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- Health check: http://localhost:8000/api/health

## Stopping the app

```bash
docker compose down
```

## Where data lives

| Data | Location |
|------|----------|
| MongoDB events | `./data/mongo` |
| Qdrant vectors | `./data/qdrant` |
| Ollama models | `~/.ollama` (managed natively by Ollama) |

## Swapping the chat model

Change `OLLAMA_MODEL` in `docker-compose.yml` to any model you have pulled locally (e.g. `llama3`, `phi3`, `gemma2`). Pull it first:

```bash
ollama pull llama3
```

Then restart:

```bash
docker compose up --build
```

## Changing the embedding model

Change `OLLAMA_EMBED_MODEL` in `docker-compose.yml`. **Note:** changing embedding models requires clearing `./data/qdrant` and re-indexing, since vector dimensions may differ.

```bash
docker compose down
rm -rf ./data/qdrant
ollama pull <new-embed-model>
docker compose up --build
```

## Hardware note

Mistral 7B requires ~5 GB RAM. With 16 GB unified memory on Apple Silicon, this leaves comfortable headroom for the Docker services. Ollama uses Metal GPU acceleration automatically on M-series Macs.
