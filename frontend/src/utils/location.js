/** Returns the best human-readable label for a location, handling legacy strings. */
export function locationDisplay(loc) {
  if (!loc) return null
  if (typeof loc === 'string') return loc
  return loc.name || loc.address || null
}

/** Returns a map URL for the location — the original Google / Apple Maps share
 *  link when the place came from one, else a Google Maps link — or null if not
 *  enough info. */
export function locationMapUrl(loc) {
  if (!loc || typeof loc === 'string') return null
  if (loc.url) return loc.url
  if (loc.lat != null && loc.lng != null) {
    return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
  }
  const query = loc.address || loc.name
  if (query) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }
  return null
}
