import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, formatDateRange } from '../utils/date'
import { locationDisplay } from '../utils/location'
import { usePeopleStore, useChatStore } from '../store'
import PeopleChips from '../components/PeopleChips'

const SUGGESTED = [
  { label: 'What has my career journey looked like?', icon: '💼' },
  { label: 'Where have I travelled and when?', icon: '✈️' },
  { label: 'Add a new event to my timeline', icon: '➕' },
  { label: 'Update an existing event', icon: '✏️' },
]

const TYPE_STYLES = {
  career:    'bg-indigo-50 text-indigo-700',
  travel:    'bg-emerald-50 text-emerald-700',
  milestone: 'bg-violet-50 text-violet-700',
  family:    'bg-amber-50 text-amber-700',
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
  people: 'People',
}

export default function ChatView() {
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const { peopleById, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()
  const {
    messages,
    filter,
    streaming,
    setFilter,
    reset,
    sendMessage: sendStoreMessage,
    confirmPendingEdit,
    cancelPendingEdit,
  } = useChatStore()

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Return focus to the input once the assistant is done streaming, so the
  // user can immediately type a follow-up.
  useEffect(() => {
    if (!streaming) inputRef.current?.focus()
  }, [streaming])

  const sendMessage = (text) => {
    setInput('')
    sendStoreMessage(text)
  }

  const startNewChat = () => {
    if (streaming) return
    reset()
    setInput('')
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 130px)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tighter2 leading-none text-ink flex-1">Chat</h1>
        <button
          type="button"
          onClick={startNewChat}
          disabled={streaming || messages.length === 0}
          title="Start a new chat session"
          className="border border-ink-line rounded-md px-3 py-1.5 text-sm bg-white text-ink-soft hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          + New chat
        </button>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-ink-line rounded-md px-3 py-1.5 text-sm bg-white text-ink-soft"
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
              peopleById={peopleById}
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
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(input) }}
          disabled={streaming}
          placeholder={streaming ? 'Thinking…' : 'Ask or say "add an event"…'}
          className="flex-1 border border-ink-line rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-ring disabled:opacity-50 disabled:bg-surface"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={streaming || !input.trim()}
          className="px-5 py-2.5 bg-ink text-paper rounded-lg text-sm font-medium hover:bg-ink-soft disabled:opacity-50 transition-colors"
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
      <p className="text-ink-faint mb-2 text-sm">Ask questions or manage your timeline with natural language.</p>
      <p className="text-ink-faint mb-6 text-xs">Try one of these to get started:</p>
      <div className="space-y-2 max-w-sm mx-auto">
        {SUGGESTED.map(({ label, icon }) => (
          <button
            key={label}
            onClick={() => onSelect(label)}
            className="flex items-center gap-3 w-full text-left px-4 py-2.5 bg-white border border-ink-line rounded-lg text-sm text-ink-soft hover:bg-accent-soft hover:ring-accent-ring transition-colors"
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageRow({ msg, messageIndex, streaming, peopleById, onConfirm, onCancel }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} items-start gap-2`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center shrink-0 mt-0.5 text-sm">
          🤖
        </div>
      )}
      <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
        isUser ? 'bg-ink text-paper' : 'bg-white border border-ink-line text-ink'
      }`}>
        {msg.thinking ? (
          <p className="text-sm text-ink-faint italic animate-pulse">Thinking…</p>
        ) : (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
        )}

        {/* Pending edit confirmation card */}
        {msg.pendingEdit && !msg.thinking && (
          <PendingEditCard
            pendingEdit={msg.pendingEdit}
            disabled={streaming}
            peopleById={peopleById}
            onConfirm={(eventId, label) =>
              onConfirm(messageIndex, eventId, msg.pendingEdit.changes, label)
            }
            onCancel={() => onCancel(messageIndex)}
          />
        )}

        {/* Event action card (create / update result) */}
        {msg.eventAction && !msg.thinking && (
          <EventActionCard
            action={msg.eventAction.type}
            event={msg.eventAction.event}
            peopleById={peopleById}
          />
        )}

        {/* Sources (query results) */}
        {!isUser && msg.sources?.length > 0 && !msg.thinking && !msg.eventAction && !msg.pendingEdit && (
          <Sources sources={msg.sources} />
        )}
      </div>
    </div>
  )
}

