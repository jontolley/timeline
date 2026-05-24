import os
import json
import re
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from bson import ObjectId
from anthropic import AsyncAnthropic

from auth import require_auth
from embeddings import EmbeddingService
from database import (
    categories_collection,
    events_collection,
    people_collection,
    thread_subscriptions_collection,
    threads_collection,
)

router = APIRouter(prefix="/api/chat", dependencies=[Depends(require_auth)])
embedding_service = EmbeddingService()

ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
async_anthropic = AsyncAnthropic()

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
    "event_type": string from the valid list given in the preamble, or null,
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
- Infer event_type from context using the slug list in the preamble. Examples
  for the defaults: job/promotion/startup → career, trip/travel/visit/journey
  → travel, graduation/marriage/achievement → milestone, wedding/birth/family
  reunion/parenting → family, hike/climb/raft/backpacking/outdoor expedition
  → adventure. If a user-defined category obviously matches better, prefer it
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


_DESCRIPTION_MAX_CHARS = 280


def _format_event_line(e: dict, people_names: dict | None = None) -> str:
    date = str(e.get("date", ""))[:10]
    etype = e.get("event_type", "").capitalize()
    title = e.get("title", "")
    location = e.get("location", "")
    if isinstance(location, dict):
        location = location.get("name") or location.get("address") or ""
    tags = " ".join(f"#{t}" for t in (e.get("tags") or []))
    parts = [f"[{date}] {etype}: {title}"]
    if location:
        parts.append(f"({location})")
    if people_names:
        names = [people_names.get(str(pid)) for pid in (e.get("people") or [])]
        names = [n for n in names if n]
        if names:
            parts.append(f"with {', '.join(names)}")
    if tags:
        parts.append(tags)
    description = (e.get("description") or "").strip()
    if description:
        # Collapse whitespace so multi-line descriptions stay on one row, and
        # cap length so RAG context for ~12 events stays bounded.
        description = " ".join(description.split())
        if len(description) > _DESCRIPTION_MAX_CHARS:
            description = description[:_DESCRIPTION_MAX_CHARS].rstrip() + "…"
        parts.append(f"— {description}")
    return " ".join(parts)


async def _people_names_for_events(events: list[dict]) -> dict:
    """Look up person names for every person id referenced across the given
    events. Returns {person_id_str: name}."""
    ids: set = set()
    for e in events:
        for pid in (e.get("people") or []):
            if pid:
                ids.add(str(pid))
    if not ids:
        return {}
    try:
        object_ids = [ObjectId(pid) for pid in ids]
    except Exception:
        return {}
    cursor = people_collection.find(
        {"_id": {"$in": object_ids}}, {"_id": 1, "name": 1}
    )
    return {str(doc["_id"]): doc["name"] async for doc in cursor if doc.get("name")}


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


async def _category_names(owner_id=None) -> list[str]:
    """Live list of category slugs for the given user — used to build the
    INTENT prompt preamble so the model picks valid event_type values."""
    query = {} if owner_id is None else {"owner_id": owner_id}
    cursor = categories_collection.find(query, {"name": 1, "_id": 0})
    return sorted([doc["name"] async for doc in cursor])


def _system_blocks(static_system: str, dynamic_suffix: str = "") -> list[dict]:
    """Build a system-prompt list with a dynamic date preamble followed by
    the cached static prompt. The preamble must NOT be cached — it changes
    daily — but the bulk of the prompt still hits the cache. Callers can
    inject extra non-cached context (e.g. the live category list) via
    `dynamic_suffix`."""
    today = datetime.now(timezone.utc)
    preamble = f"Today is {today.strftime('%A, %Y-%m-%d')} (UTC)."
    if dynamic_suffix:
        preamble = f"{preamble} {dynamic_suffix}"
    return [
        {"type": "text", "text": preamble},
        {"type": "text", "text": static_system, "cache_control": {"type": "ephemeral"}},
    ]


