import { useEffect, useState } from 'react'
import { deleteUser, getUserFootprint, inviteUser, updateUserRole } from '../api/users'
import { useAuthStore, useUserStore } from '../store'
import { personInitials } from '../utils/colors'
import Modal from './Modal'

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none">
      <path d="M3 4 H13 M5 4 V13 H11 V4 M6 4 V3 H10 V4 M6 7 V11 M10 7 V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function UsersSettings() {
  const { users, loaded, load } = useUserStore()
  const currentUserId = useAuthStore((s) => s.userId)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [draft, setDraft] = useState({ email: '', role: 'user' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [footprint, setFootprint] = useState(null)
  const [lastInvited, setLastInvited] = useState(null)

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const refresh = () => load(true).catch((e) => setError(e.message))

  const openInvite = () => {
    setDraft({ email: '', role: 'user' })
    setError(null)
    setInviteOpen(true)
  }
  const closeInvite = () => { setInviteOpen(false); setError(null) }

  const submitInvite = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const newUser = await inviteUser({
        email: draft.email.trim().toLowerCase(),
        role: draft.role,
      })
      await refresh()
      setLastInvited({ email: newUser.email, url: window.location.origin })
      closeInvite()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!lastInvited) return
    try { await navigator.clipboard.writeText(lastInvited.url) } catch { /* user copies manually */ }
  }

  const handleRoleChange = async (user, nextRole) => {
    if (user.role === nextRole) return
    setBusy(true)
    setError(null)
    try {
      await updateUserRole(user._id, nextRole)
      await refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const beginDelete = async (user) => {
    setDeleteTarget(user)
    setFootprint(null)
    setError(null)
    try {
      const fp = await getUserFootprint(user._id)
      setFootprint(fp)
    } catch (err) {
      setError(err.message)
      setDeleteTarget(null)
    }
  }

  const cancelDelete = () => { setDeleteTarget(null); setFootprint(null) }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await deleteUser(deleteTarget._id)
      await refresh()
      cancelDelete()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const adminCount = users.filter((u) => u.role === 'admin').length

  return (
    <>
      <header className="hs-well-head">
        <div>
          <h1 className="hs-well-title">Users.</h1>
          <p className="hs-well-count">
            <strong>{users.length}</strong> total
            {adminCount > 0 && <> · <strong>{adminCount}</strong> admin{adminCount === 1 ? '' : 's'}</>}
          </p>
        </div>
        <div className="hs-well-right">
          <button type="button" className="btn btn-primary" onClick={openInvite}>
            <span className="hs-plus" aria-hidden="true" />
            New user
          </button>
        </div>
      </header>

      <div className="hs-well-body">
      <p className="hs-well-intro">
        Add people by email. After you add them, share the sign-in link below — they'll be able to
        sign in with Google or the magic-link form. Each user has their own private timeline.
      </p>

      {error && !inviteOpen && (
        <p className="hs-modal-error" style={{ marginBottom: 14 }}>{error}</p>
      )}

      {lastInvited && (
        <div className="hs-notice">
          <p className="hs-notice-title">
            <strong>{lastInvited.email}</strong> can now sign in. Share this link:
          </p>
          <div className="row">
            <code>{lastInvited.url}</code>
            <button type="button" className="btn" onClick={copyLink}>Copy</button>
            <button type="button" className="btn btn-ghost" onClick={() => setLastInvited(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="hs-rows">
        {!loaded && <p className="muted small">Loading…</p>}
        {loaded && users.length === 0 && (
          <div className="hs-row-empty-state">No users yet — click "New user"</div>
        )}
        {users.map((u) => {
          const isSelf = u._id === currentUserId
          return (
            <article key={u._id} className="hs-row">
              <div className="hs-row-head">
                <span className="hs-shared-avatar" style={{ width: 24, height: 24, fontSize: 13 }}>
                  {personInitials(u.email).charAt(0)}
                </span>
                <div className="hs-row-id">
                  <span className="hs-row-name">{u.email}</span>
                  {isSelf && <span className="hs-row-slug">you</span>}
                </div>
                <div className="hs-row-meta">
                  <select
                    className="hs-badge"
                    value={u.role}
                    onChange={(e) => handleRoleChange(u, e.target.value)}
                    disabled={busy || isSelf}
                    aria-label={`Role for ${u.email}`}
                    style={{
                      cursor: isSelf ? 'not-allowed' : 'pointer',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      paddingRight: 22,
                      backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'><path d='M1 2.5 L4 5.5 L7 2.5' stroke='%236c7589' stroke-width='1.2' fill='none' stroke-linecap='round'/></svg>\")",
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 8px center',
                    }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="hs-row-actions">
                  <button
                    type="button"
                    className="hs-iconbtn danger"
                    onClick={() => beginDelete(u)}
                    aria-label="Remove"
                    title="Remove user"
                    disabled={busy || isSelf}
                  ><TrashIcon /></button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
      </div>

      {inviteOpen && (
        <Modal
          open
          onClose={closeInvite}
          eyebrow="New · user"
          title="A new"
          titleEm="user."
          sub="Add by email. They'll be able to sign in with Google or a magic link."
          primary={
            <button
              type="submit"
              form="hs-user-form"
              className="btn btn-accent"
              disabled={busy || !draft.email.trim()}
            >
              {busy ? 'Adding…' : 'Add user'}
            </button>
          }
          secondary={
            <button type="button" className="btn" onClick={closeInvite} disabled={busy}>Cancel</button>
          }
        >
          <form id="hs-user-form" onSubmit={submitInvite}>
            {error && <p className="hs-modal-error">{error}</p>}

            <div className="field">
              <div className="field-label">
                <span>Email</span>
                <span className="hint">required</span>
              </div>
              <input
                className="field-input"
                type="email"
                required
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                placeholder="someone@example.com"
                autoFocus
              />
            </div>

            <div className="field">
              <div className="field-label">
                <span>Role</span>
                <span className="hint">you can change this later</span>
              </div>
              <div className="hs-visibility">
                <button
                  type="button"
                  className={`hs-v-opt${draft.role === 'user' ? ' on' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, role: 'user' }))}
                >
                  <div className="t"><span className="dot" /> User</div>
                  <div className="d">Has their own private timeline.</div>
                </button>
                <button
                  type="button"
                  className={`hs-v-opt shared${draft.role === 'admin' ? ' on' : ''}`}
                  onClick={() => setDraft((d) => ({ ...d, role: 'admin' }))}
                >
                  <div className="t"><span className="dot" /> Admin</div>
                  <div className="d">Can manage other users.</div>
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          email={deleteTarget.email}
          footprint={footprint}
          busy={busy}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
      )}
    </>
  )
}

function DeleteConfirmModal({ email, footprint, busy, onCancel, onConfirm }) {
  const loading = footprint === null
  const hasData = footprint && (
    footprint.events > 0 || footprint.media > 0 ||
    footprint.people > 0
  )
  return (
    <Modal
      open
      onClose={onCancel}
      eyebrow="Danger · remove user"
      title="Remove"
      titleEm={email + '?'}
      sub="This permanently deletes everything this user owns. It cannot be undone."
      width={520}
      primary={
        <button
          type="button"
          className="btn btn-danger"
          onClick={onConfirm}
          disabled={busy || loading}
        >
          {busy ? 'Deleting…' : 'Delete user & data'}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      }
    >
      {loading ? (
        <p className="muted small">Counting their data…</p>
      ) : (
        <>
          <ul className="footprint-list">
            <li><strong>{footprint.events}</strong> events</li>
            <li><strong>{footprint.media}</strong> photos / videos / audio (incl. their R2 objects)</li>
            <li><strong>{footprint.people}</strong> people</li>
          </ul>
          {!hasData && (
            <p className="muted small" style={{ marginTop: 12 }}>
              Nothing to clean up — they have no data yet.
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
