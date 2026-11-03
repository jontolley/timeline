import { httpJson } from './client'
import type { Thread } from './types'

export function listThreads(): Promise<Thread[]> {
  return httpJson<Thread[]>('/threads')
}

export function createThread(data: Partial<Thread>): Promise<Thread> {
  return httpJson<Thread>('/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function updateThread(id: string, data: Partial<Thread>): Promise<Thread> {
  return httpJson<Thread>(`/threads/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export function deleteThread(id: string): Promise<{ ok: boolean }> {
  return httpJson(`/threads/${id}`, { method: 'DELETE' })
}

export function inviteToThread(threadId: string, email: string): Promise<unknown> {
  return httpJson(`/threads/${threadId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
}

export function listSubscribers(threadId: string): Promise<unknown> {
  return httpJson(`/threads/${threadId}/subscribers`)
}

export function revokeSubscriber(threadId: string, subscriberUserId: string): Promise<unknown> {
  return httpJson(`/threads/${threadId}/subscribers/${subscriberUserId}`, { method: 'DELETE' })
}

export function setSubscriptionVisible(subscriptionId: string, visible: boolean): Promise<unknown> {
  return httpJson(`/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visible }),
  })
}

export function unsubscribeFromThread(subscriptionId: string): Promise<unknown> {
  return httpJson(`/subscriptions/${subscriptionId}`, { method: 'DELETE' })
}
