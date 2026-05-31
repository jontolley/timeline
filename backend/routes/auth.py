import os
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr

from ratelimit import RateLimiter, client_ip

from auth import (
    APP_BASE_URL,
    AUTH_DISABLED,
    COOKIE_SECURE,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    LOGIN_CODE_MAX_ATTEMPTS,
    LOGIN_CODE_RESEND_INTERVAL_SECONDS,
    LOGIN_CODE_TTL_SECONDS,
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    generate_login_code,
    hash_login_code,
    is_allowed,
    make_magic_token,
    make_oauth_state,
    make_session_token,
    send_login_code,
    send_magic_link,
    verify_login_code,
    verify_magic_token,
    verify_oauth_state,
    verify_session_token,
)
from database import auth_codes_collection, users_collection

router = APIRouter(prefix="/api/auth")

# Per-IP cap on the two endpoints that send a Resend email. Defaults to 5
# requests per hour; tune via env without a code change. See ratelimit.py for
# the per-process caveat.
_email_rate_limiter = RateLimiter(
    max_requests=int(os.getenv("AUTH_EMAIL_RATE_LIMIT", "5")),
    window_seconds=int(os.getenv("AUTH_EMAIL_RATE_WINDOW", "3600")),
)


def _unauthorized_redirect(email: str) -> RedirectResponse:
    """302 to the frontend's /unauthorized screen with the offending email
    in the query string, so the user lands on a real page instead of a
    raw FastAPI JSON 403."""
    return RedirectResponse(
        url=f"{APP_BASE_URL}/unauthorized?email={quote(email)}",
        status_code=302,
    )


class LoginRequest(BaseModel):
    email: EmailStr


@router.post("/request")
async def request_login(body: LoginRequest, request: Request):
    """Send a magic-link email if the address is on the allowlist. Always
    returns 200 to avoid leaking which emails are allowed."""
    _email_rate_limiter.check(client_ip(request))
    if await is_allowed(body.email):
        token = make_magic_token(body.email)
        link = f"{APP_BASE_URL}/api/auth/verify?token={token}"
        try:
            await send_magic_link(body.email, link)
        except Exception as exc:
            print(f"[auth] Failed to send magic link: {exc}", flush=True)
    return {"ok": True}


@router.get("/verify")
async def verify_login(token: str):
    email = verify_magic_token(token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    if not await is_allowed(email):
        # Token decoded fine but the user was removed from the allowlist
        # between link-send and click — route them to the friendly screen
        # instead of a 400.
        return _unauthorized_redirect(email)
    session_token = make_session_token(email)
    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )
    return response


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"ok": True}


class CodeRequest(BaseModel):
    email: EmailStr


class CodeExchange(BaseModel):
    email: EmailStr
    code: str


@router.post("/request-code")
async def request_code(body: CodeRequest, request: Request):
    """Email a 6-digit login code if the address is allowlisted. Always returns 200 so callers can't probe the allowlist. Silently throttles re-requests within LOGIN_CODE_RESEND_INTERVAL_SECONDS so a stuck client can't email-bomb a user."""
    _email_rate_limiter.check(client_ip(request))
    email = body.email.lower()
    if not await is_allowed(email):
        return {"ok": True}

    now = datetime.now(timezone.utc)
    existing = await auth_codes_collection.find_one({"email": email})
    if existing:
        created = existing.get("created_at")
        if isinstance(created, datetime):
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            if (now - created).total_seconds() < LOGIN_CODE_RESEND_INTERVAL_SECONDS:
                return {"ok": True}

    code = generate_login_code()
    await auth_codes_collection.replace_one(
        {"email": email},
        {
            "email": email,
            "code_hash": hash_login_code(code),
            "expires_at": now + timedelta(seconds=LOGIN_CODE_TTL_SECONDS),
            "attempts": 0,
            "created_at": now,
        },
        upsert=True,
    )
    try:
        await send_login_code(email, code)
    except Exception as exc:
        print(f"[auth] Failed to send login code: {exc}", flush=True)
    return {"ok": True}


@router.post("/exchange-code")
async def exchange_code(body: CodeExchange):
    """Verify a one-time code and return a session token as JSON. Used by API clients (e.g., iOS) — token goes into Keychain and is presented via `Authorization: Bearer`. No cookie is set."""
    email = body.email.lower()
    code = (body.code or "").strip()
    invalid = HTTPException(status_code=400, detail="Invalid or expired code")
    if not await is_allowed(email) or not code:
        raise invalid

    doc = await auth_codes_collection.find_one({"email": email})
    if not doc:
        raise invalid

    expires_at = doc.get("expires_at")
    if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not isinstance(expires_at, datetime) or datetime.now(timezone.utc) >= expires_at:
        await auth_codes_collection.delete_one({"email": email})
        raise invalid

    if not verify_login_code(code, doc.get("code_hash", "")):
        attempts = doc.get("attempts", 0) + 1
        if attempts >= LOGIN_CODE_MAX_ATTEMPTS:
            await auth_codes_collection.delete_one({"email": email})
        else:
            await auth_codes_collection.update_one(
                {"email": email}, {"$set": {"attempts": attempts}}
            )
        raise invalid

    await auth_codes_collection.delete_one({"email": email})
    return {"token": make_session_token(email), "email": email}


