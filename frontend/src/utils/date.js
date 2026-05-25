/** True when the stored UTC time is anything other than midnight. */
export function hasTime(isoDate) {
  if (!isoDate) return false
  const d = new Date(isoDate)
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 || d.getUTCSeconds() !== 0
}

export function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export function formatTime(isoDate) {
  return new Date(isoDate).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  })
}

export function formatDateRange(startIso, endIso) {
  const start = formatDate(startIso)
  const startTime = hasTime(startIso) ? ` at ${formatTime(startIso)}` : ''
  if (!endIso) return `${start}${startTime}`
  const end = formatDate(endIso)
  const endTime = hasTime(endIso) ? ` at ${formatTime(endIso)}` : ''
  return `${start}${startTime} – ${end}${endTime}`
}

/** Short date stamp for the rail: "MAY 08". */
export function shortDate(isoDate) {
  if (!isoDate) return ''
  return new Date(isoDate)
    .toLocaleDateString('en-US', {
      month: 'short', day: '2-digit', timeZone: 'UTC',
    })
    .toUpperCase()
}

/** Compact range used in event card meta: "Apr 3, 2026 → Apr 12, 2026". */
export function formatRangeCompact(startIso, endIso) {
  const start = new Date(startIso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  if (!endIso) return start
  const end = new Date(endIso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  return `${start} → ${end}`
}

export function yearOf(isoDate) {
  if (!isoDate) return null
  return new Date(isoDate).getUTCFullYear()
}

/** 0-based month index in UTC (Jan = 0). Pairs with yearOf for grouping. */
export function monthOf(isoDate) {
  if (!isoDate) return null
  return new Date(isoDate).getUTCMonth()
}

/** "May" / "April" — long month name. */
export function monthNameOf(isoDate) {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
}

/** 1-based day of month in UTC. */
export function dayOf(isoDate) {
  if (!isoDate) return null
  return new Date(isoDate).getUTCDate()
}

/** "May 23" — short month + day. Used in the per-day timeline column. */
export function monthDayShort(isoDate) {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

/** "Sat" — short weekday label. */
export function weekdayShort(isoDate) {
  if (!isoDate) return ''
  return new Date(isoDate).toLocaleDateString('en-US', {
    weekday: 'short', timeZone: 'UTC',
  })
}
