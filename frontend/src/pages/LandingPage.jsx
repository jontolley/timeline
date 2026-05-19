function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <line x1="6.5" y1="1.5" x2="6.5" y2="11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="1.5" y1="6.5" x2="11.5" y2="6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Brandmark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="9.5" stroke="currentColor" strokeWidth="1.4" />
        <line x1="11" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="11" y1="11" x2="16" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]
const CURRENT_YEAR = new Date().getUTCFullYear()

export default function LandingPage({ onEnter }) {
  return (
    <>
      <header className="topbar bare">
        <span className="brand">
          <Brandmark />
          <span>Timeline</span>
        </span>
        <div className="topbar-spacer" />
        <button type="button" className="btn btn-ghost" onClick={onEnter}>
          Sign in
        </button>
      </header>

      <div className="landing">
        <div className="landing-inner">
          <div className="landing-eyebrow">A timeline for the people you love</div>
          <h1 className="landing-hero">
            The years<br />
            you'll want<br />
            to <em>remember.</em>
          </h1>
          <p className="landing-lede">
            A private, shared timeline for the people you love — trips, milestones, the quiet days
            too. Capture a moment in seconds; come back to it years later and feel the whole thing
            again.
          </p>
          <div className="landing-actions">
            <button type="button" className="btn btn-primary" onClick={onEnter}>
              Sign in
            </button>
            <button type="button" className="btn btn-accent" onClick={onEnter}>
              <PlusIcon />
              Capture a moment
            </button>
            <button type="button" className="btn btn-ghost" onClick={onEnter}>
              See the timeline →
            </button>
          </div>

          <div className="year-strip" aria-hidden="true">
            {YEARS.map((y) => (
              <span key={y} className={y === CURRENT_YEAR ? 'active' : ''}>
                {y}
              </span>
            ))}
            <span className="present">___ present ___</span>
          </div>

          <div className="landing-divider" />

          <div className="landing-features">
            <div>
              <div className="feature-num">01 / Capture</div>
              <h3 className="feature-title">A line is enough.</h3>
              <p className="feature-body">
                Type a sentence, or chat with the assistant. The hard parts — dates, categories,
                who was there — get sorted for you.
              </p>
            </div>
            <div>
              <div className="feature-num">02 / Shared</div>
              <h3 className="feature-title">Built for the people in it.</h3>
              <p className="feature-body">
                Invite family. Tag who was there. Everyone adds the parts only they remember, and
                the whole picture comes together.
              </p>
            </div>
            <div>
              <div className="feature-num">03 / Yours</div>
              <h3 className="feature-title">Private, by default.</h3>
              <p className="feature-body">
                Your timeline is yours. Export, back up, take it with you. No algorithms deciding
                what's worth remembering.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