@router.get("/me")
async def me(request: Request):
    if AUTH_DISABLED:
        return {"authenticated": True, "email": "dev@local", "role": "admin"}
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        # Also accept the Bearer header so /me works for API clients.
        auth_header = request.headers.get("authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip() or None
    if not token:
        return {"authenticated": False}
    email = verify_session_token(token)
    if not email:
        return {"authenticated": False}
    doc = await users_collection.find_one({"email": email})
    if not doc:
        return {"authenticated": False}
    return {
        "authenticated": True,
        "email": doc["email"],
        "role": doc.get("role", "user"),
        "user_id": str(doc["_id"]),
        "name": doc.get("name"),
        "picture_url": doc.get("picture_url"),
    }


# ---------------------------------------------------------------------------
# Google OAuth (web redirect flow)
# ---------------------------------------------------------------------------

def _google_redirect_uri() -> str:
    """Backend's own callback URL — must match what's registered in Google
    Cloud Console for the OAuth client. For local dev this is
    http://localhost:3000/api/auth/google/callback (frontend nginx proxies
    /api to backend); for prod it's https://hindsite.pages.dev/...
    (Cloudflare Pages Function proxies to Fly)."""
    return f"{APP_BASE_URL}/api/auth/google/callback"


@router.get("/google/start")
async def google_start():
    """Kick off the Google OAuth redirect. Returns 302 to Google's consent
    screen; on approval Google redirects back to /api/auth/google/callback
    with a `code` we exchange for an id_token."""
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google sign-in not configured")
    state = make_oauth_state("google")
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": _google_redirect_uri(),
        "response_type": "code",
        # `profile` gives us `name` + `picture` in the id_token claims, used
        # for the user-menu avatar + display name. No extra API call needed.
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return RedirectResponse(url=url, status_code=302)


@router.get("/google/callback")
async def google_callback(code: str = "", state: str = ""):
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Google sign-in not configured")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")
    if verify_oauth_state(state) != "google":
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    # Exchange the authorization code for tokens, then verify the id_token
    # via Google's tokeninfo endpoint (simpler than JWKS verification, and
    # the recommended approach for backend verification).
    async with httpx.AsyncClient(timeout=10.0) as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": _google_redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
        if token_res.status_code != 200:
            print(f"[oauth] token exchange failed: {token_res.status_code} {token_res.text}", flush=True)
            raise HTTPException(status_code=400, detail="Token exchange failed")
        id_token = token_res.json().get("id_token")
        if not id_token:
            raise HTTPException(status_code=400, detail="No id_token returned by Google")

        info_res = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token},
        )
        if info_res.status_code != 200:
            raise HTTPException(status_code=400, detail="Token verification failed")
        claims = info_res.json()

    if claims.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=400, detail="Token audience mismatch")
    if claims.get("email_verified") not in ("true", True):
        raise HTTPException(status_code=400, detail="Google says this email is not verified")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="No email in Google response")
    if not await is_allowed(email):
        # The user authenticated with Google but isn't on the allowlist.
        # Send them to the frontend's /unauthorized screen so they see a
        # real page (with the offending email + a way back to sign-in)
        # instead of a raw JSON 403 from FastAPI.
        return _unauthorized_redirect(email)

    # Persist (and refresh on each sign-in) the user's display name + avatar
    # URL from Google's claims. Magic-link sign-ins don't touch these fields,
    # so a user who switches between methods keeps whichever Google last set.
    profile_updates: dict = {}
    google_name = (claims.get("name") or "").strip()
    google_picture = (claims.get("picture") or "").strip()
    if google_name:
        profile_updates["name"] = google_name
    if google_picture:
        profile_updates["picture_url"] = google_picture
    if profile_updates:
        profile_updates["updated_at"] = datetime.now(timezone.utc)
        await users_collection.update_one(
            {"email": email}, {"$set": profile_updates}
        )

    session_token = make_session_token(email)
    response = RedirectResponse(url=APP_BASE_URL, status_code=302)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=SESSION_TTL_SECONDS,
        path="/",
    )
    return response
