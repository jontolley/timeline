"""Lightweight in-process rate limiting for the email-sending auth endpoints.

The magic-link (`POST /api/auth/request`) and login-code
(`POST /api/auth/request-code`) endpoints both fire a Resend email for any
allowlisted address. Without a cap, someone could hammer them to burn the
Resend quota or email-bomb a user. This module enforces a per-IP fixed-window
cap purely in memory — no DB round-trip.

Caveats, all acceptable for an abuse brake (the goal is to stop a single client
sending thousands of emails, not to meter billing precisely):
  * State is per-process, so with >1 Fly machine the effective ceiling is
    (limit × machine count). `personal-timeline-api` keeps one machine warm and
    only spins up a second under load.
  * State resets on deploy / restart.
"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


def client_ip(request: Request) -> str:
    """Best-effort real client IP. In prod the chain is
    Cloudflare → Pages Function → Fly; the Pages Function forwards the original
    request (and thus its `CF-Connecting-IP` header) verbatim, so that header
    carries the visitor's address rather than Cloudflare's edge. Fall back to
    the first `X-Forwarded-For` hop, then the socket peer for local dev."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """Sliding-window log limiter. `check(key)` records a hit and raises a 429
    (with a `Retry-After` header) once `key` exceeds `max_requests` within the
    trailing `window_seconds`."""

    def __init__(self, *, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        hits = self._hits[key]
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.max_requests:
            retry_after = int(hits[0] + self.window_seconds - now) + 1
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please wait a bit and try again.",
                headers={"Retry-After": str(max(retry_after, 1))},
            )
        hits.append(now)
        # Opportunistic GC so IPs that never come back don't leak memory.
        if len(self._hits) > 4096:
            for k in [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]:
                del self._hits[k]
