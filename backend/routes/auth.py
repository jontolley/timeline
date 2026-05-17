from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr

from auth import (
    AUTH_DISABLED,
    COOKIE_SECURE,
    SESSION_COOKIE_NAME,
    SESSION_TTL_SECONDS,
    APP_BASE_URL,
    is_allowed,
    make_magic_token,
    make_session_token,
    send_magic_link,
    verify_magic_token,
    verify_session_token,
)

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