async def _anthropic_json(system: str, user_content: str, dynamic_suffix: str = "") -> dict:
    """Non-streaming Anthropic call that returns parsed JSON. The static
    system block is cached via cache_control; a small dynamic preamble with
    today's date sits in front so the model can resolve relative dates."""
    response = await async_anthropic.messages.create(
        model=ANTHROPIC_MODEL,
        max_tokens=2048,
        system=_system_blocks(system, dynamic_suffix),
        messages=[{"role": "user", "content": user_content}],
    )
    text = next((b.text for b in response.content if b.type == "text"), "")
    # Defensive: tolerate the model adding preamble around the JSON.
    match = re.search(r"\{.*\}", text, re.DOTALL)
    return json.loads(match.group() if match else text)


async def _keyword_search(
    query: str,
    limit: int,
    event_type_filter: str = None,
    visible_thread_ids=None,
) -> list[dict]:
    """Full-text search via Mongo's $text index (events_text_search, created at
    startup in main.py). Ranks by built-in BM25-style textScore, with field
    weights — title hits outweigh description hits, etc."""
    if not query or not query.strip():
        return []
    if visible_thread_ids is not None and not visible_thread_ids:
        return []
    mongo_query: dict = {"$text": {"$search": query}}
    if visible_thread_ids is not None:
        mongo_query["thread_id"] = {"$in": visible_thread_ids}
    if event_type_filter and event_type_filter != "all":
        mongo_query["event_type"] = event_type_filter
    cursor = (
        events_collection
        .find(mongo_query, {"score": {"$meta": "textScore"}})
        .sort([("score", {"$meta": "textScore"})])
        .limit(limit)
    )
    return [_serialize_doc(doc) async for doc in cursor]


async def _visible_thread_ids(viewer_id) -> list:
    """All thread IDs this user can see — their own + subscribed-and-visible.
    Returned as a list of ObjectIds (Mongo wants ObjectId, Qdrant filter
    will be stringified upstream)."""
    own = [
        t["_id"] async for t in threads_collection.find(
            {"owner_id": viewer_id}, {"_id": 1}
        )
    ]
    sub = [
        s["thread_id"] async for s in thread_subscriptions_collection.find(
            {"subscriber_user_id": viewer_id, "visible": True}, {"thread_id": 1}
        )
    ]
    return own + sub


async def _hybrid_event_search(
    query: str,
    top_k: int = 3,
    event_type_filter: str = None,
    visible_thread_ids=None,
) -> list[dict]:
    """Combine semantic vector search and keyword text search via reciprocal rank
    fusion. Returns up to top_k event payload dicts."""
    pool_size = max(top_k * 4, 12)
    vector_hits = await embedding_service.search(
        query,
        top_k=pool_size,
        event_type_filter=event_type_filter,
        visible_thread_ids=visible_thread_ids,
    )
    text_hits = await _keyword_search(
        query,
        pool_size,
        event_type_filter=event_type_filter,
        visible_thread_ids=visible_thread_ids,
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
        decomp = await _anthropic_json(DECOMPOSE_SYSTEM, question)
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


# Keywords the CLARIFY_SYSTEM prompt would naturally use when asking about
# each optional field. Used to detect what's already been asked so we never
# pester the user twice for the same thing.
_OPTIONAL_FIELD_KEYWORDS = {
    "people": ("people", "person", "anyone", "who was", "who else", "with you"),
    "location": ("location", "where", "place", "address"),
    "description": ("description", "describe", "few words", "tell me more", "anything else about"),
}


def _assistant_asked_about(messages: list[dict], keywords: tuple) -> bool:
    """Heuristic: did any prior assistant turn already ask the user about a
    field matched by these keywords?"""
    for m in messages:
        if m.get("role") != "assistant":
            continue
        lower = (m.get("content") or "").lower()
        if any(k in lower for k in keywords):
            return True
    return False


async def _resolve_people(names: list, owner_id=None) -> tuple[list, list]:
    """Map a list of person name strings to (matching_ids, unknown_names).
    Matching is case-insensitive and exact on the name field; the order of
    resulting ids preserves the user's mention order with duplicates removed.
    Restricted to people owned by `owner_id` when provided."""
    if not names:
        return [], []
    cleaned = [n.strip() for n in names if isinstance(n, str) and n.strip()]
    if not cleaned:
        return [], []
    lowered = list({n.lower() for n in cleaned})
    query: dict = {"$expr": {"$in": [{"$toLower": "$name"}, lowered]}}
    if owner_id is not None:
        query = {"$and": [query, {"owner_id": owner_id}]}
    cursor = people_collection.find(query, {"_id": 1, "name": 1})
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


async def _apply_edit(event_id: str, changes: dict, owner_id):
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
        {"_id": ObjectId(event_id), "owner_id": owner_id},
        {"$set": changes},
    )
    updated = await events_collection.find_one({"_id": ObjectId(event_id)})
    serialized = _serialize_doc(updated)
    await embedding_service.upsert_event(serialized, owner_id=str(owner_id))

    changed_keys = [k for k in changes if k != "updated_at"]
    confirm_prompt = (
        f"Just updated the event \"{updated.get('title')}\"."
        f" Changed: {', '.join(changed_keys)}."
        " Write a brief, warm one-sentence confirmation."
    )
    async for token in _stream_tokens(
        "You confirm timeline event updates. Be brief and warm.",
        [{"role": "user", "content": confirm_prompt}],
    ):
        yield _sse({"type": "token", "content": token})

    yield _sse({"type": "event_updated", "event": serialized})


