import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { streamChat } from '../api/chat'
import { formatDate, formatDateRange } from '../utils/date'
import { locationDisplay } from '../utils/location'

const SUGGESTED = [
  { label: 'What has my career journey looked like?', icon: '💼' },
  { label: 'Where have I travelled and when?', icon: '✈️' },
  { label: 'Add a new event to my timeline', icon: '➕' },
  { label: 'Update an existing event', icon: '✏️' },
]

const TYPE_STYLES = {
  career: 'bg-blue-100 text-blue-700',
  travel: 'bg-green-100 text-green-700',
  milestone: 'bg-purple-100 text-purple-700',
  family: 'bg-orange-100 text-orange-700',
}

// Converts the internal messages array to clean {role, content} pairs for the API
function toApiMessages(messages) {
  return messages
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content }))
}

function formatChangeValue(field, value) {
  if (value == null) return '—'
  if (field === 'date' || field === 'end_date') {
    const iso = value.includes('T') ? value : `${value}T00:00:00Z`
    return formatDate(iso)
  }
  if (field === 'location') return locationDisplay(value) ?? '—'
  if (field === 'tags') return Array.isArray(value) ? value.join(', ') : String(value)
  return String(value)
}

const FIELD_LABELS = {
  title: 'Title',
  date: 'Date',
  end_date: 'End date',
  event_type: 'Type',
  description: 'Description',
  location: 'Location',
  tags: 'Tags',
}

