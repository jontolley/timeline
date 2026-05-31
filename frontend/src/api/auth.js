const BASE = '/api/auth'

export async function fetchMe() {
  const t0 = performance.now()
  console.log('[boot] fetchMe → GET /api/auth/me')
  try {
    const res = await fetch(`${BASE}/me`, { credentials: 'include' })
    const ms = Math.round(performance.now() - t0)
    if (!res.ok) {
      console.log(`[boot] fetchMe ← ${res.status} in ${ms}ms (treating as unauthenticated)`)
      return { authenticated: false }
    }
    const body = await res.json()
    console.log(`[boot] fetchMe ← 200 in ${ms}ms`, body)
    return body
  } catch (err) {
    const ms = Math.round(performance.now() - t0)
    console.log(`[boot] fetchMe ← network error in ${ms}ms`, err)
    return { authenticated: false }
  }
}

export async function requestLogin(email) {
  const res = await fetch(`${BASE}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error('Too many sign-in attempts. Please wait a bit and try again.')
    }
    throw new Error('Login request failed')
  }
  return res.json()
}

export async function logout() {
  await fetch(`${BASE}/logout`, {
    method: 'POST',
    credentials: 'include',
  })
}
