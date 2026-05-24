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

export async function inviteToThread(threadId, email) {
  const res = await http(`${BASE}/${threadId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to invite')
  }
  return res.json()
}

export async function listSubscribers(threadId) {
  const res = await http(`${BASE}/${threadId}/subscribers`)
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to load subscribers')
  }
  return res.json()
}

export async function revokeSubscriber(threadId, subscriberUserId) {
  const res = await http(`${BASE}/${threadId}/subscribers/${subscriberUserId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to revoke')
  }
  return res.json()
}

export async function setSubscriptionVisible(subscriptionId, visible) {
  const res = await http(`/api/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visible }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to update subscription')
  }
  return res.json()
}

export async function unsubscribeFromThread(subscriptionId) {
  const res = await http(`/api/subscriptions/${subscriptionId}`, { method: 'DELETE' })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Failed to unsubscribe')
  }
  return res.json()
}