export default function ChatView() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState('all')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const updateLast = (patch) =>
    setMessages((m) => {
      const updated = [...m]
      updated[updated.length - 1] = { ...updated[updated.length - 1], ...patch }
      return updated
    })

  const updateAt = (index, patch) =>
    setMessages((m) => {
      if (index < 0 || index >= m.length) return m
      const updated = [...m]
      updated[index] = { ...updated[index], ...patch }
      return updated
    })

  const runChat = async (history, action = null) => {
    const assistantMsg = {
      role: 'assistant',
      content: '',
      sources: [],
      thinking: true,
      eventAction: null,
      pendingEdit: null,
    }
    setMessages((m) => [...m, assistantMsg])
    setStreaming(true)

    await streamChat(history, filter, {
      onSources: (sources) => updateLast({ sources }),
      onToken: (token) =>
        setMessages((m) => {
          const updated = [...m]
          const last = updated[updated.length - 1]
          updated[updated.length - 1] = {
            ...last,
            content: last.content + token,
            thinking: false,
          }
          return updated
        }),
      onEventCreated: (event) => updateLast({ eventAction: { type: 'created', event } }),
      onEventUpdated: (event) => updateLast({ eventAction: { type: 'updated', event } }),
      onPendingEdit: (data) =>
        updateLast({
          pendingEdit: {
            target: data.target,
            alternatives: data.alternatives || [],
            changes: data.changes || {},
            status: 'awaiting',
          },
          thinking: false,
        }),
      onDone: () => {
        setStreaming(false)
        updateLast({ thinking: false })
      },
    }, action)
  }

  const sendMessage = async (text) => {
    const q = text.trim()
    if (!q || streaming) return
    setInput('')
    const userMsg = { role: 'user', content: q }
    setMessages((m) => [...m, userMsg])
    const historyForApi = toApiMessages([...messages, userMsg])
    await runChat(historyForApi)
  }

  const confirmPendingEdit = async (messageIndex, eventId, changes, label) => {
    if (streaming) return
    // Lock the card immediately so it can't be double-clicked.
    updateAt(messageIndex, {
      pendingEdit: { ...messages[messageIndex].pendingEdit, status: 'confirmed' },
    })
    const userMsg = { role: 'user', content: label }
    setMessages((m) => [...m, userMsg])
    const historyForApi = toApiMessages([...messages.slice(0, messageIndex + 1), userMsg])
    await runChat(historyForApi, {
      type: 'confirm_edit',
      event_id: eventId,
      changes,
    })
  }

  const cancelPendingEdit = (messageIndex) => {
    updateAt(messageIndex, {
      pendingEdit: { ...messages[messageIndex].pendingEdit, status: 'cancelled' },
    })
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <h1 className="text-2xl font-bold text-gray-900 flex-1">Chat with your Timeline</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white text-gray-700"
        >
          <option value="all">All Events</option>
          <option value="career">Career</option>
          <option value="travel">Travel</option>
          <option value="milestone">Milestones</option>
          <option value="family">Family</option>
        </select>
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">
        {messages.length === 0 ? (
          <EmptyState onSelect={sendMessage} />
        ) : (
          messages.map((msg, i) => (
            <MessageRow
              key={i}
              msg={msg}
              messageIndex={i}
              streaming={streaming}
              onConfirm={confirmPendingEdit}
              onCancel={cancelPendingEdit}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(input) }}
          disabled={streaming}
          placeholder={streaming ? 'Thinking…' : 'Ask or say "add an event"…'}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-gray-50"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={streaming || !input.trim()}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({ onSelect }) {
  return (
    <div className="text-center py-16">
      <p className="text-gray-400 mb-2 text-sm">Ask questions or manage your timeline with natural language.</p>
      <p className="text-gray-300 mb-6 text-xs">Try one of these to get started:</p>
      <div className="space-y-2 max-w-sm mx-auto">
        {SUGGESTED.map(({ label, icon }) => (
          <button
            key={label}
            onClick={() => onSelect(label)}
            className="flex items-center gap-3 w-full text-left px-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-blue-50 hover:border-blue-200 transition-colors"
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageRow({ msg, messageIndex, streaming, onConfirm, onCancel }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} items-start gap-2`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5 text-sm">
          🤖
        </div>
      )}
      <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
        isUser ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-800'
      }`}>
        {msg.thinking ? (
          <p className="text-sm text-gray-400 italic animate-pulse">Thinking…</p>
        ) : (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        )}

        {/* Pending edit confirmation card */}
        {msg.pendingEdit && !msg.thinking && (
          <PendingEditCard
            pendingEdit={msg.pendingEdit}
            disabled={streaming}
            onConfirm={(eventId, label) =>
              onConfirm(messageIndex, eventId, msg.pendingEdit.changes, label)
            }
            onCancel={() => onCancel(messageIndex)}
          />
        )}

        {/* Event action card (create / update result) */}
        {msg.eventAction && !msg.thinking && (
          <EventActionCard action={msg.eventAction.type} event={msg.eventAction.event} />
        )}

        {/* Sources (query results) */}
        {!isUser && msg.sources?.length > 0 && !msg.thinking && !msg.eventAction && !msg.pendingEdit && (
          <Sources sources={msg.sources} />
        )}
      </div>
    </div>
  )
}

function PendingEditCard({ pendingEdit, disabled, onConfirm, onCancel }) {
  const { target, alternatives, changes, status } = pendingEdit
  const [picking, setPicking] = useState(false)

  const changeRows = Object.entries(changes)
    .filter(([k]) => FIELD_LABELS[k])
    .map(([k, v]) => ({ field: k, label: FIELD_LABELS[k], value: formatChangeValue(k, v) }))

  if (status === 'cancelled') {
    return (
      <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">
        Edit cancelled. Try again with more detail about which event you mean.
      </div>
    )
  }

  if (status === 'confirmed') {
    return (
      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
        Applying your changes…
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-2.5">
      {!picking ? (
        <>
          <EventSummary event={target} />
          {changeRows.length > 0 && (
            <div className="rounded-md bg-white border border-amber-200 px-2.5 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-1">
                Proposed changes
              </p>
              <ul className="space-y-0.5">
                {changeRows.map((row) => (
                  <li key={row.field} className="text-xs text-gray-700">
                    <span className="text-gray-500">{row.label}:</span>{' '}
                    <span className="font-medium">{row.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onConfirm(target._id, `Yes, update "${target.title}".`)
              }
              className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Confirm
            </button>
            {alternatives.length > 0 && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setPicking(true)}
                className="px-3 py-1.5 bg-white border border-amber-300 text-amber-800 text-xs font-medium rounded-md hover:bg-amber-100 disabled:opacity-50 transition-colors"
              >
                Choose another
              </button>
            )}
            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-amber-800 font-medium">Pick the event you meant:</p>
          <ul className="space-y-1.5">
            {alternatives.map((alt) => (
              <li key={alt._id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() =>
                    onConfirm(alt._id, `Use "${alt.title}" instead.`)
                  }
                  className="w-full text-left rounded-md border border-amber-200 bg-white px-2.5 py-2 hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                >
                  <EventSummary event={alt} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPicking(false)}
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              None of these
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function EventSummary({ event }) {
  const dateDisplay = formatDateRange(event.date, event.end_date)
  const loc = locationDisplay(event.location)
  return (
    <div>
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${TYPE_STYLES[event.event_type] ?? 'bg-gray-100 text-gray-600'}`}>
          {event.event_type}
        </span>
        <span className="text-sm font-medium text-gray-900">{event.title}</span>
      </div>
      <p className="text-xs text-gray-500">
        {dateDisplay}{loc ? ` · ${loc}` : ''}
      </p>
    </div>
  )
}

function EventActionCard({ action, event }) {
  const isCreated = action === 'created'
  const dateDisplay = formatDateRange(event.date, event.end_date)
  return (
    <Link
      to={`/events/${event._id}`}
      className={`block mt-3 rounded-lg border-l-4 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors ${
        isCreated ? 'border-green-500' : 'border-blue-500'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${isCreated ? 'text-green-600' : 'text-blue-600'}`}>
          {isCreated ? '✓ Event created' : '✓ Event updated'}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_STYLES[event.event_type] ?? 'bg-gray-100 text-gray-600'}`}>
          {event.event_type}
        </span>
      </div>
      <p className="text-sm font-medium text-gray-900">{event.title}</p>
      <p className="text-xs text-gray-500 mt-0.5">
        {dateDisplay}{locationDisplay(event.location) ? ` · ${locationDisplay(event.location)}` : ''}
      </p>
      <p className="text-xs text-blue-500 mt-1">View or edit →</p>
    </Link>
  )
}

function Sources({ sources }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 pt-2 border-t border-gray-100">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
      >
        {open ? '▾' : '▸'} Sources ({sources.length})
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5">
          {sources.map((s, i) => (
            <li key={i} className="text-xs text-gray-500">&bull; {s}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
