const BASE = '/api/events'

export async function listEvents(params = {}) {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${BASE}${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error('Failed to fetch events')
  return res.json()
}

export async function getEvent(id) {
  const res = await fetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Event not found')
  return res.json()
}

export async function createEvent(data) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create event')
  return res.json()
}

export async function updateEvent(id, data) {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update event')
  return res.json()
}

export async function deleteEvent(id) {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete event')
  return res.json()
}
