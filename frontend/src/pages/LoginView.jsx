import { useState } from 'react'
import { requestLogin } from '../api/auth'

export default function LoginView() {
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
    <div className="min-h-screen bg-paper flex items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <h1 className="text-[28px] font-semibold tracking-tighter2 leading-none text-ink">
          Timeline
        </h1>
        <p className="text-sm text-ink-mute mt-2 mb-8">Sign in to continue.</p>

        {submitted ? (
          <div className="space-y-4">
            <div className="rounded-md bg-accent-soft ring-1 ring-accent-ring px-4 py-3">
              <p className="text-sm text-ink font-medium">Check your email.</p>
              <p className="text-xs text-ink-mute mt-1 leading-relaxed">
                If that address is allowed, a sign-in link has been sent. The link
                expires in 15 minutes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setSubmitted(false); setEmail('') }}
              className="text-sm text-ink-mute hover:text-ink underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-ink-mute mb-1.5">
                Email address
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
                className="w-full bg-paper text-ink placeholder:text-ink-faint border border-ink-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-ring focus:border-accent"
              />
            </label>
            {error && (
              <p className="text-sm text-rose-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-ink text-paper px-4 py-2 rounded-md text-sm font-medium hover:bg-ink-soft disabled:opacity-50 transition-colors"
            >
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
