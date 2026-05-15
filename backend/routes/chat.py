import os
import json
import re
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bson import ObjectId

from embeddings import EmbeddingService
from database import events_collection

router = APIRouter(prefix="/api/chat")
embedding_service = EmbeddingService()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

TIMELINE_SYSTEM = (
    "You are a helpful assistant with access to the user's personal life timeline. "
    "Answer questions using only the timeline events provided. "
    "If the answer isn't in the provided events, say so honestly. "
    "Be warm, personal, and concise."
)

INTENT_SYSTEM = """You are an intent classifier for a personal timeline assistant.
Read the full conversation and output ONLY valid JSON — no markdown, no explanation.

Schema:
{
  "intent": "create" | "edit" | "query",
  "fields": {
    "title": string or null,
    "date": "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (if time mentioned) or null,
    "end_date": "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" or null,
    "event_type": "career" | "travel" | "milestone" | "family" or null,
    "description": string or null,
    "location": { "name": string or null, "address": string or null } or null,
    "tags": [string] or null
  },
  "missing_required": ["title", "date", "event_type", "location", "description"],
  "event_search": string or null
}

Rules:
- intent=create  → user wants to add / log / record a new event
- intent=edit    → user wants to update / change / modify an existing event
- intent=query   → everything else (questions, search, general chat)
- missing_required: list fields that should still be collected before creating the event:
  * Always include "title", "date", "event_type" if not yet provided by the user
  * Include "location" ONLY IF: location has not been provided AND the assistant has not already asked for location in this conversation
  * Include "description" ONLY IF: description has not been provided AND the assistant has not already asked for description in this conversation
  * Do NOT re-add "location" or "description" if the assistant already asked and the user skipped or ignored them
- Infer event_type from context when obvious: job/promotion/startup → career,
  trip/travel/visit/journey → travel, graduation/marriage/achievement → milestone,
  wedding/birth/family reunion/parenting → family
- Convert relative dates ("last June", "two years ago", "in 2019") to YYYY-MM-DD
- event_search: short phrase describing which event to find, for edit intent
- tags: split any comma- or space-separated tags into an array
- location: extract place name and/or address if mentioned; lat/lng are always null (set via map in UI)
- end_date: populate when user mentions a duration, end date, or range (e.g. "from June 1 to June 10", "two-week trip ending March 5")"""

CLARIFY_SYSTEM = (
    "You help users log personal life events on their timeline. "
    "Some information is still missing or would enrich the event. "
    "Ask for it naturally and conversationally — ask for the most important missing piece first, "
    "then mention optional ones (location, description) briefly on the same turn if relevant. "
    "Make clear that location and description are optional — the user can say 'skip' or 'none'. "
    "Be warm, brief, and encouraging. Don't repeat what's already been provided."
)

CONFIRM_EDIT_SYSTEM = (
    "You help users edit personal life events on their timeline. "
    "You found the event they mean but they haven't said what to change. "
    "Show them the current event details and ask warmly what they'd like to update. Be brief."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_doc(doc: dict) -> dict:
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    for field in ("date", "end_date", "created_at", "updated_at"):
        val = doc.get(field)
        if isinstance(val, datetime):
            if val.tzinfo is None:
                val = val.replace(tzinfo=timezone.utc)
            doc[field] = val.isoformat()
    return doc


def _format_event_line(e: dict) -> str:
    date = str(e.get("date", ""))[:10]
    etype = e.get("event_type", "").capitalize()
    title = e.get("title", "")
    location = e.get("location", "")
    tags = " ".join(f"#{t}" for t in (e.get("tags") or []))
    parts = [f"[{date}] {etype}: {title}"]
    if location:
        parts.append(f"({location})")
    if tags:
        parts.append(tags)
    return " ".join(parts)


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _parse_date(date_str: str) -> datetime:
    """Parse YYYY-MM-DD or YYYY-MM-DDTHH:MM from the LLM, always returning a UTC datetime."""
    try:
        if "T" in date_str:
            return datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
        return datetime.fromisoformat(date_str + "T00:00:00").replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


async def _ollama_json(system: str, user_content: str) -> dict:
    """Non-streaming Ollama call that returns parsed JSON."""
    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "format": "json",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_content},
                ],
            },
        )
        resp.raise_for_status()
        raw = resp.json()["message"]["content"]
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        return json.loads(match.group() if match else raw)


