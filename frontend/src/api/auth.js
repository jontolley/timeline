const BASE = '/api/auth'

export async function fetchMe() {
  try {
    const res = await fetch(`${BASE}/me`, { credentials: 'include' })
    if (!res.ok) return { authenticated: false }
    return res.json()
  } catch {
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
  if (!res.ok) throw new Error('Login request failed')
  return res.json()
}

export async function logout() {
  await fetch(`${BASE}/logout`, {
    method: 'POST',
    credentials: 'include',
  })
}
