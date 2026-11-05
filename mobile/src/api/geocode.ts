import type { LocationDetail } from './types'

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

// Free-text place search for the location picker (the web LocationPicker's
// Nominatim search). Same naming as reverseGeocode.
export async function searchPlaces(query: string): Promise<LocationDetail[]> {
  const q = encodeURIComponent(query.trim())
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${q}`, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'Hindsite/0.1 (https://hindsite.app)' },
  })
  if (!res.ok) return []
  const hits = (await res.json()) as NominatimSearch[]
  return hits.map((h) => ({ ...placeFrom(h), lat: Number(h.lat), lng: Number(h.lon) }))
}
