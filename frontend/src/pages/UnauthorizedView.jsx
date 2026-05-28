export default function UnauthorizedView({ email, onTryAnother, onBack }) {
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-eyebrow"><span className="login-pip" /> Access required</div>
        <h1 className="login-title">Not on the <em>list.</em></h1>
        <p className="login-sub">
          Hindsite is invite-only right now. The address you signed in with
          isn't on the allowlist yet.
        </p>

        <div className="stack">
          {email && (
            <div className="login-success">
              <p><b>You tried:</b></p>
              <p style={{ wordBreak: 'break-all' }}>{email}</p>
            </div>
          )}
          <p className="muted small" style={{ textAlign: 'center' }}>
            If you think this is a mistake, ask the admin to add this address —
            then come back and sign in again.
          </p>
          {onTryAnother && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px 16px' }}
              onClick={onTryAnother}
            >
              Use a different email
            </button>
          )}
          {onBack && (
            <button type="button" className="login-link" onClick={onBack}>
              ← Back to home
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
