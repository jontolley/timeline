import { useEffect, useRef, useState } from 'react'
import {
  createThread,
  deleteThread,
  exportThreadUrl,
  importThread,
  inviteToThread,
  listSubscribers,
  revokeSubscriber,
  setSubscriptionVisible,
  unsubscribeFromThread,
  updateThread,
} from '../api/threads'
import { useEventStore, usePeopleStore, useThreadStore } from '../store'
import { PALETTE, personColor, personInitials } from '../utils/colors'
import { useConfirm } from '../lib/confirm'
import Modal from './Modal'

const EMPTY_DRAFT = { name: '', color: 'slate', visibility: 'private' }

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
function XIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
      <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
function ExportIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M8 2 V10 M5 7 L8 10 L11 7 M3 12 V13 H13 V12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const slugify = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || '—'

export default function ThreadsSettings() {
  const { threads, loaded, load } = useThreadStore()
  const reloadPeople = usePeopleStore((s) => s.load)
  const [modalState, setModalState] = useState(null) // { mode: 'new' | 'edit', id?, draft }
  const [importOpen, setImportOpen] = useState(false)
  const [importResult, setImportResult] = useState(null) // { thread_name, events_imported, ... }
  const [expandedId, setExpandedId] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const refresh = () => load(true).catch((e) => setError(e.message))

  const ownThreads = threads.filter((t) => t.is_owner)
  const subscribed = threads.filter((t) => !t.is_owner)
  const sharedCount = ownThreads.filter((t) => t.visibility === 'shared').length

  const openNew = () => setModalState({ mode: 'new', draft: EMPTY_DRAFT })
  const openEdit = (t) => setModalState({
    mode: 'edit',
    id: t._id,
    draft: { name: t.name, color: t.color, visibility: t.visibility || 'private' },
  })
  const closeModal = () => { setModalState(null); setError(null) }

  const save = async (e) => {
    e.preventDefault()
    if (!modalState) return
    setBusy(true)
    setError(null)
    try {
      const { draft, mode, id } = modalState
      const payload = {
        name: draft.name.trim(),
        color: draft.color,
        visibility: draft.visibility,
      }
      if (mode === 'new') await createThread(payload)
      else                 await updateThread(id, payload)
      await refresh()
      closeModal()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (t) => {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      body: 'Blocked while any events still belong to this thread — move them first if so.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
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
    try {
      await setSubscriptionVisible(sub._id, visible)
      await refresh()
      useEventStore.getState().invalidate()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const unsubscribe = async (t) => {
    if (!t.subscription) return
    const ok = await confirm({
      title: `Remove "${t.name}" from your view?`,
      body: `${t.owner_email} can re-add you later if you change your mind.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
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

  const toggleExpand = (id) => setExpandedId((cur) => (cur === id ? null : id))

  if (!loaded) {
    return (
      <>
        <header className="hs-well-head">
          <div>
            <h1 className="hs-well-title">Threads.</h1>
          </div>
        </header>
        <div className="hs-well-body">
          <p className="muted small">Loading…</p>
        </div>
      </>
    )
  }

  return (
    <>
      <header className="hs-well-head">
        <div>
          <h1 className="hs-well-title">Threads.</h1>
          <p className="hs-well-count">
            <strong>{ownThreads.length}</strong> total
            {sharedCount > 0 && <> · <strong>{sharedCount}</strong> shared</>}
          </p>
        </div>
        <div className="hs-well-right" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn"
            onClick={() => { setImportResult(null); setImportOpen(true) }}
            disabled={busy}
          >
            Import
          </button>
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <span className="hs-plus" aria-hidden="true" />
            New thread
          </button>
        </div>
      </header>

      <div className="hs-well-body">
      <p className="hs-well-intro">
        Threads group your events. Mark one <strong>shared</strong> to invite other users — they'll
        see its events on their own timeline, read-only. Switch back to private and existing
        subscribers lose access immediately.
      </p>

      {error && <p className="hs-modal-error" style={{ marginBottom: 14 }}>{error}</p>}

      {importResult && (
        <p
          style={{
            margin: '0 0 14px',
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--success)',
            background: 'color-mix(in oklab, var(--success) 8%, var(--surface))',
            border: '1px solid var(--rule)',
            borderRadius: 10,
          }}
        >
          Imported <strong>{importResult.events_imported}</strong> event{importResult.events_imported === 1 ? '' : 's'} into{' '}
          <strong>"{importResult.thread_name}"</strong>
          {importResult.people_added > 0 && <> · added {importResult.people_added} new {importResult.people_added === 1 ? 'person' : 'people'}</>}
          {importResult.events_skipped > 0 && <> · skipped {importResult.events_skipped} malformed</>}.
        </p>
      )}

      <div className="hs-rows">
        {ownThreads.length === 0 && (
          <div className="hs-row-empty-state">No threads yet — click "New thread"</div>
        )}

        {ownThreads.map((t) => {
          const shared = t.visibility === 'shared'
          const expanded = expandedId === t._id
          return (
            <article key={t._id} className={`hs-row${expanded ? ' expanded' : ''}`}>
              <div
                className="hs-row-head clickable"
                onClick={() => toggleExpand(t._id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(t._id) }
                }}
              >
                <span className="hs-swatch" style={{ background: personColor(t.color) }} />
                <div className="hs-row-id">
                  <span className="hs-row-name">{t.name}</span>
                  <span className="hs-row-slug">{slugify(t.name)}</span>
                </div>
                <div className="hs-row-meta">
                  {shared ? (
                    <span className="hs-badge shared">
                      <span className="hs-badge-dot" />
                      Shared{t.subscriber_count ? ` · ${t.subscriber_count}` : ''}
                    </span>
                  ) : (
                    <span className="hs-badge private">
                      <span className="hs-badge-dot" />Private
                    </span>
                  )}
                </div>
                <div className="hs-row-actions" onClick={(e) => e.stopPropagation()}>
                  <a
                    className="hs-iconbtn"
                    href={exportThreadUrl(t._id)}
                    download
                    aria-label="Export"
                    title="Export thread as JSON"
                  ><ExportIcon /></a>
                  <button
                    type="button"
                    className="hs-iconbtn"
                    onClick={() => openEdit(t)}
                    aria-label="Edit"
                    title="Edit thread"
                    disabled={busy}
                  ><EditIcon /></button>
                  <button
                    type="button"
                    className="hs-iconbtn danger"
                    onClick={() => remove(t)}
                    aria-label="Delete"
                    title="Delete thread"
                    disabled={busy}
                  ><TrashIcon /></button>
                  <span className="hs-chev" aria-hidden="true" />
                </div>
              </div>

              {expanded && (
                <div className="hs-row-expand">
                  {shared ? (
                    <SharePanel thread={t} onChange={refresh} />
                  ) : (
                    <>
                      <p className="hs-row-section-label">
                        Thread details · <span className="count">private to you</span>
                      </p>
                      <p className="hs-row-empty">
                        Only you can see events in this thread. Edit it to flip{' '}
                        <em style={{ fontFamily: 'var(--font-serif)', color: 'var(--accent)' }}>shared</em>{' '}
                        and invite people read-only.
                      </p>
                    </>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      {subscribed.length > 0 && (
        <div style={{ marginTop: 36 }}>
          <p className="hs-well-eyebrow"><span className="pip" /> Shared with me</p>
          <div className="hs-rows" style={{ marginTop: 10 }}>
            {subscribed.map((t) => {
              const visible = t.subscription?.visible
              return (
                <article key={t._id} className="hs-row">
                  <div className="hs-row-head">
                    <span className="hs-swatch" style={{ background: personColor(t.color) }} />
                    <div className="hs-row-id">
                      <span className="hs-row-name">{t.name}</span>
                      <span className="hs-row-slug">from {t.owner_email || '(unknown)'}</span>
                    </div>
                    <div className="hs-row-meta">
                      <span className="hs-badge shared">
                        <span className="hs-badge-dot" />Viewer
                      </span>
                    </div>
                    <div className="hs-row-actions">
                      <label
                        className="hs-row-meta"
                        style={{ gap: 6, fontSize: 13, cursor: 'pointer', textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 0, color: 'var(--ink-soft)' }}
                      >
                        <input
                          type="checkbox"
                          checked={!!visible}
                          onChange={(e) => setSubVisible(t.subscription, e.target.checked)}
                          disabled={busy}
                        />
                        Show on my timeline
                      </label>
                      <button
                        type="button"
                        className="hs-iconbtn danger"
                        onClick={() => unsubscribe(t)}
                        aria-label="Remove"
                        title="Remove from my view"
                        disabled={busy}
                      ><TrashIcon /></button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}
      </div>

      {modalState && (
        <ThreadModal
          modalState={modalState}
          setDraft={(updater) => setModalState((s) => ({ ...s, draft: updater(s.draft) }))}
          onClose={closeModal}
          onSubmit={save}
          busy={busy}
          error={error}
        />
      )}

      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onDone={async (result) => {
            setImportResult(result)
            setImportOpen(false)
            await refresh()
            // People may have been created by the import — refresh the cache.
            reloadPeople(true).catch(() => {})
            // Cross-thread imports add events the timeline doesn't know about.
            useEventStore.getState().invalidate()
          }}
        />
      )}
    </>
  )
}

function ImportModal({ onClose, onDone }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!file || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await importThread(name.trim(), file)
      onDone(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      eyebrow="Import · thread"
      title="Import a"
      titleEm="thread."
      sub="Upload an export JSON and we'll create a brand-new thread holding every event inside."
      primary={
        <button
          type="submit"
          form="hs-import-form"
          className="btn btn-accent"
          disabled={busy || !file || !name.trim()}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      }
    >
      <form id="hs-import-form" onSubmit={submit}>
        {error && <p className="hs-modal-error">{error}</p>}

        <div className="field">
          <div className="field-label">
            <span>Thread name</span>
            <span className="hint">required</span>
          </div>
          <input
            className="field-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Family archive 2019"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <div className="field-label">
            <span>Export file</span>
            <span className="hint">.json</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            style={{ fontSize: 13, color: 'var(--ink-soft)' }}
            required
          />
        </div>

        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          People are matched against your existing list by name — duplicates aren't created.
          Existing events and threads are not touched.
        </p>
      </form>
    </Modal>
  )
}

function ThreadModal({ modalState, setDraft, onClose, onSubmit, busy, error }) {
  const { mode, draft } = modalState
  const isNew = mode === 'new'

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={isNew ? 'New · thread' : 'Edit · thread'}
      title={isNew ? 'A new' : 'Edit'}
      titleEm={isNew ? 'thread.' : draft.name || 'thread.'}
      sub={isNew
        ? 'Group events that belong together. You can share it later.'
        : 'Rename, recolor, or change visibility.'}
      primary={
        <button type="submit" form="hs-thread-form" className="btn btn-accent" disabled={busy || !draft.name.trim()}>
          {busy ? 'Saving…' : isNew ? 'Create thread' : 'Save'}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      }
    >
      <form id="hs-thread-form" onSubmit={onSubmit}>
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
            placeholder="e.g. Travel & trips"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <div className="field-label">
            <span>Color</span>
            <span className="hint">shown on the timeline</span>
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

        <div className="field">
          <div className="field-label">
            <span>Visibility</span>
            <span className="hint">you can change this later</span>
          </div>
          <div className="hs-visibility">
            <button
              type="button"
              className={`hs-v-opt${draft.visibility === 'private' ? ' on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, visibility: 'private' }))}
            >
              <div className="t"><span className="dot" /> Private</div>
              <div className="d">Only you can see events in this thread.</div>
            </button>
            <button
              type="button"
              className={`hs-v-opt shared${draft.visibility === 'shared' ? ' on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, visibility: 'shared' }))}
            >
              <div className="t"><span className="dot" /> Shared</div>
              <div className="d">Invite people by email. Read-only.</div>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}

function SharePanel({ thread, onChange }) {
  const [email, setEmail] = useState('')
  const [subs, setSubs] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

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
    const ok = await confirm({
      title: `Stop sharing with ${sub.subscriber_email}?`,
      body: "They'll immediately lose access to this thread's events.",
      confirmLabel: 'Stop sharing',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
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

  const count = subs?.length ?? 0
  const pending = 0 // backend doesn't expose pending state yet

  return (
    <>
      <p className="hs-row-section-label">
        Shared with{' · '}
        <span className="count">{count} {count === 1 ? 'person' : 'people'}{pending ? `, ${pending} pending` : ''}</span>
      </p>

      <form className="hs-invite-row" onSubmit={invite}>
        <input
          type="email"
          required
          placeholder="invitee@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="send" disabled={busy || !email}>
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </form>
      <p className="hs-invite-help">
        // they'll get a one-tap link · read-only by default · revoke anytime
      </p>

      {error && <p className="hs-modal-error" style={{ marginBottom: 12 }}>{error}</p>}

      <div className="hs-shared-list">
        {/* Owner row */}
        <div className="hs-shared-user">
          <span className="hs-shared-avatar owner">{personInitials(thread.owner_email || 'me').charAt(0)}</span>
          <span className="hs-shared-email">{thread.owner_email || 'you'}</span>
          <span className="hs-shared-status owner">Owner</span>
          <span className="hs-shared-remove locked" title="You can't remove yourself">—</span>
        </div>

        {subs?.map((s) => (
          <div className="hs-shared-user" key={s._id}>
            <span className="hs-shared-avatar">{personInitials(s.subscriber_email).charAt(0)}</span>
            <span className="hs-shared-email">{s.subscriber_email}</span>
            <span className="hs-shared-status">Viewer</span>
            <button
              type="button"
              className="hs-shared-remove"
              onClick={() => revoke(s)}
              disabled={busy}
              title="Remove access"
              aria-label="Remove access"
            >
              <XIcon />
            </button>
          </div>
        ))}

        {subs && subs.length === 0 && (
          <p className="hs-row-empty" style={{ marginTop: 4 }}>
            Not shared with anyone yet — invite someone above.
          </p>
        )}
        {subs === null && !error && (
          <p className="hs-row-empty" style={{ marginTop: 4 }}>Loading subscribers…</p>
        )}
      </div>
    </>
  )
}