STOP_WORDS = {
    "a", "an", "the", "my", "your", "our", "for", "to", "of", "in", "on", "at",
    "with", "and", "or", "but", "i", "me", "we", "us", "is", "was", "are", "were",
    "edit", "update", "change", "modify", "event",
}


def _extract_keywords(query: str) -> list[str]:
    return [
        w for w in re.findall(r"\w+", query.lower())
        if len(w) > 1 and w not in STOP_WORDS
    ]


def _doc_text(doc: dict) -> str:
    loc = doc.get("location")
    if isinstance(loc, dict):
        loc_text = " ".join(str(loc.get(k) or "") for k in ("name", "address"))
    elif isinstance(loc, str):
        loc_text = loc
    else:
        loc_text = ""
    return " ".join([
        str(doc.get("title") or ""),
        str(doc.get("description") or ""),
        loc_text,
        " ".join(doc.get("tags") or []),
    ]).lower()


async def _keyword_search(keywords: list[str], limit: int) -> list[dict]:
    """Find events whose title/description/location/tags contain any of the keywords,
    ranked by keyword hit count."""
    if not keywords:
        return []
    or_clauses = []
    for kw in keywords:
        esc = re.escape(kw)
        for field in ("title", "description", "location.name", "location.address"):
            or_clauses.append({field: {"$regex": esc, "$options": "i"}})
        or_clauses.append({"tags": {"$regex": esc, "$options": "i"}})
    cursor = events_collection.find({"$or": or_clauses})
    docs = [_serialize_doc(doc) async for doc in cursor]
    docs.sort(
        key=lambda d: sum(1 for kw in keywords if kw in _doc_text(d)),
        reverse=True,
    )
    return docs[:limit]


async def _hybrid_event_search(query: str, top_k: int = 3) -> list[dict]:
    """Combine semantic vector search and keyword text search via reciprocal rank
    fusion. Returns up to top_k event payload dicts."""
    pool_size = max(top_k * 4, 12)
    vector_hits = await embedding_service.search(query, top_k=pool_size)
    text_hits = await _keyword_search(_extract_keywords(query), pool_size)

    k = 60  # RRF dampening constant
    scores: dict[str, float] = {}
    by_id: dict[str, dict] = {}
    for rank, hit in enumerate(vector_hits):
        eid = str(hit.get("_id"))
        scores[eid] = scores.get(eid, 0.0) + 1.0 / (k + rank + 1)
        by_id[eid] = hit
    for rank, hit in enumerate(text_hits):
        eid = str(hit.get("_id"))
        scores[eid] = scores.get(eid, 0.0) + 1.0 / (k + rank + 1)
        by_id.setdefault(eid, hit)

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    return [by_id[eid] for eid, _ in ranked[:top_k]]


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


async def _geocode_location(loc):
    """Look up lat/lng for a location dict via Nominatim. Returns the loc unchanged
    if coords are already present, the input isn't a dict with a name/address, or
    the lookup fails."""
    if not isinstance(loc, dict):
        return loc
    if loc.get("lat") is not None and loc.get("lng") is not None:
        return loc
    query = loc.get("address") or loc.get("name")
    if not query:
        return loc
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                NOMINATIM_URL,
                params={"q": query, "format": "json", "limit": 1},
                headers={"User-Agent": "personal-timeline/1.0", "Accept-Language": "en"},
            )
            resp.raise_for_status()
            data = resp.json()
            if data:
                return {
                    **loc,
                    "lat": float(data[0]["lat"]),
                    "lng": float(data[0]["lon"]),
                }
    except Exception:
        pass
    return loc


