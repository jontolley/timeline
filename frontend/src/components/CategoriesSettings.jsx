import { useEffect, useState } from 'react'
import { createCategory, deleteCategory, updateCategory } from '../api/categories'
import { useCategoryStore } from '../store'
import { PALETTE, personColor } from '../utils/colors'

const EMPTY_DRAFT = { name: '', label: '', color: 'blue' }

export default function CategoriesSettings() {
  const { categories, loaded, load } = useCategoryStore()
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

  const startEdit = (cat) => {
    setEditingId(cat._id)
    setDraft({ name: cat.name, label: cat.label, color: cat.color })
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
        await createCategory({
          name: draft.name.trim().toLowerCase(),
          label: draft.label.trim(),
          color: draft.color,
        })
      } else {
        await updateCategory(editingId, {
          label: draft.label.trim(),
          color: draft.color,
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

  const remove = async (cat) => {
    if (!window.confirm(`Delete "${cat.label}"? This blocks if any events still use it.`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteCategory(cat._id)
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
        <h2 className="section-title">Categories</h2>
        {editingId !== 'new' && (
          <button type="button" className="btn btn-primary" onClick={startNew}>
            Add category
          </button>
        )}
      </div>

      <p className="muted small" style={{ marginBottom: 18 }}>
        Categories are the <code>event_type</code> values on every event. Recolor and rename
        freely; deletion is blocked while any event still uses a category.
      </p>

      {error && <p className="form-error" style={{ marginBottom: 18 }}>{error}</p>}

      {editingId === 'new' && (
        <CategoryForm
          editingId={editingId}
          draft={draft}
          setDraft={setDraft}
          onSubmit={save}
          onCancel={cancel}
          busy={busy}
        />
      )}

      <div className="stack">
        {categories.length === 0 && editingId !== 'new' && (
          <p className="empty">No categories yet. Add your first one.</p>
        )}
        {categories.map((cat) =>
          editingId === cat._id ? (
            <CategoryForm
              key={cat._id}
              editingId={editingId}
              draft={draft}
              setDraft={setDraft}
              onSubmit={save}
              onCancel={cancel}
              busy={busy}
            />
          ) : (
            <CategoryRow
              key={cat._id}
              category={cat}
              onEdit={() => startEdit(cat)}
              onDelete={() => remove(cat)}
              busy={busy}
            />
          ),
        )}
      </div>
    </div>
  )
}

function CategoryRow({ category, onEdit, onDelete, busy }) {
  const color = personColor(category.color)
  return (
    <div className="list-card">
      <div className="row" style={{ minWidth: 0 }}>
        <span style={{ width: 18, height: 18, borderRadius: 999, background: color, flexShrink: 0 }} />
        <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{category.label}</span>
        <span className="mono muted" style={{ textTransform: 'uppercase', fontSize: 11 }}>
          {category.name}
        </span>
      </div>
      <div className="row">
        <button type="button" className="btn btn-ghost" onClick={onEdit} disabled={busy}>Edit</button>
        <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>Delete</button>
      </div>
    </div>
  )
}

function CategoryForm({ editingId, draft, setDraft, onSubmit, onCancel, busy }) {
  const isNew = editingId === 'new'
  return (
    <form onSubmit={onSubmit} className="card" style={{ padding: 20, marginBottom: 12 }}>
      <div className="form">
        {isNew && (
          <div className="field">
            <label className="field-label" htmlFor="cat-name">
              Slug<span className="field-required">*</span>
            </label>
            <input
              id="cat-name"
              className="input"
              required
              pattern="[a-z0-9_-]{1,32}"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. health, hobby"
            />
            <p className="field-hint">
              Lowercase letters, digits, hyphen, or underscore. Cannot be changed later.
            </p>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="cat-label">
            Label<span className="field-required">*</span>
          </label>
          <input
            id="cat-label"
            className="input"
            required
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="e.g. Health"
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
