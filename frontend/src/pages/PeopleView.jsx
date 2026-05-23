import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPerson, updatePerson, deletePerson } from '../api/people'
import { usePeopleStore } from '../store'
import { PALETTE, personColor } from '../utils/colors'

export default function PeopleView({ embedded = false }) {
  const { people, loaded, load } = usePeopleStore()
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({ name: '', color: 'blue' })
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => load(true).catch((e) => setError(e.message))

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const startNew = () => {
    setDraft({ name: '', color: 'blue' })
    setEditingId('new')
  }

  const startEdit = (person) => {
    setDraft({ name: person.name, color: person.color })
    setEditingId(person._id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setError(null)
  }

  const save = async (e) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (editingId === 'new') {
        await createPerson({ name: draft.name.trim(), color: draft.color })
      } else {
        await updatePerson(editingId, { name: draft.name.trim(), color: draft.color })
      }
      await refresh()
      setEditingId(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await deletePerson(deleteTarget._id)
      await refresh()
      setDeleteTarget(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    const loadingMarkup = <p className="muted small">Loading…</p>
    return embedded ? loadingMarkup : <div className="page-narrow">{loadingMarkup}</div>
  }

  const Wrapper = embedded ? 'div' : 'div'
  const wrapperClass = embedded ? 'settings-section' : 'page-narrow'
  return (
    <Wrapper className={wrapperClass}>
      {!embedded && <Link to="/" className="back-link">← Back to timeline</Link>}
      <div className="page-head">
        {!embedded && <h1 className="page-title" style={{ fontSize: 44 }}>People</h1>}
        {embedded && <h2 className="section-title">People</h2>}
        {editingId !== 'new' && (
          <button type="button" className="btn btn-primary" onClick={startNew}>
            Add person
          </button>
        )}
      </div>

      {error && <p className="form-error" style={{ marginBottom: 18 }}>{error}</p>}

      {editingId === 'new' && (
        <PersonForm
          draft={draft}
          setDraft={setDraft}
          onSubmit={save}
          onCancel={cancelEdit}
          busy={busy}
          submitLabel="Create"
        />
      )}

      <div className="stack">
        {people.length === 0 && editingId !== 'new' && (
          <p className="empty">No people yet. Add your first one.</p>
        )}
        {people.map((person) =>
          editingId === person._id ? (
            <PersonForm
              key={person._id}
              draft={draft}
              setDraft={setDraft}
              onSubmit={save}
              onCancel={cancelEdit}
              busy={busy}
              submitLabel="Save"
            />
          ) : (
            <PersonRow
              key={person._id}
              person={person}
              onEdit={() => startEdit(person)}
              onDelete={() => setDeleteTarget(person)}
            />
          ),
        )}
      </div>

      {deleteTarget && (
        <DeleteConfirmModal
          person={deleteTarget}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
          busy={busy}
        />
      )}
    </Wrapper>
  )
}

function PersonRow({ person, onEdit, onDelete }) {
  const color = personColor(person.color)
  return (
    <div className="list-card">
      <div className="row" style={{ minWidth: 0 }}>
        <span
          style={{ width: 18, height: 18, borderRadius: 999, background: color, flexShrink: 0 }}
        />
        <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{person.name}</span>
        <span className="mono muted" style={{ textTransform: 'uppercase' }}>{person.color}</span>
      </div>
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={onEdit}>Edit</button>
        <button type="button" className="btn btn-danger" onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}

function PersonForm({ draft, setDraft, onSubmit, onCancel, busy, submitLabel }) {
  return (
    <form onSubmit={onSubmit} className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div className="form">
        <div className="field">
          <label className="field-label">Name</label>
          <input
            className="input"
            autoFocus
            required
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label">Color</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            {PALETTE.map((c) => {
              const active = draft.color === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setDraft({ ...draft, color: c.key })}
                  title={c.label}
                  style={{
                    width: 32,
                    height: 32,
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
            {busy ? 'Saving…' : submitLabel}
          </button>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}

function DeleteConfirmModal({ person, onConfirm, onCancel, busy }) {
  const color = personColor(person.color)
  return (
    <div className="sheet-backdrop" onClick={onCancel} style={{ alignItems: 'center' }}>
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460, width: '100%', padding: 24, animation: 'slideUp .25s cubic-bezier(.2,.7,.2,1)' }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 500 }}>Delete person?</h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: color }} />
          <b>{person.name}</b>
        </div>
        <p className="muted small" style={{ marginBottom: 20 }}>
          This will remove <b>{person.name}</b> from every event they're associated with. The
          events themselves will stay. This cannot be undone.
        </p>
        <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
