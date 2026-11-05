import { httpJson, jsonBody } from './client'
import type { LocationDetail } from './types'

// Matches the Google Maps / Apple Maps links the backend resolver accepts.
const MAP_LINK_RE = /https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.|maps\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple(\.com)?)\b/i

export function looksLikeMapLink(text: string): boolean {
  return MAP_LINK_RE.test(text)
}

// Resolve a share link (or text containing one) to a place — name, address,
// coords, plus `source` and the link itself — via POST /api/places/resolve.
export function resolvePlaceLink(text: string): Promise<LocationDetail> {
  return httpJson<LocationDetail>('/places/resolve', jsonBody({ text }))
}
