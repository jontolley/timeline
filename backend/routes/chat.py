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
from database import events_collection, people_collection

router = APIRouter(prefix="/api/chat")
embedding_service = EmbeddingService()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "mistral")

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

TIMELINE_SYSTEM = (
    "You are a helpful assistant with access to the user's personal life timeline. "
    "Answer questions using the timeline events provided and any facts already established in the conversation. "
    "If the answer isn't supported by either, say so honestly — don't invent details. "
    "Be warm, personal, and concise."
)

DECOMPOSE_SYSTEM = """You decompose a user's timeline question into atomic search queries.
Output ONLY valid JSON: {"queries": [string, ...]}

Rules:
- Single-subject questions → one query (concise phrase form of the question).
- Comparative or multi-subject questions ("X before/after Y", "X vs Y", "what about X and also Y") → one query per subject.
- Each query is a short search phrase (people, place, event keywords) — not a full sentence, not a question.
- Maximum 3 queries.
- Never invent topics that aren't in the question.

Examples:
"When did Ben die?" → {"queries":["Ben death"]}
"Did Ben die before or after Michael went to Guatemala?" → {"queries":["Ben death","Michael Guatemala trip"]}
"How long was I in Japan vs Vietnam?" → {"queries":["Japan trip","Vietnam trip"]}
"What trips did I take in 2024?" → {"queries":["2024 trips travel"]}
"""

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
    "tags": [string] or null,
    "people": [string] or null
  },
  "missing_required": ["title", "date", "event_type", "location", "description", "people"],
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
  * Include "people" ONLY IF: people has not been provided AND the assistant has not already asked for people in this conversation
  * Do NOT re-add "location", "description", or "people" if the assistant already asked and the user skipped or ignored them
- Infer event_type from context when obvious: job/promotion/startup → career,
  trip/travel/visit/journey → travel, graduation/marriage/achievement → milestone,
  wedding/birth/family reunion/parenting → family
