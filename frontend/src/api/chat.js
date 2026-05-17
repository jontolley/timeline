export async function streamChat(messages, eventFilter, callbacks, action = null) {
  const { onSources, onToken, onEventCreated, onEventUpdated, onPendingEdit, onDone } = callbacks
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages, event_filter: eventFilter, action }),
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'))
    throw new Error('Unauthorized')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

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
