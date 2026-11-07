import { http } from './client'
import type { TimelineEvent } from './types'

// Ported from frontend/src/api/chat.js. Since SDK 56 the global fetch *is*
// `expo/fetch`, which exposes a streaming body, so this goes through the shared
// `http()` wrapper (Bearer token + 401 → sign-out) and reads the SSE stream
// with `res.body.getReader()` exactly like the web. Setting
// EXPO_PUBLIC_USE_RN_FETCH=1 would swap in RN's non-streaming fetch and break
// this. The line-buffering + `data: ` parsing is otherwise identical.

// Fields the backend may propose changing in an edit (see routes/chat.py).
export type EditChanges = Partial<
  Pick<TimelineEvent, 'title' | 'date' | 'end_date' | 'description' | 'location' | 'tags' | 'people'>
>

// The edit flow defers the write: it streams "does that look right?" then a
// pending_edit with the best match + alternatives. The client confirms by
// re-posting with a `confirm_edit` action.
export type PendingEdit = {
  target: TimelineEvent
  alternatives: TimelineEvent[]
  changes: EditChanges
}

export type ChatAction = { type: 'confirm_edit'; event_id: string; changes: EditChanges }

// A moment the answer drew on, most relevant first: enough to draw a tappable
// card (thumbnail is a signed R2 URL, null when the moment has no picture).
export type SourceItem = {
  _id: string
  title: string
  date: string
  end_date?: string | null
  kind: 'photo' | 'video' | 'audio' | 'place' | 'pdf' | 'note'
  media_count: number
  thumb_url?: string | null
}

export type ChatCallbacks = {
  // Titles of the events the answer drew on (what the web shows), plus — from
  // newer backends — `items` with ids and thumbnails for linked cards.
  onSources?: (titles: string[], items: SourceItem[]) => void
  onToken?: (text: string) => void
  onEventCreated?: (event: TimelineEvent) => void
  onEventUpdated?: (event: TimelineEvent) => void
  onPendingEdit?: (data: PendingEdit) => void
  onDone?: () => void
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export async function streamChat(
  messages: ChatMessage[],
  eventFilter: unknown,
  callbacks: ChatCallbacks,
  action: ChatAction | null = null,
): Promise<void> {
  const { onSources, onToken, onEventCreated, onEventUpdated, onPendingEdit, onDone } = callbacks
  const res = await http('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, event_filter: eventFilter, action }),
  })

  if (!res.ok) throw new Error(`Chat failed: ${res.status}`)
  if (!res.body) throw new Error('No response stream')

  const reader = res.body.getReader()
  // TextDecoder is built into Hermes; stream:true stitches
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
        if (data.type === 'sources') onSources?.(data.events, data.items ?? [])
        else if (data.type === 'token') onToken?.(data.content)
        else if (data.type === 'event_created') onEventCreated?.(data.event)
        else if (data.type === 'event_updated') onEventUpdated?.(data.event)
        else if (data.type === 'pending_edit') onPendingEdit?.(data as PendingEdit)
        else if (data.type === 'done') onDone?.()
      } catch {
        // ignore malformed lines
      }
    }
  }
}
