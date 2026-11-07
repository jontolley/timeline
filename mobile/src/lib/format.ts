import type { MediaRef, TimelineEvent } from '@/api/types'

// Shared date / place / media helpers for the timeline, detail, search and chat.
// Dates are stored UTC; format in UTC so the day never shifts (see the web
// app's utils/date.js invariant).

export function monthKey(iso: string): string {
  return iso.slice(0, 7) // YYYY-MM
}
export function monthName(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long' })
}
// "Tue, Nov 3"
export function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
}
// "Nov 3, 2026"
export function mediumDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const full = iso.includes('T') ? iso : `${iso}T00:00:00Z`
  return new Date(full).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
}
// A card's day: "Tue, Nov 3", or "Aug 14 – 16" / "Aug 30 – Sep 2" for a range.
export function cardDay(ev: Pick<TimelineEvent, 'date' | 'end_date'>): string {
  const end = ev.end_date
  if (!end || end.slice(0, 10) === ev.date.slice(0, 10)) return shortDay(ev.date)
  const s = new Date(ev.date)
  const e = new Date(end)
  const mon = (d: Date) => d.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short' })
  if (s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth()) {
    return `${mon(s)} ${s.getUTCDate()} – ${e.getUTCDate()}`
  }
  return `${mon(s)} ${s.getUTCDate()} – ${mon(e)} ${e.getUTCDate()}`
}
// "Today · Fri, Nov 6" uses the *local* calendar day.
export function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// Whole months between two YYYY-MM keys (later minus earlier).
export function monthsBetween(laterKey: string, earlierKey: string): number {
  const [ly, lm] = laterKey.split('-').map(Number)
  const [ey, em] = earlierKey.split('-').map(Number)
  return (ly - ey) * 12 + (lm - em)
}
export function monthNameOfKey(key: string): string {
  return monthName(`${key}-15T00:00:00Z`)
}
// The break between two months that have moments: one empty month is named,
// longer stretches are counted.
export function gapLabel(newerKey: string, olderKey: string): string | null {
  const diff = monthsBetween(newerKey, olderKey)
  if (diff <= 1) return null
  if (diff === 2) {
    const [y, m] = olderKey.split('-').map(Number)
    const between = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    return `Nothing in ${monthNameOfKey(between)}`
  }
  const quiet = diff - 1
  if (quiet < 12) return `Quiet for ${quiet} months`
  const years = Math.floor(quiet / 12)
  return `Quiet for ${years === 1 ? 'a year' : `${years} years`}${quiet % 12 >= 6 ? ' and a half' : ''}`
}

export type Loc = { name?: string | null; address?: string | null; lat?: number | null; lng?: number | null; url?: string | null }
export function asLoc(loc: TimelineEvent['location']): Loc | null {
  if (!loc) return null
  if (typeof loc === 'string') return { name: loc }
  return loc
}
export function placeLabel(loc: TimelineEvent['location']): string | null {
  const l = asLoc(loc)
  return l ? l.name || l.address || null : null
}
export function hasCoords(loc: TimelineEvent['location']): boolean {
  const l = asLoc(loc)
  return l?.lat != null && l?.lng != null
}

export function isVisual(m: MediaRef): boolean {
  const k = m.kind || 'photo'
  return k === 'photo' || k === 'video'
}
// Card photos are ~300pt wide, so prefer the full image over the 400px thumb
// for photos; videos only have a poster thumb. R2 URLs are re-signed on every
// read; key the image cache on the stable object key so a refresh doesn't
// re-download every photo.
export function coverSource(m: MediaRef): { uri: string; cacheKey: string } | null {
  const uri = (m.kind || 'photo') === 'photo' ? m.url || m.thumb_url : m.thumb_url
  return uri ? { uri, cacheKey: m.key } : null
}
export function thumbSource(m: MediaRef): { uri: string; cacheKey: string } | null {
  const isPhoto = (m.kind || 'photo') === 'photo'
  const uri = m.thumb_url || (isPhoto ? m.url : null)
  return uri ? { uri, cacheKey: `${m.key}:thumb` } : null
}

export function fmtDuration(sec: number | null | undefined): string | null {
  if (sec == null || !isFinite(sec)) return null
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// What a moment leads with on a card: its photos/video, a map, an audio
// player, a document, or just its words.
export type CardKind = 'photo' | 'video' | 'map' | 'audio' | 'doc' | 'note'
export function cardKind(ev: TimelineEvent): CardKind {
  const media = ev.media || []
  const visual = media.filter(isVisual)
  if (visual.length) return (visual[0].kind || 'photo') === 'video' ? 'video' : 'photo'
  if (media.some((m) => m.kind === 'audio')) return 'audio'
  if (hasCoords(ev.location)) return 'map'
  if (media.some((m) => m.kind === 'pdf')) return 'doc'
  return 'note'
}

// "12 photos", "Video · 0:42", "Place", "Audio · 3:12", "Document", "Note".
export function kindLabel(ev: TimelineEvent): string {
  const media = ev.media || []
  const kind = cardKind(ev)
  if (kind === 'photo' || kind === 'video') {
    const visual = media.filter(isVisual)
    const photos = visual.filter((m) => (m.kind || 'photo') === 'photo').length
    if (visual.length === 1 && kind === 'video') {
      const d = fmtDuration(visual[0].duration_seconds)
      return d ? `Video · ${d}` : 'Video'
    }
    if (photos === visual.length) return `${photos} photo${photos === 1 ? '' : 's'}`
    return `${visual.length} items`
  }
  if (kind === 'audio') {
    const d = fmtDuration(media.find((m) => m.kind === 'audio')?.duration_seconds)
    return d ? `Audio · ${d}` : 'Audio'
  }
  if (kind === 'map') return 'Place'
  if (kind === 'doc') return 'Document'
  return 'Note'
}

// Names of the people on a moment. Shared events carry their owner's names in
// people_display; owned ones resolve ids through the caller's people list.
export function peopleNames(ev: TimelineEvent, nameById: Record<string, string>): string[] {
  if (ev.is_owner === false) return (ev.people_display || []).map((p) => p.name)
  return (ev.people || []).map((id) => nameById[id]).filter((n): n is string => !!n)
}
export function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(' & ')
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

// A stable small number from a string, to seed decorative waveforms.
export function seedOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (Math.abs(h) % 997) + 1
}