async def _apply_edit(event_id: str, changes: dict):
    """Apply changes to an event and stream a confirmation. Yields SSE strings."""
    changes = dict(changes)
    if "date" in changes and isinstance(changes["date"], str):
        changes["date"] = _parse_date(changes["date"])
    if "end_date" in changes and isinstance(changes["end_date"], str):
        changes["end_date"] = _parse_date(changes["end_date"])
    if changes.get("location"):
        changes["location"] = await _geocode_location(changes["location"])
    changes["updated_at"] = datetime.now(timezone.utc)

    await events_collection.update_one(
        {"_id": ObjectId(event_id)},
        {"$set": changes},
    )
    updated = await events_collection.find_one({"_id": ObjectId(event_id)})
    serialized = _serialize_doc(updated)
    await embedding_service.upsert_event(serialized)

    changed_keys = [k for k in changes if k != "updated_at"]
    confirm_prompt = (
        f"Just updated the event \"{updated.get('title')}\"."
        f" Changed: {', '.join(changed_keys)}."
        " Write a brief, warm one-sentence confirmation."
    )
    async for token in _stream_tokens([
        {"role": "system", "content": "You confirm timeline event updates. Be brief and warm."},
        {"role": "user", "content": confirm_prompt},
    ]):
        yield _sse({"type": "token", "content": token})

    yield _sse({"type": "event_updated", "event": serialized})


