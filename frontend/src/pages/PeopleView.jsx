import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createPerson, updatePerson, deletePerson } from '../api/people'
import { usePeopleStore } from '../store'
import { PALETTE, personColor, personInitials } from '../utils/colors'
import { useConfirm } from '../lib/confirm'
import Modal from '../components/Modal'

const EMPTY_DRAFT = { name: '', color: 'blue' }

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

export default function PeopleView({ embedded = false }) {
  const { people, loaded, load } = usePeopleStore()
  const [error, setError] = useState(null)
  const [modalState, setModalState] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  const refresh = () => load(true).catch((e) => setError(e.message))

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const openNew = () => setModalState({ mode: 'new', draft: EMPTY_DRAFT })
  const openEdit = (person) => setModalState({
    mode: 'edit',
    id: person._id,
    draft: { name: person.name, color: person.color },
  })
  const closeModal = () => { setModalState(null); setError(null) }

  const save = async (e) => {
    e.preventDefault()
    if (!modalState || !modalState.draft.name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { mode, id, draft } = modalState
      const payload = { name: draft.name.trim(), color: draft.color }
      if (mode === 'new') await createPerson(payload)
      else                 await updatePerson(id, payload)
      await refresh()
      closeModal()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (person) => {
    const ok = await confirm({
      title: `Delete ${person.name}?`,
      body: `This removes ${person.name} from every event they're tagged on. The events themselves stay. Cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      await deletePerson(person._id)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const body = (
    <>
      <header className="hs-well-head">
        <div>
          <h1 className="hs-well-title">People.</h1>
          <p className="hs-well-count"><strong>{people.length}</strong> total</p>
        </div>
        <div className="hs-well-right">
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <span className="hs-plus" aria-hidden="true" />
            New person
          </button>
        </div>
      </header>

      <div className="hs-well-body">
      <p className="hs-well-intro">
        People you tag on events. Delete here to pull them from every event they're on — the events
        themselves stay.
      </p>

      {error && <p className="hs-modal-error" style={{ marginBottom: 14 }}>{error}</p>}

      <div className="hs-rows">
        {!loaded && <p className="muted small">Loading…</p>}
        {loaded && people.length === 0 && (
          <div className="hs-row-empty-state">No people yet — click "New person"</div>
        )}
        {people.map((person) => (
          <article key={person._id} className="hs-row">
            <div className="hs-row-head">
              <span className="hs-swatch" style={{ background: personColor(person.color) }} />
              <div className="hs-row-id">
                <span className="hs-row-name">{person.name}</span>
                <span className="hs-row-slug">{person.color}</span>
              </div>
              <div className="hs-row-meta" />
              <div className="hs-row-actions">
                <button
                  type="button"
                  className="hs-iconbtn"
                  onClick={() => openEdit(person)}
                  aria-label="Edit"
                  title="Edit person"
                  disabled={busy}
                ><EditIcon /></button>
                <button
                  type="button"
                  className="hs-iconbtn danger"
                  onClick={() => remove(person)}
                  aria-label="Delete"
                  title="Delete person"
                  disabled={busy}
                ><TrashIcon /></button>
              </div>
            </div>
          </article>
        ))}
      </div>
      </div>

      {modalState && (
        <PersonModal
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

  if (embedded) return body

  // Standalone fallback (kept in case anything links directly to /people).
  return (
    <div className="page-narrow">
      <Link to="/" className="back-link">← Back to timeline</Link>
      {body}
    </div>
  )
}

function PersonModal({ modalState, setDraft, onClose, onSubmit, busy, error }) {
  const { mode, draft } = modalState
  const isNew = mode === 'new'

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={isNew ? 'New · person' : 'Edit · person'}
      title={isNew ? 'A new' : 'Edit'}
      titleEm={isNew ? 'person.' : draft.name || 'person.'}
      sub={isNew
        ? 'Just a name and color. Tag them on events as you go.'
        : 'Rename or recolor.'}
      primary={
        <button type="submit" form="hs-person-form" className="btn btn-accent" disabled={busy || !draft.name.trim()}>
          {busy ? 'Saving…' : isNew ? 'Create person' : 'Save'}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      }
    >
      <form id="hs-person-form" onSubmit={onSubmit}>
        {error && <p className="hs-modal-error">{error}</p>}

        <div className="field">
          <div className="field-label">
            <span>Name</span>
            <span className="hint">required</span>
          </div>
          <input
            className="field-input"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="e.g. Sam Chen"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <div className="field-label">
            <span>Color</span>
            <span className="hint">avatar accent</span>
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

// Keep the helper around in case other code imports it eventually.
export { personInitials }
