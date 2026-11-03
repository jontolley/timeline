import { API } from '../config'

// The native analogue of the web `http.js` wrapper. The web client relied on
// `credentials: 'include'` to ship the session cookie; native has no cookie
// jar, so we attach the bearer token (held in memory after being read from
// SecureStore at launch) to every request, and surface 401s through a
// registered handler so the UI can drop back to the login screen.

let authToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

export function getAuthToken(): string | null {
  return authToken
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
}

export type HttpOptions = RequestInit & {
  // Set false for the pre-auth endpoints (request-code / exchange-code) so we
  // never send a stale token while signing in.
  auth?: boolean
}

export async function http(path: string, options: HttpOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers as HeadersInit | undefined)
  if (authToken && options.auth !== false) {
    headers.set('Authorization', `Bearer ${authToken}`)
  }
  const res = await fetch(`${API}${path}`, { ...options, headers })
  if (res.status === 401) {
    onUnauthorized?.()
    throw new Error('Unauthorized')
  }
  return res
}

// Convenience: throws a useful error using the backend's `{detail}` shape.
export async function httpJson<T>(path: string, options?: HttpOptions): Promise<T> {
  const res = await http(path, options)
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error((detail as { detail?: string } | null)?.detail || `Request failed: ${res.status}`)
  }
  return (await res.json()) as T
}

export function jsonBody(data: unknown): HttpOptions {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}
