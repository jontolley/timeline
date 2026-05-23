import { useEffect, useState } from 'react'
import { deleteUser, inviteUser, updateUserRole } from '../api/users'
import { useAuthStore, useUserStore } from '../store'

export default function UsersSettings() {
  const { users, loaded, load } = useUserStore()
  const currentUserId = useAuthStore((s) => s.userId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!loaded) load().catch((e) => setError(e.message))
  }, [loaded, load])

  const refresh = () => load(true).catch((e) => setError(e.message))

  const handleInvite = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await inviteUser({ email: email.trim().toLowerCase(), role })
      await refresh()
      setEmail('')
      setRole('user')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
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

  const handleDelete = async (user) => {
    if (!window.confirm(`Remove ${user.email}? Their data stays — but they lose access.`)) return
    setBusy(true)
    setError(null)
    try {
      await deleteUser(user._id)
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
        <h2 className="section-title">Users</h2>
      </div>

      <p className="muted small" style={{ marginBottom: 18 }}>
        Invite people by email. Until they sign in for the first time, they'll have an empty
        timeline. Admins manage other users; regular users can only see their own data.
      </p>

      {error && <p className="form-error" style={{ marginBottom: 18 }}>{error}</p>}

      <form onSubmit={handleInvite} className="card" style={{ padding: 20, marginBottom: 24 }}>
        <div className="form">
          <div className="field">
            <label className="field-label" htmlFor="invite-email">
              Invite email<span className="field-required">*</span>
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
              {busy ? 'Inviting…' : 'Send invite'}
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
                  onClick={() => handleDelete(u)}
                  disabled={busy || isSelf}
                >
                  Remove
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
