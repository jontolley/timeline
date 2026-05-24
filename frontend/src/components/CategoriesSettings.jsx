import { useEffect, useState } from 'react'
import { createCategory, deleteCategory, updateCategory } from '../api/categories'
import { useCategoryStore } from '../store'
import { PALETTE, personColor } from '../utils/colors'
import { useConfirm } from '../lib/confirm'
import Modal from './Modal'

const EMPTY_DRAFT = { label: '', color: 'blue' }

// Derive the URL-safe slug stored as `name` from the human label.
// Backend accepts /^[a-z0-9_-]{1,32}$/ — strip everything else, collapse
// hyphens, trim, cap length.
function slugifyLabel(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M11.5 2.5 L13.5 4.5 L5 13 H3 V11 L11.5 2.5 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M3 4 H13 M5 4 V13 H11 V4 M6 4 V3 H10 V4 M6 7 V11 M10 7 V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function CategoriesSettings() {
  const { categories, loaded, load } = useCategoryStore()
  const [modalState, setModalState] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const refresh = () => load(true).catch((e) => setError(e.message))

  const openNew = () => setModalState({ mode: 'new', draft: EMPTY_DRAFT })
  const openEdit = (cat) => setModalState({
    mode: 'edit',
    id: cat._id,
    draft: { label: cat.label, color: cat.color },
  })
  const closeModal = () => { setModalState(null); setError(null) }

  const save = async (e) => {
    e.preventDefault()
    if (!modalState) return
    setBusy(true)
    setError(null)
    try {
      const { mode, id, draft } = modalState
      const label = draft.label.trim()
      if (mode === 'new') {
        const slug = slugifyLabel(label)
        if (!slug) throw new Error('Name must contain letters or numbers.')
        await createCategory({ name: slug, label, color: draft.color })
      } else {
        await updateCategory(id, { label, color: draft.color })
      }
      await refresh()
      closeModal()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (cat) => {
    const ok = await confirm({
      title: `Delete "${cat.label}"?`,
      body: "Blocked if any events still use this category — you'll see the count if so.",
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deleteCategory(cat._id)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="hs-well-head">
        <div>
          <h1 className="hs-well-title">Categories.</h1>
          <p className="hs-well-count"><strong>{categories.length}</strong> total</p>
        </div>
        <div className="hs-well-right">
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <span className="hs-plus" aria-hidden="true" />
            New category
          </button>
        </div>
      </header>

      <p className="hs-well-intro">
        Categories are the <code>event_type</code> values on every event. Recolor and rename freely;
        deletion is blocked while any event still uses a category.
      </p>

      {error && <p className="hs-modal-error" style={{ marginBottom: 14 }}>{error}</p>}

      <div className="hs-rows">
        {!loaded && <p className="muted small">Loading…</p>}
        {loaded && categories.length === 0 && (
          <div className="hs-row-empty-state">No categories yet — click "New category"</div>
        )}
        {categories.map((cat) => (
          <article key={cat._id} className="hs-row">
            <div className="hs-row-head">
              <span className="hs-swatch" style={{ background: personColor(cat.color) }} />
              <div className="hs-row-id">
                <span className="hs-row-name">{cat.label}</span>
                <span className="hs-row-slug">{cat.name}</span>
              </div>
              <div className="hs-row-meta" />
              <div className="hs-row-actions">
                <button
                  type="button"
                  className="hs-iconbtn"
                  onClick={() => openEdit(cat)}
                  aria-label="Edit"
                  title="Edit category"
                  disabled={busy}
                ><EditIcon /></button>
                <button
                  type="button"
                  className="hs-iconbtn danger"
                  onClick={() => remove(cat)}
                  aria-label="Delete"
                  title="Delete category"
                  disabled={busy}
                ><TrashIcon /></button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {modalState && (
        <CategoryModal
          modalState={modalState}
          setDraft={(updater) => setModalState((s) => ({ ...s, draft: updater(s.draft) }))}
          onClose={closeModal}
          onSubmit={save}
          busy={busy}
          error={error}
        />
      )}
    </>
  )
}

function CategoryModal({ modalState, setDraft, onClose, onSubmit, busy, error }) {
  const { mode, draft } = modalState
  const isNew = mode === 'new'

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={isNew ? 'New · category' : 'Edit · category'}
      title={isNew ? 'A new' : 'Edit'}
      titleEm={isNew ? 'category.' : draft.label || 'category.'}
      sub={isNew
        ? 'Pick a name and color.'
        : 'Rename or recolor.'}
      primary={
        <button type="submit" form="hs-cat-form" className="btn btn-accent"
          disabled={busy || !draft.label.trim()}>
          {busy ? 'Saving…' : isNew ? 'Create category' : 'Save'}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      }
    >
      <form id="hs-cat-form" onSubmit={onSubmit}>
        {error && <p className="hs-modal-error">{error}</p>}

        <div className="field">
          <div className="field-label">
            <span>Name</span>
            <span className="hint">shown on the timeline</span>
          </div>
          <input
            className="field-input"
            type="text"
            required
            value={draft.label}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            placeholder="e.g. Health"
            autoFocus
          />
        </div>

        <div className="field">
          <div className="field-label">
            <span>Color</span>
            <span className="hint">category accent</span>
          </div>
          <div className="hs-color-row">
            {PALETTE.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={draft.color === c.key}
                className={`sw${draft.color === c.key ? ' on' : ''}`}
                style={{ background: c.color }}
                onClick={() => setDraft((d) => ({ ...d, color: c.key }))}
              />
            ))}
          </div>
        </div>
      </form>
    </Modal>
  )
}