- Convert relative dates ("last June", "two years ago", "in 2019") to YYYY-MM-DD
- event_search: short phrase describing which event to find, for edit intent
- tags: split any comma- or space-separated tags into an array
- location: extract place name and/or address if mentioned; lat/lng are always null (set via map in UI)
- people: array of personal names mentioned in connection with this event (e.g. "with Sarah and Bob" → ["Sarah", "Bob"]). Use first names or full names exactly as the user typed them. Empty array or null if no people mentioned.
- end_date: populate when user mentions a duration, end date, or range (e.g. "from June 1 to June 10", "two-week trip ending March 5")"""

CLARIFY_SYSTEM = (
    "You help users log personal life events on their timeline. "
    "Some information is still missing or would enrich the event. "
    "Ask for it naturally and conversationally — ask for the most important missing piece first, "
    "then mention optional ones (location, description, people) briefly on the same turn if relevant. "
    "Make clear that location, description, and people are optional — the user can say 'skip' or 'none'. "
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


async def _keyword_search(
    keywords: list[str],
    limit: int,
    event_type_filter: str = None,
) -> list[dict]:
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
    query = {"$or": or_clauses}
    if event_type_filter and event_type_filter != "all":
        query = {"$and": [query, {"event_type": event_type_filter}]}
    cursor = events_collection.find(query)
    docs = [_serialize_doc(doc) async for doc in cursor]
    docs.sort(
        key=lambda d: sum(1 for kw in keywords if kw in _doc_text(d)),
        reverse=True,
    )
    return docs[:limit]


async def _hybrid_event_search(
    query: str,
    top_k: int = 3,
    event_type_filter: str = None,
) -> list[dict]:
    """Combine semantic vector search and keyword text search via reciprocal rank
    fusion. Returns up to top_k event payload dicts."""
    pool_size = max(top_k * 4, 12)
    vector_hits = await embedding_service.search(
        query, top_k=pool_size, event_type_filter=event_type_filter
    )
    text_hits = await _keyword_search(
        _extract_keywords(query), pool_size, event_type_filter=event_type_filter
    )

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


async def _decompose_query(question: str) -> list[str]:
    """Split a user question into 1-3 atomic search phrases. Falls back to the
    original question if anything goes wrong."""
    fallback = [question.strip()] if question and question.strip() else []
    try:
        decomp = await _ollama_json(DECOMPOSE_SYSTEM, question)
        queries = decomp.get("queries")
        if not isinstance(queries, list):
            return fallback
        cleaned: list[str] = []
        for q in queries:
            if isinstance(q, str) and q.strip():
                cleaned.append(q.strip())
        return cleaned[:3] or fallback
    except Exception:
        return fallback


def _assistant_asked_about_people(transcript: str) -> bool:
    """Heuristic: did any prior ASSISTANT turn already ask the user about people?
    We check for keywords that the clarify prompt would naturally use."""
    keywords = ("people", "person", "anyone", "who was", "who else", "with you")
    for line in transcript.split("\n"):
        if not line.startswith("ASSISTANT:"):
            continue
        lower = line.lower()
        if any(k in lower for k in keywords):
            return True
    return False


async def _resolve_people(names: list) -> tuple[list, list]:
    """Map a list of person name strings to (matching_ids, unknown_names).
    Matching is case-insensitive and exact on the name field; the order of
    resulting ids preserves the user's mention order with duplicates removed."""
    if not names:
        return [], []
    cleaned = [n.strip() for n in names if isinstance(n, str) and n.strip()]
    if not cleaned:
        return [], []
    lowered = list({n.lower() for n in cleaned})
    cursor = people_collection.find(
        {"$expr": {"$in": [{"$toLower": "$name"}, lowered]}},
        {"_id": 1, "name": 1},
    )
    by_lower: dict[str, str] = {}
    async for doc in cursor:
        by_lower[doc["name"].lower()] = str(doc["_id"])

    ids: list = []
    seen: set = set()
    unknown: list = []
    for n in cleaned:
        pid = by_lower.get(n.lower())
        if pid:
            if pid not in seen:
                seen.add(pid)
                ids.append(pid)
        else:
            if n not in unknown:
                unknown.append(n)
    return ids, unknown


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
                # Force "people" into the missing list if the user hasn't named
                # anyone and the assistant hasn't already asked (the LLM's own
                # missing_required is unreliable about this).
                if (
                    not (fields.get("people") or [])
                    and "people" not in missing
                    and not _assistant_asked_about_people(transcript)
                ):
                    missing = [*missing, "people"]

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
                    people_ids, unknown_people = await _resolve_people(fields.get("people") or [])

                    now = datetime.now(timezone.utc)
                    doc = {
                        "title": fields["title"],
                        "description": fields.get("description"),
                        "event_type": fields["event_type"],
                        "date": date_val,
                        "end_date": end_date_val,
                        "location": location_val,
                        "tags": fields.get("tags") or [],
                        "people": people_ids,
                        "created_at": now,
                        "updated_at": now,
                    }
                    result = await events_collection.insert_one(doc)
                    created = await events_collection.find_one({"_id": result.inserted_id})
                    serialized = _serialize_doc(created)
                    await embedding_service.upsert_event(serialized)

                    saved_people_names = [n for n in (fields.get("people") or []) if n not in unknown_people]
                    confirm_prompt = (
                        f"Just created a {fields['event_type']} event: \"{fields['title']}\" "
                        f"on {fields['date']}."
                        + (f" Location: {fields.get('location')}." if fields.get("location") else "")
                        + (f" People: {', '.join(saved_people_names)}." if saved_people_names else "")
                        + (
                            f" Note: I couldn't find anyone named {', '.join(unknown_people)} — mention they can add them on the People page."
                            if unknown_people else ""
                        )
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

                        unknown_people: list = []
                        if changes.get("people"):
                            incoming_ids, unknown_people = await _resolve_people(changes["people"])
                            existing_ids = list(target.get("people") or [])
                            merged = existing_ids + [pid for pid in incoming_ids if pid not in existing_ids]
                            if merged:
                                changes["people"] = merged
                            else:
                                # All names were unknown — don't overwrite existing list with empty
                                changes.pop("people", None)

                        intro = "I think you mean this event — does that look right?"
                        if unknown_people:
                            intro += f" (Couldn't find anyone named {', '.join(unknown_people)}.)"
                        yield _sse({"type": "token", "content": intro})
                        yield _sse({
                            "type": "pending_edit",
                            "target": target,
                            "alternatives": alternatives,
                            "changes": changes,
                        })

            # ── QUERY flow ────────────────────────────────────────────────
            else:
                last_question = messages[-1]["content"]

                # Decompose into atomic sub-queries so multi-subject questions
                # ("X before/after Y") retrieve evidence for every subject.
                sub_queries = await _decompose_query(last_question)

                # Retrieve hybrid hits per sub-query, union & dedupe by id,
                # preserving the order subjects were mentioned.
                seen_ids: set = set()
                events: list = []
                per_query_top_k = 5 if len(sub_queries) > 1 else 8
                for q in sub_queries:
                    hits = await _hybrid_event_search(
                        q, top_k=per_query_top_k, event_type_filter=req.event_filter
                    )
                    for hit in hits:
                        eid = str(hit.get("_id"))
                        if eid in seen_ids:
                            continue
                        seen_ids.add(eid)
                        events.append(hit)

                # Sort chronologically so before/after questions are easier to answer.
                events.sort(key=lambda e: str(e.get("date") or ""))
                events = events[:12]

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
