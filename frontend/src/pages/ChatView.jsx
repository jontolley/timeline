import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, formatDateRange } from '../utils/date'
import { locationDisplay } from '../utils/location'
import { categoryClass, categoryLabel, categoryStyle } from '../utils/eventTypes'
import { usePeopleStore, useChatStore } from '../store'
import PeopleChips from '../components/PeopleChips'

const SUGGESTIONS = [
  { mono: '?', text: 'What has my career journey looked like?' },
  { mono: '?', text: 'Where have I travelled and when?' },
  { mono: '+', text: 'Add a new event to my timeline' },
  { mono: '+', text: 'Update an existing event' },
]

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

function formatChangeValue(field, value) {
  if (value == null) return '—'
  if (field === 'date' || field === 'end_date') {
    const iso = String(value).includes('T') ? value : `${value}T00:00:00Z`
    return formatDate(iso)
  }
  if (field === 'location') return locationDisplay(value) ?? '—'
  if (field === 'tags') return Array.isArray(value) ? value.join(', ') : String(value)
  return String(value)
}

function autoResize(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

export default function ChatView() {
  const [draft, setDraft] = useState('')
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)
  const { peopleById, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()
  const {
    messages,
    streaming,
    reset,
    sendMessage,
    confirmPendingEdit,
    cancelPendingEdit,
  } = useChatStore()

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!streaming) textareaRef.current?.focus()
  }, [streaming])

  useEffect(() => {
    autoResize(textareaRef.current)
  }, [draft])

  const send = () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    sendMessage(text)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const startNewChat = () => {
    if (streaming) return
    reset()
    setDraft('')
  }

  const counts = useMemo(() => {
    const turns = messages.length
    const userTurns = messages.filter((m) => m.role === 'user').length
    return { turns, userTurns }
  }, [messages])

  return (
    <div className="chat-page">
      <header className="chat-head">
        <div>
          <h1 className="chat-title">Chat.</h1>
          <p className="chat-stats">
            {counts.turns === 0 ? (
              <span>start a conversation</span>
            ) : (
              <>
                <span>{counts.turns} {counts.turns === 1 ? 'message' : 'messages'}</span>
                {counts.userTurns > 0 && (
                  <>
                    <span className="sep" aria-hidden="true" />
                    <span>{counts.userTurns} {counts.userTurns === 1 ? 'question' : 'questions'}</span>
                  </>
                )}
                {streaming && (
                  <>
                    <span className="sep" aria-hidden="true" />
                    <span>thinking…</span>
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="chat-head-actions">
          <button
            type="button"
            className="btn"
            onClick={startNewChat}
            disabled={streaming || messages.length === 0}
          >
            + New chat
          </button>
        </div>
      </header>

      <div className="chat-thread" role="log" aria-live="polite">
        <div className="chat-thread-inner">
          {messages.length === 0 ? (
            <EmptyState onPick={(text) => sendMessage(text)} />
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
      </div>

      <div className="composer">
        <div className="composer-inner">
          {messages.length > 0 && (
            <div className="composer-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.text}
                  type="button"
                  className="suggestion"
                  onClick={() => setDraft(s.text)}
                  disabled={streaming}
                >
                  <span className="mono">{s.mono}</span>{s.text}
                </button>
              ))}
            </div>
          )}
          <div className="composer-input">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              placeholder={streaming ? 'Thinking…' : 'Ask, or say "add an event"…'}
              disabled={streaming}
              rows={1}
            />
            <button
              type="button"
              className="composer-send"
              onClick={send}
              disabled={streaming || !draft.trim()}
              aria-label="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M2 8 L13.5 8 M8 2.5 L13.5 8 L8 13.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function EmptyState({ onPick }) {
  return (
    <div className="chat-empty">
      <p className="chat-empty-eyebrow"><span className="pip" /> Talk to your timeline</p>
      <h2 className="chat-empty-title">What do you want <em>to know?</em></h2>
      <p className="chat-empty-sub">
        Ask questions across your history. Or say "add an event" and I'll capture it for you.
      </p>
      <div className="chat-empty-suggestions">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            type="button"
            className="suggestion"
            onClick={() => onPick(s.text)}
          >
            <span className="mono">{s.mono}</span>{s.text}
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageRow({ msg, messageIndex, streaming, peopleById, onConfirm, onCancel }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`msg ${isUser ? 'user' : 'assist'}`}>
      {!isUser && (
        <span className="msg-avatar" aria-hidden="true">T</span>
      )}
      <div className="msg-bubble">
        {msg.thinking ? (
          <p className="msg-thinking">Thinking…</p>
        ) : (
          <p className="whitespace-pre">{msg.content}</p>
        )}

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

        {msg.eventAction && !msg.thinking && (
          <EventActionCard
            action={msg.eventAction.type}
            event={msg.eventAction.event}
            peopleById={peopleById}
          />
        )}

        {!isUser && msg.sources?.length > 0 && !msg.thinking && !msg.eventAction && !msg.pendingEdit && (
          <Sources sources={msg.sources} />
        )}
      </div>
    </div>
  )
}

function EventActionCard({ action, event, peopleById }) {
  const isCreated = action === 'created'
  return (
    <Link
      to={`/events/${event._id}`}
      className={`event-receipt ${categoryClass(event.event_type)}`}
      style={categoryStyle(event.event_type)}
    >
      <div className="receipt-head">
        <span className={`receipt-status ${isCreated ? '' : 'updated'}`}>
          ✓ event {isCreated ? 'created' : 'updated'}
        </span>
        <span className="receipt-cat">{categoryLabel(event.event_type) || event.event_type}</span>
      </div>
      <p className="receipt-title">{event.title}</p>
      <div className="receipt-date">
        {formatDateRange(event.date, event.end_date)}
      </div>
      <span className="receipt-link">View or edit →</span>
    </Link>
  )
}

function PendingEditCard({ pendingEdit, disabled, peopleById, onConfirm, onCancel }) {
  const { target, alternatives, changes, status } = pendingEdit
  const [picking, setPicking] = useState(false)

  if (status === 'cancelled') {
    return <div className="pending-edit">Edit cancelled. Try again with more detail about which event you mean.</div>
  }
  if (status === 'confirmed') {
    return <div className="pending-edit">Applying your changes…</div>
  }

  const changeRows = Object.entries(changes)
    .filter(([k]) => FIELD_LABELS[k])
    .map(([k, v]) => ({ field: k, label: FIELD_LABELS[k], value: v }))

  if (picking) {
    return (
      <div className="pending-edit">
        <h4>Pick the event you meant</h4>
        <ul>
          {alternatives.map((alt) => (
            <li key={alt._id} style={{ padding: '6px 0' }}>
              <button
                type="button"
                className="btn"
                style={{ width: '100%', justifyContent: 'flex-start' }}
                disabled={disabled}
                onClick={() => onConfirm(alt._id, `Use "${alt.title}" instead.`)}
              >
                <b>{alt.title}</b>
                <span className="muted small" style={{ marginLeft: 8 }}>
                  {formatDateRange(alt.date, alt.end_date)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="pending-edit-actions">
          <button type="button" className="btn" onClick={() => setPicking(false)} disabled={disabled}>
            Back
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={disabled}>
            None of these
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pending-edit">
      <h4>Pending update</h4>
      <p style={{ margin: '0 0 8px', fontSize: 14 }}>
        <b>{target.title}</b>{' '}
        <span className="muted small">· {formatDateRange(target.date, target.end_date)}</span>
      </p>
      {changeRows.length > 0 && (
        <ul>
          {changeRows.map((row) => (
            <li key={row.field}>
              <span className="muted">{row.label}:</span>{' '}
              {row.field === 'people' ? (
                <PeopleChips peopleIds={row.value || []} peopleById={peopleById} />
              ) : (
                <b>{formatChangeValue(row.field, row.value)}</b>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="pending-edit-actions">
        <button
          type="button"
          className="btn btn-accent"
          disabled={disabled}
          onClick={() => onConfirm(target._id, `Yes, update "${target.title}".`)}
        >
          Confirm
        </button>
        {alternatives.length > 0 && (
          <button type="button" className="btn" disabled={disabled} onClick={() => setPicking(true)}>
            Choose another
          </button>
        )}
        <button type="button" className="btn btn-ghost" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function Sources({ sources }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="sources">
      <button
        type="button"
        className="sources-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} Sources ({sources.length})
      </button>
      {open && (
        <ul>
          {sources.map((s, i) => <li key={i}>• {s}</li>)}
        </ul>
      )}
    </div>
  )
}