async def _stream_tokens(system: str, messages: list[dict]):
    """Async generator yielding text deltas from a streaming Anthropic call.
    Static system block is cached; a dynamic date preamble sits in front so
    the model can answer questions like 'what did I do last week'."""
    async with async_anthropic.messages.stream(
        model=ANTHROPIC_MODEL,
        max_tokens=2048,
        system=_system_blocks(system),
        messages=messages,
    ) as stream:
        async for text in stream.text_stream:
            yield text


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
async def chat(req: ChatRequest, user: dict = Depends(require_auth)):
    messages = [m.model_dump() for m in req.messages]
    owner_id = user["_id"]
    # Computed once per request and passed into every search call so we
    # don't hit thread_subscriptions per sub-query.
    visible_thread_ids = await _visible_thread_ids(owner_id)

    async def generate():
        try:
            # Direct action dispatch — bypass intent detection for confirmed edits
            if req.action and req.action.type == "confirm_edit":
                async for chunk in _apply_edit(req.action.event_id, req.action.changes, owner_id):
                    yield chunk
                yield _sse({"type": "done"})
                return

            # Build a plain-text conversation transcript for intent detection
            transcript = "\n".join(
                f"{m['role'].upper()}: {m['content']}" for m in messages
            )

            # ── Step 1: intent detection (fast, non-streaming JSON call) ──
            cat_names = await _category_names(owner_id)
            cat_suffix = (
                f"Valid event_type values (use exactly these slugs): {', '.join(cat_names)}."
                if cat_names else ""
            )
            try:
                intent_data = await _anthropic_json(INTENT_SYSTEM, transcript, cat_suffix)
            except Exception as exc:
                intent_data = {"intent": "query", "fields": {}, "missing_required": []}

            intent = intent_data.get("intent", "query")
            fields = intent_data.get("fields") or {}
            missing = intent_data.get("missing_required") or []
            event_search = intent_data.get("event_search")

            # ── CREATE flow ───────────────────────────────────────────────
            if intent == "create":
                # The LLM's missing_required is unreliable for optional fields —
                # it sometimes re-adds them after we've already asked. Filter
                # out anything the assistant has already asked about so we
                # never pester the user twice.
                asked_about = {
                    field: _assistant_asked_about(messages, kws)
                    for field, kws in _OPTIONAL_FIELD_KEYWORDS.items()
                }
                missing = [m for m in missing if not asked_about.get(m, False)]

                # Force "people" into missing if the user hasn't named anyone
                # and the assistant hasn't asked yet — otherwise the LLM may
                # skip prompting entirely for events with no obvious people.
                if (
                    not (fields.get("people") or [])
                    and "people" not in missing
                    and not asked_about["people"]
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
                    async for token in _stream_tokens(
                        CLARIFY_SYSTEM,
                        [{"role": "user", "content": clarify_prompt}],
                    ):
                        yield _sse({"type": "token", "content": token})

                else:
                    # All required fields present — create the event
                    date_val = _parse_date(fields["date"])
                    end_date_val = _parse_date(fields["end_date"]) if fields.get("end_date") else None
                    location_val = await _geocode_location(fields.get("location"))
                    people_ids, unknown_people = await _resolve_people(fields.get("people") or [], owner_id)

                    # Chat-created events land in the user's oldest thread.
                    # Users can move them later via the EventForm.
                    default_thread = await threads_collection.find_one(
                        {"owner_id": owner_id}, sort=[("created_at", 1)]
                    )
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
                        "owner_id": owner_id,
                        "thread_id": default_thread["_id"] if default_thread else None,
                        "created_at": now,
                        "updated_at": now,
                    }
                    result = await events_collection.insert_one(doc)
                    created = await events_collection.find_one({"_id": result.inserted_id})
                    serialized = _serialize_doc(created)
                    await embedding_service.upsert_event(serialized, owner_id=str(owner_id))

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
                    async for token in _stream_tokens(
                        "You confirm that a timeline event was saved. Be brief and warm.",
                        [{"role": "user", "content": confirm_prompt}],
                    ):
                        yield _sse({"type": "token", "content": token})

                    yield _sse({"type": "event_created", "event": serialized})

            # ── EDIT flow ─────────────────────────────────────────────────
            elif intent == "edit":
                query = event_search or messages[-1]["content"]
                # Edit is owner-only — restrict the search to threads the
                # caller owns so they can't edit a shared-only event.
                own_thread_ids = [
                    t["_id"] async for t in threads_collection.find(
                        {"owner_id": owner_id}, {"_id": 1}
                    )
                ]
                found = await _hybrid_event_search(
                    query, top_k=3, visible_thread_ids=own_thread_ids,
                )

                if not found:
                    async for token in _stream_tokens(
                        "You help manage a personal timeline.",
                        [{"role": "user", "content": (
                            f"The user wanted to edit an event matching '{query}' "
                            "but nothing was found. Apologise briefly and suggest "
                            "they check the timeline view to find the right event."
                        )}],
                    ):
                        yield _sse({"type": "token", "content": token})

                else:
                    target = found[0]
                    alternatives = found[1:]
                    changes = {k: v for k, v in fields.items() if v is not None}

                    if not changes:
                        # Found the event but don't know what to change — ask
                        event_summary = _format_event_line(target)
                        async for token in _stream_tokens(
                            CONFIRM_EDIT_SYSTEM,
                            [{"role": "user", "content": f"Found event: {event_summary}. What would the user like to change?"}],
                        ):
                            yield _sse({"type": "token", "content": token})

                    else:
                        # Defer the write — ask the user to confirm the match first
                        if changes.get("location"):
                            changes["location"] = await _geocode_location(changes["location"])

                        unknown_people: list = []
                        if changes.get("people"):
                            incoming_ids, unknown_people = await _resolve_people(changes["people"], owner_id)
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
                        q,
                        top_k=per_query_top_k,
                        event_type_filter=req.event_filter,
                        visible_thread_ids=visible_thread_ids,
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

                people_names = await _people_names_for_events(events)
                context = "\n".join(_format_event_line(e, people_names) for e in events)
                # Include prior turns for conversational context, then append
                # the freshly-built RAG question as the final user turn.
                chat_messages = list(messages[:-1]) + [{
                    "role": "user",
                    "content": f"Timeline events:\n{context}\n\nQuestion: {last_question}",
                }]

                async for token in _stream_tokens(TIMELINE_SYSTEM, chat_messages):
                    yield _sse({"type": "token", "content": token})

        except Exception as exc:
            yield _sse({"type": "token", "content": f"[Error: {exc}]"})

        yield _sse({"type": "done"})

    return StreamingResponse(generate(), media_type="text/event-stream")
