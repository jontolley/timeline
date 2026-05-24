import { useState } from 'react'
import { requestLogin } from '../api/auth'

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
    </svg>
  )
}

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
        <div className="login-eyebrow"><span className="login-pip" /> Sign in</div>
        <h1 className="login-title">Welcome <em>back.</em></h1>
        <p className="login-sub">Pick up wherever you left off.</p>

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
          <div className="stack">
            <a href="/api/auth/google/start" className="btn google-btn">
              <GoogleG /> Continue with Google
            </a>
            <div className="login-divider"><span>or</span></div>
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
          </div>
        )}
      </div>
    </div>
  )
}
