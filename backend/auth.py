import hashlib
import hmac
import os
import secrets
from typing import Optional

import httpx
from fastapi import HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

# ALLOWED_EMAILS is now only consumed by the startup migration that seeds
# the first admin user(s). After that, the users collection IS the allowlist.
ALLOWED_EMAILS: set[str] = {
    e.strip().lower()
    for e in os.getenv("ALLOWED_EMAIL", "").split(",")
    if e.strip()
}

# Google OAuth — optional; the Sign in with Google button is disabled when
# unset. Configured in Google Cloud Console; redirect URI must match
# `{APP_BASE_URL}/api/auth/google/callback` for both dev and prod.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
OAUTH_STATE_TTL_SECONDS = 60 * 10
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


async def is_allowed(email: str) -> bool:
    """A user is allowed to log in iff they have a record in the users
    collection. New users are added by an admin from the Settings → Users tab,
    or seeded from ALLOWED_EMAILS by the startup migration on first boot."""
    from database import users_collection
    doc = await users_collection.find_one({"email": email.strip().lower()})
    return doc is not None


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


def make_oauth_state(provider: str) -> str:
    return _signer.dumps({"provider": provider, "purpose": "oauth_state"})


def verify_oauth_state(token: str) -> Optional[str]:
    try:
        payload = _signer.loads(token, max_age=OAUTH_STATE_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if payload.get("purpose") != "oauth_state":
        return None
    return payload.get("provider")


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


def _email_html(*, eyebrow: str, heading: str, lede: str, cta_html: str) -> str:
    """Branded HTML shell shared by both auth emails. Colors mirror the Hearth palette and all styles are inline so clients that strip <style> still render correctly."""
    return (
        '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1ece2;">'
        '<div style="background:#f1ece2;padding:48px 16px;'
        'font-family:Geist,-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,sans-serif;'
        'color:#1f2a35;-webkit-font-smoothing:antialiased;">'
        '<div style="max-width:480px;margin:0 auto;background:#ffffff;'
        'border:1px solid #d8d2c4;border-radius:14px;padding:40px 40px 32px;">'
        # Brand mark + wordmark
        '<div style="margin-bottom:32px;font-size:18px;color:#1f2a35;">'
        '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" '
        'style="vertical-align:-5px;margin-right:9px;">'
        '<circle cx="11" cy="11" r="9.5" stroke="#1f2a35" stroke-width="1.4"/>'
        '<line x1="11" y1="3" x2="11" y2="11" stroke="#1f2a35" stroke-width="1.4" stroke-linecap="round"/>'
        '<line x1="11" y1="11" x2="16" y2="14" stroke="#1f2a35" stroke-width="1.4" stroke-linecap="round"/>'
        '</svg>'
        '<strong style="font-weight:600;letter-spacing:-0.02em;">Timeline</strong>'
        '</div>'
        # Eyebrow (mono uppercase)
        f'<div style="font-family:&quot;Geist Mono&quot;,ui-monospace,Menlo,monospace;'
        'font-size:11px;letter-spacing:0.16em;text-transform:uppercase;'
        f'color:#8a857a;margin-bottom:14px;">{eyebrow}</div>'
        # Heading
        f'<h1 style="margin:0 0 14px;font-size:30px;font-weight:500;'
        'letter-spacing:-0.03em;line-height:1.1;color:#1f2a35;">'
        f'{heading}</h1>'
        # Lede
        f'<p style="margin:0 0 28px;font-size:15px;line-height:1.55;'
        f'color:#4d6680;">{lede}</p>'
        f'{cta_html}'
        # Footer
        '<hr style="border:0;border-top:1px solid #e6e1d3;margin:32px 0 18px;">'
        '<p style="margin:0;font-size:12.5px;color:#8a857a;line-height:1.5;">'
        "If you didn't request this, you can safely ignore this email — "
        'the link or code won\'t work for anyone else.'
        '</p>'
        '</div></div></body></html>'
    )


async def _send_email(*, to: str, subject: str, html: str) -> None:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json",
            },
            json={"from": RESEND_FROM, "to": [to], "subject": subject, "html": html},
        )
        resp.raise_for_status()


