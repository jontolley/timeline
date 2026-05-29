import { useEffect, useState } from 'react'

function Brandmark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="2" fill="currentColor" />
        <path d="M16 6 V 13 M22 24 L 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export default function LandingPage({ onEnter }) {
  const [eventCount, setEventCount] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/stats/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.event_count === 'number') {
          setEventCount(data.event_count)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div className="hindsite">
      {/* ===== NAV ===== */}
      <div className="hs-nav-wrap">
        <nav className="hs-nav">
          <a className="hs-logo" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
            <Brandmark />
            <span>Hindsite</span>
          </a>
          <div className="hs-nav-cta">
            <button type="button" className="hs-signin" onClick={onEnter}>Sign in</button>
          </div>
        </nav>
      </div>

      {/* ===== HERO ===== */}
      <section className="hs-hero" id="top">
        <div className="hs-hero-video" aria-hidden="true" />

        {/* drifting polaroids — drop real photos into frontend/public/landing/ */}
        <div className="hs-memory hs-m1"><div className="hs-pic" style={{ backgroundImage: 'url(/landing/photo-1.jpg)' }} /><div className="hs-cap">a quiet morning</div></div>
        <div className="hs-memory hs-m2"><div className="hs-pic" style={{ backgroundImage: 'url(/landing/photo-2.jpg)' }} /><div className="hs-cap">the trip we almost cancelled</div></div>
        <div className="hs-memory hs-m3"><div className="hs-pic" style={{ backgroundImage: 'url(/landing/photo-3.jpg)' }} /><div className="hs-cap">summer, somewhere</div></div>

        <div className="hs-hero-scrim" aria-hidden="true" />

        <div className="hs-hero-content">
          <div>
            <div className="hs-eyebrow on-dark"><span className="hs-pip on-gold" /> A personal event timeline</div>
            <h1 className="hs-h1">
              Your life,<br />
              finally <em>searchable.</em>
            </h1>
            <p className="hs-hero-sub">
              Hindsite is a private, beautiful timeline of everything you've done. Look back and remember more.
            </p>
          </div>

          <div className="hs-hero-meta">
            <div className="hs-stat">
              <span className="hs-stat-n">
                {eventCount === null ? '—' : eventCount.toLocaleString()}
              </span>
              <span className="hs-stat-l">memories saved</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="hs-footer">
        <div className="hs-footer-wordmark" aria-hidden="true">Hindsite</div>

        <div className="hs-footer-bottom">
          <span>© {new Date().getFullYear()} Hindsite · Look back, on purpose.</span>
          <a href="/privacy" className="hs-footer-link">Privacy</a>
        </div>
      </footer>
    </div>
  )
}
