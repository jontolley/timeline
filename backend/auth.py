import hashlib
import hmac
import os
import secrets
from typing import Optional

import httpx
from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

ALLOWED_EMAILS: set[str] = {
    e.strip().lower()
    for e in os.getenv("ALLOWED_EMAIL", "").split(",")
    if e.strip()
}
SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-secret-change-me-in-production")
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_FROM = os.getenv("RESEND_FROM", "onboarding@resend.dev")
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "").lower() in {"1", "true", "yes"}
AUTH_DISABLED = os.getenv("AUTH_DISABLED", "").lower() in {"1", "true", "yes"}

SESSION_COOKIE_NAME = "timeline_session"
MAGIC_LINK_TTL_SECONDS = 60 * 15
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
LOGIN_CODE_TTL_SECONDS = 60 * 15
LOGIN_CODE_RESEND_INTERVAL_SECONDS = 60
LOGIN_CODE_MAX_ATTEMPTS = 5

_signer = URLSafeTimedSerializer(SESSION_SECRET, salt="timeline-auth")


def is_allowed(email: str) -> bool:
    return email.strip().lower() in ALLOWED_EMAILS


def make_magic_token(email: str) -> str:
    return _signer.dumps({"email": email.lower(), "purpose": "magic"})


def verify_magic_token(token: str) -> Optional[str]:
    try:
        payload = _signer.loads(token, max_age=MAGIC_LINK_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if payload.get("purpose") != "magic":
        return None
    return payload.get("email")


def make_session_token(email: str) -> str:
    return _signer.dumps({"email": email.lower(), "purpose": "session"})


def verify_session_token(token: str) -> Optional[str]:
    try:
        payload = _signer.loads(token, max_age=SESSION_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if payload.get("purpose") != "session":
        return None
    return payload.get("email")


def generate_login_code() -> str:
    """Six random digits, zero-padded — for the iOS / API code-exchange flow."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_login_code(code: str) -> str:
    """SHA256 of the code peppered with SESSION_SECRET. The pepper means a Mongo dump alone can't brute-force the code space without also stealing the app secret."""
    return hashlib.sha256(f"{code}:{SESSION_SECRET}".encode("utf-8")).hexdigest()


def verify_login_code(code: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_login_code(code), expected_hash)


async def send_login_code(email: str, code: str) -> None:
    """Email a one-time login code via Resend; in dev (no RESEND_API_KEY) print to stdout so it surfaces in `docker compose logs backend`."""
    if not RESEND_API_KEY:
        print(f"[auth] Login code for {email}: {code}", flush=True)
        return
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": RESEND_FROM,
                "to": [email],
                "subject": "Your timeline login code",
                "html": (
                    f"<p>Your sign-in code is <strong>{code}</strong>. "
                    f"It expires in 15 minutes.</p>"
                ),
            },
        )
        resp.raise_for_status()


async def send_magic_link(email: str, link: str) -> None:
    """In dev (no RESEND_API_KEY) write the link to stdout so you can grab it
    from `docker compose logs backend`. In prod, send via Resend."""
    if not RESEND_API_KEY:
        print(f"[auth] Magic link for {email}: {link}", flush=True)
        return
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "from": RESEND_FROM,
                "to": [email],
                "subject": "Sign in to your timeline",
                "html": (
                    f'<p>Click <a href="{link}">this link</a> to sign in '
                    f"to your timeline. The link expires in 15 minutes.</p>"
                ),
            },
        )
        resp.raise_for_status()


async def require_auth(request: Request) -> str:
    """FastAPI dependency. Accepts `Authorization: Bearer <token>` (API clients) or the session cookie (web). Returns the user's email or raises 401."""
    if AUTH_DISABLED:
        return next(iter(ALLOWED_EMAILS), "dev@local")

    token: Optional[str] = None
    auth_header = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip() or None
    if not token:
        token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    email = verify_session_token(token)
    if not email:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return email
