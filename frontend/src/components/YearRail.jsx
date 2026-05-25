/**
 * Vertical year-navigation rail rendered alongside the timeline.
 * - Clicking a year asks the parent to jump there (cursor-reset in
 *   TimelineView; bidirectional pagination keeps later years reachable
 *   by scrolling up).
 * - `activeYear` is set by the parent based on the topmost visible event.
 * - Mobile collapses to a horizontal scroller above the timeline.
 */
export default function YearRail({ years, activeYear, onJump }) {
  if (!years || years.length === 0) return null

  return (
    <aside className="year-rail" aria-label="Jump to year">
      <p className="year-rail-eyebrow">Years</p>
      <ol className="year-rail-list">
        {years.map((y) => {
          const isActive = y.year === activeYear
          return (
            <li key={y.year}>
              <button
                type="button"
                className={`year-rail-item${isActive ? ' is-active' : ''}`}
                onClick={() => onJump(y.year)}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="year-rail-dot" aria-hidden="true" />
                <span className="year-rail-year">{y.year}</span>
                <span className="year-rail-count">{y.count}</span>
              </button>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
