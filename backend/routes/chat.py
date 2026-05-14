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
    "date": "YYYY-MM-DD" or null,
    "event_type": "career" | "travel" | "milestone" | "family" or null,
    "description": string or null,
    "location": string or null,
    "tags": [string] or null
  },
  "missing_required": ["title", "date", "event_type"],
  "event_search": string or null
}

Rules:
- intent=create  → user wants to add / log / record a new event
- intent=edit    → user wants to update / change / modify an existing event
- intent=query   → everything else (questions, search, general chat)
- missing_required: list ONLY truly absent required fields (title, date, event_type)
- Infer event_type from context when obvious: job/promotion/startup → career,
  trip/travel/visit/journey → travel, graduation/marriage/achievement → milestone,
  wedding/birth/family reunion/parenting → family
- Convert relative dates ("last June", "two years ago", "in 2019") to YYYY-MM-DD
- event_search: short phrase describing which event to find, for edit intent
- tags: split any comma- or space-separated tags into an array"""

CLARIFY_SYSTEM = (
    "You help users log personal life events on their timeline. "
    "Some information is still missing. Ask for it naturally and conversationally — "
    "focus on the most important missing piece first, not a long list. "
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
    for field in ("date", "created_at", "updated_at"):
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


class ChatRequest(BaseModel):
    messages: list[Message]
    event_filter: str = "all"


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.post("")
async def chat(req: ChatRequest):
    messages = [m.model_dump() for m in req.messages]

    async def generate():
        try:
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
                    try:
                        date_val = datetime.fromisoformat(fields["date"]).replace(tzinfo=timezone.utc)
                    except Exception:
                        date_val = datetime.now(timezone.utc)

                    now = datetime.now(timezone.utc)
                    doc = {
                        "title": fields["title"],
                        "description": fields.get("description"),
                        "event_type": fields["event_type"],
                        "date": date_val,
                        "location": fields.get("location"),
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
                found = await embedding_service.search(query, top_k=1)

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
                        # Apply changes
                        if "date" in changes and isinstance(changes["date"], str):
                            try:
                                changes["date"] = datetime.fromisoformat(changes["date"]).replace(tzinfo=timezone.utc)
                            except Exception:
                                pass
                        changes["updated_at"] = datetime.now(timezone.utc)

                        event_id = target["_id"]
                        await events_collection.update_one(
                            {"_id": ObjectId(event_id)},
                            {"$set": changes},
                        )
                        updated = await events_collection.find_one({"_id": ObjectId(event_id)})
                        serialized = _serialize_doc(updated)
                        await embedding_service.upsert_event(serialized)

                        changed_keys = [k for k in changes if k != "updated_at"]
                        confirm_prompt = (
                            f"Just updated the event \"{target.get('title')}\"."
                            f" Changed: {', '.join(changed_keys)}."
                            " Write a brief, warm one-sentence confirmation."
                        )
                        async for token in _stream_tokens([
                            {"role": "system", "content": "You confirm timeline event updates. Be brief and warm."},
                            {"role": "user", "content": confirm_prompt},
                        ]):
                            yield _sse({"type": "token", "content": token})

                        yield _sse({"type": "event_updated", "event": serialized})

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
