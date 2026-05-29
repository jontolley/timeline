/* 404 page. Reached by:
 *   - any unmatched route inside the authenticated <Routes> (via path="*")
 *   - any URL the user shares that no longer points anywhere
 *
 * Plain <a href="/"> for the back link so it works in both signed-in
 * and signed-out states. Shows the offending pathname so the user can
 * see whether they typo'd. */

function NotFoundBrand() {
  return (
    <a href="/" className="notfound-brand" aria-label="Hindsite home">
      <span className="notfound-brand-mark" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="16" cy="16" r="2" fill="currentColor" />
          <path d="M16 6 V 13 M22 24 L 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <span className="notfound-brand-word">Hindsite</span>
    </a>
  )
}

export default function NotFoundView() {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : ''

  return (
    <main className="notfound-page">
      <NotFoundBrand />
      <p className="notfound-eyebrow"><span className="pip" /> 404 · not here</p>
      <h1 className="notfound-title">
        Couldn't find that <em>page.</em>
      </h1>
      {pathname && (
        <p className="notfound-path">
          You tried <code>{pathname}</code>.
        </p>
      )}
      <p className="notfound-body">
        It might have been moved, never existed, or be living in a
        different timeline entirely. Either way, the home page is the
        fastest way back.
      </p>
      <p className="notfound-back">
        <a href="/">← Back to Hindsite</a>
      </p>
    </main>
  )
}
