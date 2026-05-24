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

const FILMSTRIP = [
  '1998 · summer in lake como',
  '2003 · started piano',
  '2007 · first job',
  '2012 · met sam',
  '2016 · moved to nyc',
  '2019 · finished the book',
  '2022 · lisbon, march',
  '2024 · dad’s 60th',
  '2026 · today',
]

const FOOTER_LINKS = {
  Product: ['How it works', 'Examples', 'Pricing', 'iOS app', 'Changelog'],
  Company: ['About', 'Manifesto', 'Journal', 'Careers', 'Press'],
  Resources: ['Templates', 'Help center', 'Privacy primer', 'Status', 'Contact'],
  Legal: ['Privacy', 'Terms', 'Security', 'Cookies', 'DPA'],
}

export default function LandingPage({ onEnter }) {
  const [menuOpen, setMenuOpen] = useState(false)

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (!menuOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div className="hindsite">
      {/* ===== NAV ===== */}
      <div className="hs-nav-wrap">
        <nav className="hs-nav">
          <a className="hs-logo" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
            <Brandmark />
            <span>Hindsite</span>
          </a>
          <div className="hs-nav-links">
            <a href="#features">How it works</a>
            <a href="#features">Examples</a>
            <a href="#cta">Pricing</a>
            <a href="#cta">Journal</a>
          </div>
          <div className="hs-nav-cta">
            <button type="button" className="hs-signin" onClick={onEnter}>Sign in</button>
            <button type="button" className="hs-btn hs-btn-dark" onClick={onEnter}>Start free</button>
          </div>
          <button
            type="button"
            className={`hs-burger${menuOpen ? ' is-open' : ''}`}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>
        </nav>
      </div>

      {/* ===== MOBILE MENU ===== */}
      <div className={`hs-mobile-menu${menuOpen ? ' is-open' : ''}`} aria-hidden={!menuOpen}>
        <div className="hs-mobile-menu-inner">
          <div className="hs-mobile-menu-brand"><span className="hs-pip" /> Menu</div>
          <ul className="hs-mobile-links">
            <li><a href="#features" onClick={() => setMenuOpen(false)}>How it works</a></li>
            <li><a href="#features" onClick={() => setMenuOpen(false)}>Examples</a></li>
            <li><a href="#cta" onClick={() => setMenuOpen(false)}>Pricing</a></li>
            <li><a href="#cta" onClick={() => setMenuOpen(false)}>Journal</a></li>
          </ul>
          <div className="hs-mobile-cta">
            <button type="button" className="hs-btn hs-btn-ghost" onClick={onEnter}>Sign in</button>
            <button type="button" className="hs-btn hs-btn-dark" onClick={onEnter}>Start free</button>
          </div>
          <div className="hs-mobile-foot">
            <span>hello@hindsite.app</span>
            <span>Look back, on purpose.</span>
          </div>
        </div>
      </div>

      {/* ===== HERO ===== */}
      <section className="hs-hero" id="top">
        <div className="hs-hero-video" aria-hidden="true" />

        {/* drifting polaroids — drop real photos into frontend/public/landing/ */}
        <div className="hs-memory hs-m1"><div className="hs-pic" style={{ backgroundImage: 'url(/landing/photo-1.jpg)' }} /><div className="hs-cap">a quiet morning</div></div>
        <div className="hs-memory hs-m2"><div className="hs-pic" style={{ backgroundImage: 'url(/landing/photo-2.jpeg)' }} /><div className="hs-cap">the trip we almost cancelled</div></div>
        <div className="hs-memory hs-m3"><div className="hs-pic" style={{ backgroundImage: 'url(/landing/photo-3.jpg)' }} /><div className="hs-cap">summer, somewhere</div></div>

        <div className="hs-play-pill">
          <span className="hs-rec-dot" />
          Hero film · 00:42 / 02:10
        </div>

        <div className="hs-hero-scrim" aria-hidden="true" />

        <div className="hs-hero-content">
          <div>
            <div className="hs-eyebrow on-dark"><span className="hs-pip on-gold" /> A personal event timeline</div>
            <h1 className="hs-h1">
              Your life,<br />
              finally <em>searchable.</em>
            </h1>
            <p className="hs-hero-sub">
              Hindsite is a private, beautiful timeline of everything you've done. Look back, find
              patterns, remember more.
            </p>

            <div className="hs-cta-row">
              <button className="hs-cta-demo" type="button" onClick={onEnter} aria-label="Watch the demo">
                <span className="hs-thumb" aria-hidden="true" />
                <span className="hs-cta-meta">
                  <span className="hs-cta-t">Watch the demo</span>
                  <span className="hs-cta-s">2 min walkthrough</span>
                </span>
              </button>
              <button className="hs-cta-main" type="button" onClick={onEnter}>
                Create your timeline
                <span className="hs-arrow">↗</span>
              </button>
            </div>
          </div>

          <div className="hs-hero-meta">
            <div className="hs-stat">
              <span className="hs-stat-n">12,408</span>
              <span className="hs-stat-l">memories saved this week</span>
            </div>
            <div className="hs-scroll-cue">Scroll <span className="hs-scroll-line" /></div>
          </div>
        </div>

        <div className="hs-filmstrip" aria-hidden="true">
          {FILMSTRIP.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </section>

      {/* ===== FEATURES ===== */}
      <section className="hs-features" id="features">
        <div className="hs-features-head">
          <div>
            <div className="hs-eyebrow"><span className="hs-pip" /> What it does</div>
            <h2 className="hs-h2">Two ideas. <em>That's the whole product.</em></h2>
          </div>
          <p className="hs-features-lede">
            Hindsite isn't a journal, a photo app, or a CRM for your life. It's a single, scrollable
            timeline — and two things on top of it.
          </p>
        </div>

        <div className="hs-feature-grid">
          <article className="hs-feature">
            <div className="hs-visual hs-vis-timeline">
              <div className="hs-year-rail">
                <span>2019</span><span>2020</span><span>2021</span>
                <span className="hs-year-marker">● 2022</span>
                <span>2023</span><span>2024</span>
              </div>
              <div className="hs-events">
                <div className="hs-ev">
                  <span className="hs-pin" />
                  <div className="hs-ev-d">Feb 14</div>
                  <div>Started running again after surgery.</div>
                </div>
                <div className="hs-ev hs-ev-hot">
                  <span className="hs-pin" />
                  <div className="hs-ev-d">Mar 03 · Lisbon</div>
                  <div>Three days alone. First time in years.</div>
                </div>
                <div className="hs-ev">
                  <span className="hs-pin" />
                  <div className="hs-ev-d">Apr 22</div>
                  <div>Coffee with R. Said yes to the job.</div>
                </div>
              </div>
            </div>
            <div className="hs-feature-body">
              <div className="hs-feature-num">01 / Capture</div>
              <h3 className="hs-feature-h3">Drop in a moment in five seconds.</h3>
              <p>
                One field, a date, a photo if you have it. Hindsite handles the rest — geocoding,
                tagging the people, threading it into the right month — so capturing a memory feels
                lighter than sending a text.
              </p>
            </div>
          </article>

          <article className="hs-feature">
            <div className="hs-visual hs-vis-replay">
              <div className="hs-chips">
                <span className="hs-chip is-on">people: sam <span className="hs-chip-x">×</span></span>
                <span className="hs-chip is-on">place: lisbon <span className="hs-chip-x">×</span></span>
                <span className="hs-chip">year: any</span>
                <span className="hs-chip">mood: ↗</span>
                <span className="hs-chip">type: trip</span>
              </div>
              <div className="hs-pattern">
                <div>
                  <div className="hs-pattern-label">Pattern surfaced</div>
                  <div className="hs-pattern-quote">"You're happiest the week after you travel alone."</div>
                </div>
                <div className="hs-spark">
                  <i style={{ height: '40%' }} /><i style={{ height: '55%' }} /><i style={{ height: '30%' }} />
                  <i style={{ height: '80%' }} /><i style={{ height: '95%' }} /><i style={{ height: '70%' }} />
                  <i style={{ height: '45%' }} /><i style={{ height: '60%' }} />
                </div>
              </div>
            </div>
            <div className="hs-feature-body">
              <div className="hs-feature-num">02 / Replay</div>
              <h3 className="hs-feature-h3">Look back on any axis you choose.</h3>
              <p>
                Filter your life by person, place, year or mood. Hindsite quietly notices the
                patterns you couldn't see from the inside, and shows you the ones worth knowing
                about — hindsight, automated.
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* ===== BIG CTA ===== */}
      <section className="hs-big-cta" id="cta">
        <div className="hs-big-cta-inner">
          <div className="hs-eyebrow on-dark"><span className="hs-pip" /> Start your timeline</div>
          <h2 className="hs-big-h2">
            Hindsight is 20/20.<br />
            <em>Hindsite is one click.</em>
          </h2>
          <p className="hs-big-sub">
            Add one event today. Add another tomorrow. A year from now, your timeline pays you back
            for every second you spent on it.
          </p>

          <div className="hs-arc" aria-hidden="true">
            <span className="hs-arc-dot" style={{ left: '8%' }} />
            <span className="hs-arc-label" style={{ left: '8%' }}>birth</span>

            <span className="hs-arc-dot dim" style={{ left: '38%' }} />
            <span className="hs-arc-label" style={{ left: '38%' }}>a year ago</span>

            <span className="hs-arc-dot dim2" style={{ left: '62%' }} />
            <span className="hs-arc-label" style={{ left: '62%' }}>last month</span>

            <span className="hs-arc-dot now" style={{ left: '88%' }} />
            <span className="hs-arc-now" style={{ left: '88%' }}>you · now</span>
          </div>

          <div className="hs-big-actions">
            <button className="hs-btn hs-btn-accent hs-btn-big" type="button" onClick={onEnter}>
              Create my timeline <span className="hs-arrow">↗</span>
            </button>
            <button className="hs-btn hs-btn-ghost-dark hs-btn-big" type="button" onClick={onEnter}>
              Watch the demo
            </button>
          </div>

          <div className="hs-trust">
            <span>Free forever for personal use</span>
            <span>End-to-end encrypted</span>
            <span>Export anytime</span>
          </div>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="hs-footer">
        <div className="hs-footer-grid">
          <div className="hs-footer-brand">
            <a className="hs-logo" href="#top" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
              <Brandmark />
              <span>Hindsite</span>
            </a>
            <p>A private timeline for the moments that shaped you. Made slowly.</p>
            <form className="hs-subscribe" onSubmit={(e) => e.preventDefault()}>
              <input type="email" placeholder="you@somewhere.com" aria-label="Email" />
              <button type="submit">Subscribe</button>
            </form>
          </div>
          {Object.entries(FOOTER_LINKS).map(([title, items]) => (
            <div key={title}>
              <h4>{title}</h4>
              <ul>
                {items.map((label) => <li key={label}><a href="#top">{label}</a></li>)}
              </ul>
            </div>
          ))}
        </div>

        <div className="hs-footer-wordmark" aria-hidden="true">Hindsite</div>

        <div className="hs-footer-bottom">
          <span>© {new Date().getFullYear()} Hindsite · Look back, on purpose.</span>
          <div className="hs-footer-links">
            <a href="#top">Twitter</a>
            <a href="#top">Instagram</a>
            <a href="#top">RSS</a>
            <a href="#top">hello@hindsite.app</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
