/** Returns true if the stored UTC time is anything other than midnight. */
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
