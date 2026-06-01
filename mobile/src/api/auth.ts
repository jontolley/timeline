import { http } from './client'

// Native auth uses the email-code flow the backend exposes specifically for
// API clients:
//   POST /auth/request-code  { email }        -> { ok: true }   (always 200)
//   POST /auth/exchange-code { email, code }   -> { token, email }
// The token is a 30-day itsdangerous session token; it goes into SecureStore
// and is presented as `Authorization: Bearer`. No cookie is involved.

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
  // (never 401), so this won't trip the unauthorized handler.
  try {
    const res = await http('/auth/me')
    if (!res.ok) return { authenticated: false }
    return res.json()
  } catch {
    return { authenticated: false }
  }
}
