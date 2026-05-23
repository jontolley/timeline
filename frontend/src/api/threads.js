import { http } from './http'

const BASE = '/api/threads'

export async function listThreads() {
  const res = await http(BASE)
  if (!res.ok) throw new Error('Failed to fetch threads')
  return res.json()
}

export async function createThread(data) {
  const res = await http(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to create thread')
  }
  return res.json()
}

export async function updateThread(id, data) {
  const res = await http(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to update thread')
  }
  return res.json()
}

export async function deleteThread(id) {
  const res = await http(`${BASE}/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to delete thread')
  }
  return res.json()
}
