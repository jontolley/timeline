import { useState } from 'react'
import { requestLogin } from '../api/auth'

export default function LoginView({ onBack }) {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await requestLogin(email.trim())
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Failed to send sign-in link')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="login-title">Timeline</h1>
        <p className="login-sub">Sign in to continue.</p>

        {submitted ? (
          <div className="stack">
            <div className="login-success">
              <p><b>Check your email.</b></p>
              <p>
                If that address is allowed, a sign-in link has been sent. The link expires in
                15 minutes.
              </p>
            </div>
            <button
              type="button"
              className="login-link"
              onClick={() => { setSubmitted(false); setEmail('') }}
            >
              Use a different email
            </button>
            {onBack && (
              <button type="button" className="login-link" onClick={onBack}>
                ← Back
              </button>
            )}
          </div>
        ) : (
          <form className="form" onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="login-email" className="field-label">Email address</label>
              <input
                id="login-email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
              />
            </div>
            {error && <p className="form-error">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px 16px' }}
              disabled={busy}
            >
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
            {onBack && (
              <button type="button" className="login-link" onClick={onBack}>
                ← Back
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