async def send_login_code(email: str, code: str) -> None:
    """Email a one-time login code via Resend; in dev (no RESEND_API_KEY) print to stdout so it surfaces in `docker compose logs backend`."""
    if not RESEND_API_KEY:
        print(f"[auth] Login code for {email}: {code}", flush=True)
        return
    cta = (
        '<div style="font-family:&quot;Geist Mono&quot;,ui-monospace,Menlo,monospace;'
        'font-size:34px;letter-spacing:0.28em;text-align:center;color:#1f2a35;'
        'background:#f7f3ea;border:1px solid #d8d2c4;border-radius:14px;'
        f'padding:26px 16px;">{code}</div>'
    )
    html = _email_html(
        eyebrow="Sign-in code",
        heading="Enter this to sign in.",
        lede="Type this code into the sign-in screen to continue. It expires in 15 minutes.",
        cta_html=cta,
    )
    await _send_email(to=email, subject="Your timeline sign-in code", html=html)


async def send_invitation(email: str, inviter_email: str = None) -> None:
    """Email a welcome / sign-in link to a newly invited user. In dev (no
    RESEND_API_KEY) print to stdout so it surfaces in `docker compose logs
    backend`."""
    link = APP_BASE_URL.rstrip("/") + "/"
    if not RESEND_API_KEY:
        print(f"[auth] Invitation for {email}: {link}", flush=True)
        return
    cta = (
        f'<a href="{link}" style="display:inline-block;background:#1f2a35;'
        'color:#f1ece2;text-decoration:none;padding:14px 26px;border-radius:999px;'
        'font-size:15px;font-weight:500;letter-spacing:-0.005em;">'
        'Sign in to your timeline →'
        '</a>'
    )
    inviter_line = (
        f"{inviter_email} added you to Timeline. "
        if inviter_email else "You've been added to Timeline. "
    )
    html = _email_html(
        eyebrow="Welcome",
        heading="You're invited to Timeline.",
        lede=(
            f"{inviter_line}"
            "Sign in with the button below using your Google account or "
            "this email address — your own private timeline is waiting."
        ),
        cta_html=cta,
    )
    await _send_email(to=email, subject="You're invited to Timeline", html=html)


async def send_magic_link(email: str, link: str) -> None:
    """Email a magic sign-in link via Resend; in dev (no RESEND_API_KEY) print to stdout so it surfaces in `docker compose logs backend`."""
    if not RESEND_API_KEY:
        print(f"[auth] Magic link for {email}: {link}", flush=True)
        return
    cta = (
        f'<a href="{link}" style="display:inline-block;background:#1f2a35;'
        'color:#f1ece2;text-decoration:none;padding:14px 26px;border-radius:999px;'
        'font-size:15px;font-weight:500;letter-spacing:-0.005em;">'
        'Sign in to your timeline →'
        '</a>'
    )
    html = _email_html(
        eyebrow="Sign-in link",
        heading="One click and you're in.",
        lede="Sign in to your timeline using the button below. The link expires in 15 minutes — if it does, request another from the sign-in screen.",
        cta_html=cta,
    )
    await _send_email(to=email, subject="Sign in to your timeline", html=html)


async def require_auth(request: Request) -> dict:
    """FastAPI dependency. Accepts `Authorization: Bearer <token>` (API clients)
    or the session cookie (web). Looks the email up in the users collection
    and returns the user doc (keys: _id, email, role). Raises 401 on missing /
    invalid token or if the user has been removed since the session was minted.
    """
    from database import users_collection

    if AUTH_DISABLED:
        # In dev with auth disabled, fall back to the first admin.
        doc = await users_collection.find_one({"role": "admin"})
        if doc:
            return doc
        # No admin yet — synthesize one so dev endpoints still respond.
        return {"_id": None, "email": "dev@local", "role": "admin"}

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
    doc = await users_collection.find_one({"email": email})
    if not doc:
        # Session token is valid but the user was removed since.
        raise HTTPException(status_code=401, detail="User no longer exists")
    return doc


async def require_admin(request: Request) -> dict:
    """FastAPI dependency for admin-only routes. Returns the admin user doc
    or raises 403 if the caller isn't an admin."""
    user = await require_auth(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user
