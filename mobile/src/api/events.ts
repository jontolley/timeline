import { http, httpJson } from './client'
import type { TimelineEvent, YearCount } from './types'

// Ported from frontend/src/api/events.js. Same query-builder semantics:
// arrays become repeated params (e.g. thread_ids), empty/null values dropped.
function buildQuery(params: Record<string, unknown>): string {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) {
      for (const v of value) if (v) usp.append(key, String(v))
    } else {
      usp.set(key, String(value))
    }
  }
  return usp.toString()
}

export function listEvents(params: Record<string, unknown> = {}): Promise<TimelineEvent[]> {
  const qs = buildQuery(params)
  return httpJson<TimelineEvent[]>(`/events${qs ? `?${qs}` : ''}`)
}

export function listEventYears(params: Record<string, unknown> = {}): Promise<YearCount[]> {
  const qs = buildQuery(params)
  return httpJson<YearCount[]>(`/events/years${qs ? `?${qs}` : ''}`)
}

export function searchEvents(params: Record<string, unknown> = {}): Promise<TimelineEvent[]> {
  const qs = buildQuery(params)
  return httpJson<TimelineEvent[]>(`/events/search${qs ? `?${qs}` : ''}`)
}

export function getEvent(id: string): Promise<TimelineEvent> {
  return httpJson<TimelineEvent>(`/events/${id}`)
}

export function createEvent(data: Partial<TimelineEvent>): Promise<TimelineEvent> {
  return httpJson<TimelineEvent>('/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function updateEvent(id: string, data: Partial<TimelineEvent>): Promise<TimelineEvent> {
  return httpJson<TimelineEvent>(`/events/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteEvent(id: string): Promise<void> {
  const res = await http(`/events/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete event')
}

export function attachMedia(eventId: string, media: unknown): Promise<TimelineEvent> {
  return httpJson<TimelineEvent>(`/events/${eventId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(media),
  })
}

export async function removeMedia(eventId: string, key: string): Promise<void> {
  const res = await http(`/events/${eventId}/media/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to remove media')
}
