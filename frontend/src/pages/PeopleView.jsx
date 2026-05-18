import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPerson, updatePerson, deletePerson } from '../api/people'
import { usePeopleStore } from '../store'
import { PALETTE, colorClasses } from '../utils/colors'

export default function PeopleView() {
  const { people, loaded, load } = usePeopleStore()
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null) // null | 'new' | personId
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

  if (!loaded) return <p className="text-ink-faint py-12 text-center">Loading...</p>

  return (
    <div>
      <Link to="/" className="text-ink-mute hover:text-ink text-sm mb-4 inline-block">
        &larr; Back to Timeline
      </Link>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tighter2 leading-none text-ink">People</h1>
        {editingId !== 'new' && (
          <button
            onClick={startNew}
            className="px-4 py-2 bg-ink text-paper rounded-md text-sm font-medium hover:bg-ink-soft transition-colors"
          >
            Add Person
          </button>
        )}
      </div>

      {error && (
        <p className="text-rose-600 text-sm mb-4 bg-rose-50 ring-1 ring-rose-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

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

      <div className="space-y-2">
        {people.length === 0 && editingId !== 'new' && (
          <p className="text-ink-faint text-center py-8">No people yet. Add your first one.</p>
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
          )
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
    </div>
  )
}

function PersonRow({ person, onEdit, onDelete }) {
  const c = colorClasses(person.color)
  return (
    <div className="bg-white rounded-lg shadow-sm border border-ink-line px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-4 h-4 rounded-full shrink-0 ${c.dot}`} />
        <span className="text-sm font-medium text-ink truncate">{person.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${c.chip}`}>{c.label}</span>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={onEdit}
          className="px-3 py-1.5 text-xs text-ink-mute hover:bg-surface rounded-md transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

function PersonForm({ draft, setDraft, onSubmit, onCancel, busy, submitLabel }) {
  return (
    <form
      onSubmit={onSubmit}
      className="bg-white rounded-lg shadow-sm border border-ink-line p-4 space-y-4 mb-4"
    >
      <div>
        <label className="block text-sm font-medium text-ink-soft mb-1">Name</label>
        <input
          autoFocus
          required
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="w-full border border-ink-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-ink-soft mb-2">Color</label>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setDraft({ ...draft, color: c.key })}
              title={c.label}
              className={`w-8 h-8 rounded-full ${c.dot} ${
                draft.color === c.key ? `ring-2 ring-offset-2 ${c.ring}` : 'opacity-80 hover:opacity-100'
              } transition-all`}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 bg-ink text-paper rounded-md text-sm font-medium hover:bg-ink-soft disabled:opacity-50 transition-colors"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 bg-surface text-ink-soft ring-1 ring-ink-line rounded-md text-sm font-medium hover:bg-ink-line/40 disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function DeleteConfirmModal({ person, onConfirm, onCancel, busy }) {
  const c = colorClasses(person.color)
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl border border-ink-line max-w-md w-full p-6">
        <h2 className="text-lg font-semibold text-ink mb-2">Delete person?</h2>
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-3 h-3 rounded-full ${c.dot}`} />
          <span className="font-medium text-ink">{person.name}</span>
        </div>
        <p className="text-sm text-ink-mute mb-5">
          This will remove <span className="font-medium">{person.name}</span> from
          every event they're associated with. The events themselves will stay.
          This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 bg-surface text-ink-soft ring-1 ring-ink-line rounded-md text-sm font-medium hover:bg-ink-line/40 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 bg-rose-600 text-paper rounded-md text-sm font-medium hover:bg-rose-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