async def _stream_tokens(messages: list[dict]):
    """Async generator yielding token strings from a streaming Ollama call."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream(
            "POST",
            f"{OLLAMA_URL}/api/chat",
            json={"model": OLLAMA_MODEL, "stream": True, "messages": messages},
        ) as resp:
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    content = data.get("message", {}).get("content", "")
                    if content:
                        yield content
                except json.JSONDecodeError:
                    pass


# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------

class Message(BaseModel):
    role: str
    content: str


class PendingAction(BaseModel):
    type: str
    event_id: str
    changes: dict


class ChatRequest(BaseModel):
    messages: list[Message]
    event_filter: str = "all"
    action: PendingAction | None = None


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("")
async def chat(req: ChatRequest):
    messages = [m.model_dump() for m in req.messages]

    async def generate():
        try:
            # Direct action dispatch — bypass intent detection for confirmed edits
            if req.action and req.action.type == "confirm_edit":
                async for chunk in _apply_edit(req.action.event_id, req.action.changes):
                    yield chunk
                yield _sse({"type": "done"})
                return

            # Build a plain-text conversation transcript for intent detection
            transcript = "\n".join(
                f"{m['role'].upper()}: {m['content']}" for m in messages
            )

            # ── Step 1: intent detection (fast, non-streaming JSON call) ──
            try:
                intent_data = await _ollama_json(INTENT_SYSTEM, transcript)
            except Exception as exc:
                intent_data = {"intent": "query", "fields": {}, "missing_required": []}

            intent = intent_data.get("intent", "query")
            fields = intent_data.get("fields") or {}
            missing = intent_data.get("missing_required") or []
            event_search = intent_data.get("event_search")

            # ── CREATE flow ───────────────────────────────────────────────
            if intent == "create":
                if missing:
                    # Ask for missing info conversationally
                    collected_parts = [
                        f"{k}: {v}" for k, v in fields.items() if v is not None
                    ]
                    collected_text = ", ".join(collected_parts) or "nothing yet"
                    clarify_prompt = (
                        f"Collected so far: {collected_text}.\n"
                        f"Still need: {', '.join(missing)}.\n"
                        "Ask the user for the missing information."
                    )
                    async for token in _stream_tokens([
                        {"role": "system", "content": CLARIFY_SYSTEM},
                        {"role": "user", "content": clarify_prompt},
                    ]):
                        yield _sse({"type": "token", "content": token})

                else:
                    # All required fields present — create the event
                    date_val = _parse_date(fields["date"])
                    end_date_val = _parse_date(fields["end_date"]) if fields.get("end_date") else None
                    location_val = await _geocode_location(fields.get("location"))

                    now = datetime.now(timezone.utc)
                    doc = {
                        "title": fields["title"],
                        "description": fields.get("description"),
                        "event_type": fields["event_type"],
                        "date": date_val,
                        "end_date": end_date_val,
                        "location": location_val,
                        "tags": fields.get("tags") or [],
                        "created_at": now,
                        "updated_at": now,
                    }
                    result = await events_collection.insert_one(doc)
                    created = await events_collection.find_one({"_id": result.inserted_id})
                    serialized = _serialize_doc(created)
                    await embedding_service.upsert_event(serialized)

                    confirm_prompt = (
                        f"Just created a {fields['event_type']} event: \"{fields['title']}\" "
                        f"on {fields['date']}."
                        + (f" Location: {fields.get('location')}." if fields.get("location") else "")
                        + " Write a brief, warm one-sentence confirmation."
                    )
                    async for token in _stream_tokens([
                        {"role": "system", "content": "You confirm that a timeline event was saved. Be brief and warm."},
                        {"role": "user", "content": confirm_prompt},
                    ]):
                        yield _sse({"type": "token", "content": token})

                    yield _sse({"type": "event_created", "event": serialized})

            # ── EDIT flow ─────────────────────────────────────────────────
            elif intent == "edit":
                query = event_search or messages[-1]["content"]
                found = await _hybrid_event_search(query, top_k=3)

                if not found:
                    async for token in _stream_tokens([
                        {"role": "system", "content": "You help manage a personal timeline."},
                        {"role": "user", "content": (
                            f"The user wanted to edit an event matching '{query}' "
                            "but nothing was found. Apologise briefly and suggest "
                            "they check the timeline view to find the right event."
                        )},
                    ]):
                        yield _sse({"type": "token", "content": token})

                else:
                    target = found[0]
                    alternatives = found[1:]
                    changes = {k: v for k, v in fields.items() if v is not None}

                    if not changes:
                        # Found the event but don't know what to change — ask
                        event_summary = _format_event_line(target)
                        async for token in _stream_tokens([
                            {"role": "system", "content": CONFIRM_EDIT_SYSTEM},
                            {"role": "user", "content": f"Found event: {event_summary}. What would the user like to change?"},
                        ]):
                            yield _sse({"type": "token", "content": token})

                    else:
                        # Defer the write — ask the user to confirm the match first
                        if changes.get("location"):
                            changes["location"] = await _geocode_location(changes["location"])
                        yield _sse({
                            "type": "token",
                            "content": "I think you mean this event — does that look right?",
                        })
                        yield _sse({
                            "type": "pending_edit",
                            "target": target,
                            "alternatives": alternatives,
                            "changes": changes,
                        })

            # ── QUERY flow ────────────────────────────────────────────────
            else:
                last_question = messages[-1]["content"]
                events = await embedding_service.search(
                    last_question, top_k=5, event_type_filter=req.event_filter
                )
                sources = [e.get("title", "") for e in events]
                yield _sse({"type": "sources", "events": sources})

                context = "\n".join(_format_event_line(e) for e in events)
                ollama_messages = [{"role": "system", "content": TIMELINE_SYSTEM}]
                # Include prior turns for conversational context
                for m in messages[:-1]:
                    ollama_messages.append(m)
                ollama_messages.append({
                    "role": "user",
                    "content": f"Timeline events:\n{context}\n\nQuestion: {last_question}",
                })

                async for token in _stream_tokens(ollama_messages):
                    yield _sse({"type": "token", "content": token})

        except Exception as exc:
            yield _sse({"type": "token", "content": f"[Error: {exc}]"})

        yield _sse({"type": "done"})

    return StreamingResponse(generate(), media_type="text/event-stream")
