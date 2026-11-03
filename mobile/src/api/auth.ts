import { http } from './client'
import { API } from '../config'

// Native auth uses the email-code flow the backend exposes specifically for
// API clients:
//   POST /auth/request-code  { email }        -> { ok: true }   (always 200)
//   POST /auth/exchange-code { email, code }   -> { token, email }
// The token is a signed id for a server-side session that stays alive while
// it's used (90 days idle); it goes into SecureStore and is presented as
// `Authorization: Bearer`. No cookie is involved.

export async function requestCode(email: string): Promise<void> {
  // Always returns 200 — the backend won't reveal whether an address is
  // allowlisted — but a 429 means we hit the per-IP rate limit.
  const res = await http('/auth/request-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
    auth: false,
  })
  if (res.status === 429) {
    throw new Error('Too many attempts. Please wait a bit and try again.')
  }
  if (!res.ok) {
    throw new Error('Could not send the code. Please try again.')
  }
}

export type ExchangeResult = { token: string; email: string }

export async function exchangeCode(email: string, code: string): Promise<ExchangeResult> {
  const res = await http('/auth/exchange-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
    auth: false,
  })
  if (res.status === 400) throw new Error('That code is invalid or expired.')
  if (!res.ok) throw new Error('Sign-in failed. Please try again.')
  return res.json()
}

export type Me = {
  authenticated: boolean
  email?: string
  role?: string
  user_id?: string
}

export async function fetchMe(): Promise<Me> {
  // /me returns 200 + { authenticated:false } for a missing/invalid token
  // (never 401), so this won't trip the unauthorized handler. Network errors
  // and 5xx *throw* rather than reporting anon, so callers can tell "the
  // server rejected this token" apart from "we couldn't reach the server".
  const res = await http('/auth/me')
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

export async function logout(token: string): Promise<void> {
  // Ends the session server-side so the token is dead even if a copy of it
  // survives somewhere. /logout never returns 401, so this can't loop back
  // through the unauthorized handler.
  await http('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    auth: false,
  })
}

// Google sign-in reuses the web OAuth flow inside an ASWebAuthenticationSession:
// the backend's callback redirects to `hindsite://auth?code=…` (or `?error=…`),
// and the app swaps that one-time code plus its PKCE verifier for a token.
export const GOOGLE_REDIRECT = 'hindsite://auth'

export function googleStartUrl(challenge: string): string {
  return `${API}/auth/google/start?client=app&challenge=${encodeURIComponent(challenge)}`
}

export async function googleAppExchange(code: string, verifier: string): Promise<ExchangeResult> {
  const res = await http('/auth/google/app-exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier }),
    auth: false,
  })
  if (res.status === 400) throw new Error('Sign-in expired. Please try again.')
  if (!res.ok) throw new Error('Sign-in failed. Please try again.')
  return res.json()
}