function PendingEditCard({ pendingEdit, disabled, peopleById, onConfirm, onCancel }) {
  const { target, alternatives, changes, status } = pendingEdit
  const [picking, setPicking] = useState(false)

  const changeRows = Object.entries(changes)
    .filter(([k]) => FIELD_LABELS[k])
    .map(([k, v]) => ({ field: k, label: FIELD_LABELS[k], value: v }))

  if (status === 'cancelled') {
    return (
      <div className="mt-3 rounded-lg border border-ink-line bg-surface px-3 py-2.5 text-xs text-ink-mute">
        Edit cancelled. Try again with more detail about which event you mean.
      </div>
    )
  }

  if (status === 'confirmed') {
    return (
      <div className="mt-3 rounded-lg border ring-accent-ring bg-accent-soft px-3 py-2.5 text-xs text-accent">
        Applying your changes…
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 space-y-2.5">
      {!picking ? (
        <>
          <EventSummary event={target} peopleById={peopleById} />
          {changeRows.length > 0 && (
            <div className="rounded-md bg-white border border-amber-200 px-2.5 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 mb-1">
                Proposed changes
              </p>
              <ul className="space-y-1">
                {changeRows.map((row) => (
                  <li key={row.field} className="text-xs text-ink-soft">
                    <span className="text-ink-mute">{row.label}:</span>{' '}
                    {row.field === 'people' ? (
                      <span className="inline-flex align-middle">
                        <PeopleChips peopleIds={row.value || []} peopleById={peopleById} />
                      </span>
                    ) : (
                      <span className="font-medium">{formatChangeValue(row.field, row.value)}</span>
                    )}
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
              className="px-3 py-1.5 bg-white border border-ink-line text-ink-soft text-xs font-medium rounded-md hover:bg-surface disabled:opacity-50 transition-colors"
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
                  <EventSummary event={alt} peopleById={peopleById} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPicking(false)}
              className="px-3 py-1.5 bg-white border border-ink-line text-ink-soft text-xs font-medium rounded-md hover:bg-surface disabled:opacity-50 transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className="px-3 py-1.5 bg-white border border-ink-line text-ink-soft text-xs font-medium rounded-md hover:bg-surface disabled:opacity-50 transition-colors"
            >
              None of these
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function EventSummary({ event, peopleById }) {
  const dateDisplay = formatDateRange(event.date, event.end_date)
  const loc = locationDisplay(event.location)
  return (
    <div>
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${TYPE_STYLES[event.event_type] ?? 'bg-surface text-ink-mute'}`}>
          {event.event_type}
        </span>
        <span className="text-sm font-medium text-ink">{event.title}</span>
      </div>
      <p className="text-xs text-ink-mute">
        {dateDisplay}{loc ? ` · ${loc}` : ''}
      </p>
      {event.people?.length > 0 && peopleById && (
        <div className="mt-1">
          <PeopleChips peopleIds={event.people} peopleById={peopleById} />
        </div>
      )}
    </div>
  )
}

function EventActionCard({ action, event, peopleById }) {
  const isCreated = action === 'created'
  const dateDisplay = formatDateRange(event.date, event.end_date)
  return (
    <Link
      to={`/events/${event._id}`}
      className={`block mt-3 rounded-lg border-l-4 px-3 py-2.5 bg-surface hover:bg-surface transition-colors ${
        isCreated ? 'border-emerald-500' : 'border-accent'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold uppercase tracking-wide ${isCreated ? 'text-emerald-600' : 'text-accent'}`}>
          {isCreated ? '✓ Event created' : '✓ Event updated'}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_STYLES[event.event_type] ?? 'bg-surface text-ink-mute'}`}>
          {event.event_type}
        </span>
      </div>
      <p className="text-sm font-medium text-ink">{event.title}</p>
      <p className="text-xs text-ink-mute mt-0.5">
        {dateDisplay}{locationDisplay(event.location) ? ` · ${locationDisplay(event.location)}` : ''}
      </p>
      {event.people?.length > 0 && peopleById && (
        <div className="mt-1.5">
          <PeopleChips peopleIds={event.people} peopleById={peopleById} />
        </div>
      )}
      <p className="text-xs text-accent mt-1">View or edit →</p>
    </Link>
  )
}

function Sources({ sources }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 pt-2 border-t border-ink-line">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-ink-faint hover:text-ink-mute flex items-center gap-1"
      >
        {open ? '▾' : '▸'} Sources ({sources.length})
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5">
          {sources.map((s, i) => (
            <li key={i} className="text-xs text-ink-mute">&bull; {s}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
