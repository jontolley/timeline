import { Component } from 'react'

/**
 * Catches render-time exceptions from any descendant and shows a graceful
 * fallback instead of whitescreening the entire app. Wraps both the
 * authenticated <Routes> tree and the unauthenticated shell in App.jsx.
 *
 * Does NOT catch async errors (promise rejections), event-handler errors,
 * or server-side errors — those still bubble. For real prod observability
 * we'd add Sentry; this just prevents the worst UX failure (blank page
 * with no recovery option).
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Console-log for now; swap to Sentry / similar when wired up.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Render error:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  handleHome = () => {
    // Full-page navigation so any corrupted React state is reset.
    window.location.href = '/'
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="errboundary-page">
        <a href="/" className="errboundary-brand" aria-label="Hindsite home">
          <span className="errboundary-brand-mark" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="16" cy="16" r="2" fill="currentColor" />
              <path d="M16 6 V 13 M22 24 L 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className="errboundary-brand-word">Hindsite</span>
        </a>
        <p className="errboundary-eyebrow"><span className="pip" /> Something broke</p>
        <h1 className="errboundary-title">
          That wasn't supposed to <em>happen.</em>
        </h1>
        <p className="errboundary-body">
          Hindsite hit an unexpected error while rendering this page. Your
          data is safe — only this view crashed. Try reloading; if it
          keeps happening, jump back home and pick a different page.
        </p>
        <div className="errboundary-actions">
          <button type="button" className="btn btn-primary" onClick={this.handleReload}>
            Reload this page
          </button>
          <button type="button" className="btn" onClick={this.handleHome}>
            Back to home
          </button>
        </div>
        {/* Tiny details block so a sympathetic user can paste the message
            back to us if they file a bug. Hidden behind <details> so it
            doesn't dominate the fallback. */}
        <details className="errboundary-details">
          <summary>Technical details</summary>
          <pre>{String(this.state.error?.stack || this.state.error || 'unknown')}</pre>
        </details>
      </main>
    )
  }
}
