import { http } from './http'

const BASE = '/api/events'

export async function listEvents(params = {}) {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue
    if (Array.isArray(value)) {
      for (const v of value) if (v) usp.append(key, v)
    } else {
      usp.set(key, value)
    }
  }
  const qs = usp.toString()
  const res = await http(`${BASE}${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error('Failed to fetch events')
  return res.json()
}

export async function getEvent(id) {
  const res = await http(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Event not found')
  return res.json()
}

export async function createEvent(data) {
  const res = await http(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create event')
  return res.json()
}

export async function updateEvent(id, data) {
  const res = await http(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update event')
  return res.json()
}

export async function deleteEvent(id) {
  const res = await http(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete event')
  return res.json()
}

export async function attachMedia(eventId, media) {
  const res = await http(`${BASE}/${eventId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(media),
  })
  if (!res.ok) throw new Error('Failed to attach media')
  return res.json()
}

export async function removeMedia(eventId, key) {
  const res = await http(`${BASE}/${eventId}/media/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to remove media')
  return res.json()
}
