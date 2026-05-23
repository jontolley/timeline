import { useEffect, useState } from 'react'
import { deleteUser, getUserFootprint, inviteUser, updateUserRole } from '../api/users'
import { useAuthStore, useUserStore } from '../store'

export default function UsersSettings() {
  const { users, loaded, load } = useUserStore()
  const currentUserId = useAuthStore((s) => s.userId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [footprint, setFootprint] = useState(null)
  const [lastInvited, setLastInvited] = useState(null)

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const refresh = () => load(true).catch((e) => setError(e.message))

  const handleInvite = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const newUser = await inviteUser({ email: email.trim().toLowerCase(), role })
      await refresh()
      setLastInvited({ email: newUser.email, url: window.location.origin })
      setEmail('')
      setRole('user')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!lastInvited) return
    try {
      await navigator.clipboard.writeText(lastInvited.url)
    } catch { /* ignore — user can copy manually */ }
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

  const cancelDelete = () => {
    setDeleteTarget(null)
    setFootprint(null)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    setError(null)
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

  if (!loaded) {
    return <p className="muted small">Loading…</p>
  }

  return (
    <div className="settings-section">
      <div className="page-head">
        <h2 className="section-title">Users</h2>
      </div>

      <p className="muted small" style={{ marginBottom: 18 }}>
        Add people by email. After you add them, share the sign-in link below — they'll
        be able to sign in with Google or the magic-link form. Each user has their own
        private timeline. Admins manage other users; everyone else can only see their own data.
      </p>

      {error && <p className="form-error" style={{ marginBottom: 18 }}>{error}</p>}

      {lastInvited && (
        <div className="form-notice" style={{ marginBottom: 18 }}>
          <p style={{ margin: 0, marginBottom: 6 }}>
            <strong>{lastInvited.email}</strong> can now sign in. Share this link with them:
          </p>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <code style={{
              flex: 1, padding: '6px 10px', background: 'var(--surface)',
              border: '1px solid var(--line)', borderRadius: 6, fontSize: 12.5,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {lastInvited.url}
            </code>
            <button type="button" className="btn btn-ghost" onClick={copyLink}>Copy</button>
            <button type="button" className="btn btn-ghost" onClick={() => setLastInvited(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleInvite} className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div className="form">
          <div className="field">
            <label className="field-label" htmlFor="invite-email">
              Email<span className="field-required">*</span>
            </label>
            <input
              id="invite-email"
              className="input"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@example.com"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !email}>
              {busy ? 'Adding…' : 'Add user'}
            </button>
          </div>
        </div>
      </form>

      <div className="stack">
        {users.map((u) => {
          const isSelf = u._id === currentUserId
          return (
            <div key={u._id} className="list-card">
              <div className="row" style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{u.email}</span>
                {isSelf && (
                  <span className="mono muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    you
                  </span>
                )}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <select
                  className="select"
                  value={u.role}
                  onChange={(e) => handleRoleChange(u, e.target.value)}
                  disabled={busy || isSelf}
                  style={{ minWidth: 110 }}
                  aria-label={`Role for ${u.email}`}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => beginDelete(u)}
                  disabled={busy || isSelf}
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {deleteTarget && (
        <DeleteConfirmModal
          email={deleteTarget.email}
          footprint={footprint}
          busy={busy}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}

function DeleteConfirmModal({ email, footprint, busy, onCancel, onConfirm }) {
  const loading = footprint === null
  const hasData = footprint && (
    footprint.events > 0 || footprint.media > 0 ||
    footprint.people > 0 || footprint.categories > 0
  )
  return (
    <div className="sheet-backdrop" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>Remove {email}?</h3>
        {loading ? (
          <p className="muted small">Counting their data…</p>
        ) : (
          <>
            <p className="muted small" style={{ marginBottom: 16 }}>
              This permanently deletes everything this user owns. It cannot be undone.
            </p>
            <ul className="footprint-list">
              <li><strong>{footprint.events}</strong> events</li>
              <li><strong>{footprint.media}</strong> photos / videos / audio (incl. their R2 objects)</li>
              <li><strong>{footprint.people}</strong> people</li>
              <li><strong>{footprint.categories}</strong> categories</li>
            </ul>
            {!hasData && (
              <p className="muted small" style={{ marginTop: 12 }}>
                Nothing to clean up — they have no data yet.
              </p>
            )}
          </>
        )}
        <div className="form-actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={busy || loading}
          >
            {busy ? 'Deleting…' : 'Delete user & data'}
          </button>
        </div>
      </div>
    </div>
  )
}
