import type { LocationDetail } from './types'
import { applePlacesAvailable, searchApplePlaces } from '../../modules/hindsite-places'

// Coords → place via OpenStreetMap Nominatim (no API key), the same service the
// web LocationPicker uses for photo EXIF. Nominatim's usage policy asks for an
// identifying User-Agent. The event form has a single short location field, so
// `name` is the place's own name when it has one (a park, a restaurant) and
// otherwise "City, State"; the full display_name goes in `address`.

type NominatimReverse = {
  name?: string
  display_name?: string
  address?: Record<string, string | undefined>
}

export async function reverseGeocode(lat: number, lng: number): Promise<LocationDetail | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'Hindsite/0.1 (https://hindsite.app)' },
  })
  if (!res.ok) return null
  const data = (await res.json()) as NominatimReverse
  if (!data.display_name) return null
  return { ...placeFrom(data), lat, lng }
}

function placeFrom(data: NominatimReverse): LocationDetail {
  const a = data.address ?? {}
  const locality = a.city || a.town || a.village || a.hamlet || a.suburb || a.county
  const name = data.name || [locality, a.state || a.country].filter(Boolean).join(', ') || data.display_name
  return { name, address: data.display_name }
}

type NominatimSearch = NominatimReverse & { lat: string; lon: string }

type Near = { lat: number; lng: number } | null | undefined

// Free-text place search for the location picker. Apple Maps search first
// (modules/hindsite-places): its data has far more local businesses than
// OpenStreetMap and it ranks places near `near` first. OpenStreetMap
// (the web LocationPicker's Nominatim search) is the fallback for a build
// without the module or when Apple's search errors.
export async function searchPlaces(query: string, near?: Near): Promise<LocationDetail[]> {
  if (applePlacesAvailable) {
    try {
      const hits = await searchApplePlaces(query.trim(), near)
      return hits.map((h) => ({ name: h.name ?? h.address ?? null, address: h.address ?? null, lat: h.lat, lng: h.lng }))
    } catch {
      // Fall through to OpenStreetMap.
    }
  }
  return searchNominatim(query, near)
}

async function searchNominatim(query: string, near?: Near): Promise<LocationDetail[]> {
  const q = encodeURIComponent(query.trim())
  // An unbounded viewbox around `near` prefers nearby matches without hiding
  // places elsewhere.
  const box = near ? `&viewbox=${near.lng - 0.5},${near.lat + 0.5},${near.lng + 0.5},${near.lat - 0.5}` : ''
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${q}${box}`, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'Hindsite/0.1 (https://hindsite.app)' },
  })
  if (!res.ok) return []
  const hits = (await res.json()) as NominatimSearch[]
  return hits.map((h) => ({ ...placeFrom(h), lat: Number(h.lat), lng: Number(h.lon) }))
}
