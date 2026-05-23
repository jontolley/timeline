import { useEffect, useState } from 'react'
import { createThread, deleteThread, updateThread } from '../api/threads'
import { useThreadStore } from '../store'
import { PALETTE, personColor } from '../utils/colors'

const EMPTY_DRAFT = { name: '', color: 'slate' }

export default function ThreadsSettings() {
  const { threads, loaded, load } = useThreadStore()
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const refresh = () => load(true).catch((e) => setError(e.message))

  const startNew = () => {
    setEditingId('new')
    setDraft(EMPTY_DRAFT)
    setError(null)
  }
  const startEdit = (t) => {
    setEditingId(t._id)
    setDraft({ name: t.name, color: t.color })
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
        await createThread({ name: draft.name.trim(), color: draft.color })
      } else {
        await updateThread(editingId, { name: draft.name.trim(), color: draft.color })
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
        Threads group your events. A new event picks one of your threads when
        you save it. You can show one thread on the timeline or several at once.
        Deletion is blocked while any event still belongs to the thread.
      </p>

      {error && <p className="form-error" style={{ marginBottom: 18 }}>{error}</p>}

      {editingId === 'new' && (
        <ThreadForm draft={draft} setDraft={setDraft} onSubmit={save} onCancel={cancel} busy={busy} />
      )}

      <div className="stack">
        {threads.length === 0 && editingId !== 'new' && (
          <p className="empty">No threads yet. Add one to start placing events.</p>
        )}
        {threads.map((t) =>
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
              busy={busy}
            />
          ),
        )}
      </div>
    </div>
  )
}

function ThreadRow({ thread, onEdit, onDelete, busy }) {
  const color = personColor(thread.color)
  return (
    <div className="list-card">
      <div className="row" style={{ minWidth: 0 }}>
        <span style={{ width: 18, height: 18, borderRadius: 999, background: color, flexShrink: 0 }} />
        <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{thread.name}</span>
      </div>
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={onEdit} disabled={busy}>Edit</button>
        <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>Delete</button>
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
