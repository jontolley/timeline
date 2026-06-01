import { fetch as expoFetch } from 'expo/fetch'
import { API } from '../config'
import { getAuthToken } from './client'
import type { TimelineEvent } from './types'

// Ported from frontend/src/api/chat.js. The web version reads the SSE stream
// via `res.body.getReader()`; React Native's global fetch doesn't expose a
// streaming body, so we use `expo/fetch` (Expo SDK 52+) which does. The
// line-buffering + `data: ` parsing is otherwise identical.

export type ChatCallbacks = {
  onSources?: (events: TimelineEvent[]) => void
  onToken?: (text: string) => void
  onEventCreated?: (event: TimelineEvent) => void
  onEventUpdated?: (event: TimelineEvent) => void
  onPendingEdit?: (data: unknown) => void
  onDone?: () => void
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function streamChat(
  messages: ChatMessage[],
  eventFilter: unknown,
  callbacks: ChatCallbacks,
  action: string | null = null,
): Promise<void> {
  const { onSources, onToken, onEventCreated, onEventUpdated, onPendingEdit, onDone } = callbacks
  const token = getAuthToken()
  const res = await expoFetch(`${API}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, event_filter: eventFilter, action }),
  })

  if (res.status === 401) throw new Error('Unauthorized')
  if (!res.body) throw new Error('No response stream')

  const reader = res.body.getReader()
  // TextDecoder is available in Hermes on Expo SDK 52; stream:true stitches
  // multi-byte sequences that straddle chunk boundaries.
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))
        if (data.type === 'sources') onSources?.(data.events)
        else if (data.type === 'token') onToken?.(data.content)
        else if (data.type === 'event_created') onEventCreated?.(data.event)
        else if (data.type === 'event_updated') onEventUpdated?.(data.event)
        else if (data.type === 'pending_edit') onPendingEdit?.(data)
        else if (data.type === 'done') onDone?.()
      } catch {
        // ignore malformed lines
      }
    }
  }
}
