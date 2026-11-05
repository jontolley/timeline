import { http } from './http'

// Matches the Google Maps / Apple Maps links the backend resolver accepts.
const MAP_LINK_RE = /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.|maps\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple(\.com)?)\b/i

export function looksLikeMapLink(text) {
  return MAP_LINK_RE.test(text || '')
}

// Resolve a share link (or text containing one) to a location:
// {name, address, lat, lng, source, url}.
export async function resolvePlaceLink(text) {
  const res = await http('/api/places/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || 'Could not read that map link')
  }
  return res.json()
}
