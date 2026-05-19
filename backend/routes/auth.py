from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr

from auth import (
    APP_BASE_URL,
    AUTH_DISABLED,
    COOKIE_SECURE,
    LOGIN_CODE_MAX_ATTEMPTS,
    LOGIN_CODE_RESEND_INTERVAL_SECONDS,
    LOGIN_CODE_TTL_SECONDS,
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    generate_login_code,
    hash_login_code,
    is_allowed,
    make_magic_token,
    make_session_token,
    send_login_code,
    send_magic_link,
    verify_login_code,
    verify_magic_token,
    verify_session_token,
)
from database import auth_codes_collection

router = APIRouter(prefix="/api/auth")


class LoginRequest(BaseModel):
    email: EmailStr


@router.post("/request")
async def request_login(body: LoginRequest):
    """Send a magic-link email if the address is on the allowlist. Always
    returns 200 to avoid leaking which emails are allowed."""
    if is_allowed(body.email):
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
    if not email or not is_allowed(email):
        raise HTTPException(status_code=400, detail="Invalid or expired token")
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
async def request_code(body: CodeRequest):
    """Email a 6-digit login code if the address is allowlisted. Always returns 200 so callers can't probe the allowlist. Silently throttles re-requests within LOGIN_CODE_RESEND_INTERVAL_SECONDS so a stuck client can't email-bomb a user."""
    email = body.email.lower()
    if not is_allowed(email):
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
    if not is_allowed(email) or not code:
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
        return {"authenticated": True, "email": "dev@local"}
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        return {"authenticated": False}
    email = verify_session_token(token)
    if not email:
        return {"authenticated": False}
    return {"authenticated": True, "email": email}
