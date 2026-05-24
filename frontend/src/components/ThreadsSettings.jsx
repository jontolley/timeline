import { useEffect, useState } from 'react'
import {
  createThread,
  deleteThread,
  inviteToThread,
  listSubscribers,
  revokeSubscriber,
  setSubscriptionVisible,
  unsubscribeFromThread,
  updateThread,
} from '../api/threads'
import { useEventStore, useThreadStore } from '../store'
import { PALETTE, personColor } from '../utils/colors'

const EMPTY_DRAFT = { name: '', color: 'slate', visibility: 'private' }

export default function ThreadsSettings() {
  const { threads, loaded, load } = useThreadStore()
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [sharingId, setSharingId] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const refresh = () => load(true).catch((e) => setError(e.message))

  const ownThreads = threads.filter((t) => t.is_owner)
  const subscribed = threads.filter((t) => !t.is_owner)

  const startNew = () => {
    setEditingId('new')
    setDraft(EMPTY_DRAFT)
    setError(null)
  }
  const startEdit = (t) => {
    setEditingId(t._id)
    setDraft({ name: t.name, color: t.color, visibility: t.visibility || 'private' })
    setError(null)
  }
  const cancel = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setError(null)
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (editingId === 'new') {
        await createThread({
          name: draft.name.trim(),
          color: draft.color,
          visibility: draft.visibility,
        })
      } else {
        await updateThread(editingId, {
          name: draft.name.trim(),
          color: draft.color,
          visibility: draft.visibility,
        })
      }
      await refresh()
      cancel()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.name}"? Blocked while any events still belong to this thread.`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteThread(t._id)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const setSubVisible = async (sub, visible) => {
    setBusy(true)
    setError(null)
    try {
      await setSubscriptionVisible(sub._id, visible)
      await refresh()
      // The set of events visible on the timeline changed — invalidate the
      // cached pages so the next TimelineView mount refetches.
      useEventStore.getState().invalidate()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const unsubscribe = async (t) => {
    if (!t.subscription) return
    if (!window.confirm(`Remove "${t.name}" from your view? You can be re-added by ${t.owner_email}.`)) return
    setBusy(true)
    setError(null)
    try {
      await unsubscribeFromThread(t.subscription._id)
      await refresh()
      useEventStore.getState().invalidate()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return <p className="muted small">Loading…</p>
  }

  return (
    <div className="settings-section">
      <div className="page-head">
        <h2 className="section-title">Threads</h2>
        {editingId !== 'new' && (
          <button type="button" className="btn btn-primary" onClick={startNew}>
            Add thread
          </button>
        )}
      </div>

      <p className="muted small" style={{ marginBottom: 18 }}>
        Threads group your events. Mark one shared to invite other users — they'll see its events
        on their own timeline (read-only). Switch back to private and existing subscribers lose
        access immediately.
      </p>

      {error && <p className="form-error" style={{ marginBottom: 18 }}>{error}</p>}

      {editingId === 'new' && (
        <ThreadForm draft={draft} setDraft={setDraft} onSubmit={save} onCancel={cancel} busy={busy} />
      )}

      {ownThreads.length > 0 && (
        <>
          <h3 className="section-subtitle">My threads</h3>
          <div className="stack">
            {ownThreads.map((t) =>
              editingId === t._id ? (
                <ThreadForm
                  key={t._id}
                  draft={draft}
                  setDraft={setDraft}
                  onSubmit={save}
                  onCancel={cancel}
                  busy={busy}
                />
              ) : (
                <ThreadRow
                  key={t._id}
                  thread={t}
                  onEdit={() => startEdit(t)}
                  onDelete={() => remove(t)}
                  onShare={() => setSharingId(sharingId === t._id ? null : t._id)}
                  sharingOpen={sharingId === t._id}
                  busy={busy}
                  onAfterShareChange={refresh}
                />
              ),
            )}
          </div>
        </>
      )}

      {subscribed.length > 0 && (
        <>
          <h3 className="section-subtitle" style={{ marginTop: 28 }}>Shared with me</h3>
          <div className="stack">
            {subscribed.map((t) => (
              <SubscriptionRow
                key={t._id}
                thread={t}
                onToggle={(visible) => setSubVisible(t.subscription, visible)}
                onUnsubscribe={() => unsubscribe(t)}
                busy={busy}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ThreadRow({ thread, onEdit, onDelete, onShare, sharingOpen, busy, onAfterShareChange }) {
  const color = personColor(thread.color)
  const shared = thread.visibility === 'shared'
  const count = thread.subscriber_count || 0
  return (
    <div className="list-card-block">
      <div className="list-card">
        <div className="row" style={{ minWidth: 0 }}>
          <span style={{ width: 18, height: 18, borderRadius: 999, background: color, flexShrink: 0 }} />
          <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{thread.name}</span>
          <span className="mono muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
            {shared ? 'shared' : 'private'}
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn btn-ghost" onClick={onEdit} disabled={busy}>Edit</button>
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>Delete</button>
        </div>
      </div>
      {shared && (
        <button
          type="button"
          className="thread-subscribers-trigger"
          onClick={onShare}
          aria-expanded={sharingOpen}
        >
          <span className="caret" aria-hidden="true">{sharingOpen ? '▾' : '▸'}</span>
          {count === 0
            ? 'Not shared with anyone yet — invite someone'
            : `Shared with ${count} ${count === 1 ? 'person' : 'people'}`}
        </button>
      )}
      {sharingOpen && (
        <SharePanel thread={thread} onChange={onAfterShareChange} />
      )}
    </div>
  )
}

function SharePanel({ thread, onChange }) {
  const [email, setEmail] = useState('')
  const [subs, setSubs] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadSubs = async () => {
    try {
      setSubs(await listSubscribers(thread._id))
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { loadSubs() }, [thread._id]) // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (e) => {
    e.preventDefault()
    if (thread.visibility !== 'shared') {
      setError('Mark the thread shared before inviting (edit it above).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await inviteToThread(thread._id, email.trim().toLowerCase())
      setEmail('')
      await loadSubs()
      onChange?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (sub) => {
    if (!window.confirm(`Stop sharing with ${sub.subscriber_email}?`)) return
    setBusy(true)
    setError(null)
    try {
      await revokeSubscriber(thread._id, sub.subscriber_user_id)
      await loadSubs()
      onChange?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="share-panel">
      <form onSubmit={invite} className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input
          type="email"
          className="input"
          required
          placeholder="invitee@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !email}>
          {busy ? 'Sharing…' : 'Share'}
        </button>
      </form>
      {error && <p className="form-error small" style={{ marginBottom: 10 }}>{error}</p>}
      {subs === null && <p className="muted small">Loading subscribers…</p>}
      {subs && subs.length === 0 && (
        <p className="muted small">Not shared with anyone yet.</p>
      )}
      {subs && subs.length > 0 && (
        <ul className="share-subscribers">
          {subs.map((s) => (
            <li key={s._id}>
              <span>{s.subscriber_email}</span>
              <button type="button" className="audio-remove" onClick={() => revoke(s)} disabled={busy}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SubscriptionRow({ thread, onToggle, onUnsubscribe, busy }) {
  const color = personColor(thread.color)
  const visible = thread.subscription?.visible
  return (
    <div className="list-card">
      <div className="row" style={{ minWidth: 0 }}>
        <span style={{ width: 18, height: 18, borderRadius: 999, background: color, flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{thread.name}</span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            from {thread.owner_email || '(unknown)'}
          </span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <label className="row" style={{ gap: 6, fontSize: 13.5, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={!!visible}
            onChange={(e) => onToggle(e.target.checked)}
            disabled={busy}
          />
          Show on my timeline
        </label>
        <button type="button" className="btn btn-danger" onClick={onUnsubscribe} disabled={busy}>
          Remove
        </button>
      </div>
    </div>
  )
}

function ThreadForm({ draft, setDraft, onSubmit, onCancel, busy }) {
  return (
    <form onSubmit={onSubmit} className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div className="form">
        <div className="field">
          <label className="field-label" htmlFor="thread-name">
            Name<span className="field-required">*</span>
          </label>
          <input
            id="thread-name"
            className="input"
            required
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="e.g. Family travels"
          />
        </div>
        <div className="field">
          <label className="field-label">Color</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {PALETTE.map((c) => {
              const active = c.key === draft.color
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, color: c.key }))}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: c.color,
                    border: active ? '2px solid var(--ink)' : '1px solid var(--line)',
                    outline: 'none',
                    cursor: 'pointer',
                    transition: 'transform .12s ease',
                    transform: active ? 'scale(1.08)' : 'none',
                  }}
                  aria-label={c.label}
                  aria-pressed={active}
                />
              )
            })}
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="thread-vis">Visibility</label>
          <select
            id="thread-vis"
            className="select"
            value={draft.visibility}
            onChange={(e) => setDraft((d) => ({ ...d, visibility: e.target.value }))}
          >
            <option value="private">Private (only me)</option>
            <option value="shared">Shared (I can invite others)</option>
          </select>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}
