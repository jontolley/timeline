import { useMemo } from 'react'

/**
 * Vertical year-navigation rail.
 * Each row is a pill with the year label and a density bar showing how active
 * that year is (bar width = count / max(counts) * 100%). Active year inverts
 * (dark bg + gold bar). Clicking jumps the feed to that year.
 *
 * `years` is the response from GET /events/years: [{ year, count }].
 * `activeYear` is set by the parent based on scroll position.
 */
export default function YearRail({ years, activeYear, onJump }) {
  const maxCount = useMemo(
    () => (years && years.length ? Math.max(...years.map((y) => y.count || 0)) : 0),
    [years],
  )

  if (!years || years.length === 0) return null

  return (
    <aside className="yearspine" aria-label="Jump to year">
      <p className="yearspine-lbl">Years</p>
      <ul className="yr-list">
        {years.map((y) => {
          const isActive = y.year === activeYear
          const pct = maxCount > 0 ? Math.max(8, Math.round((y.count / maxCount) * 100)) : 0
          return (
            <li key={y.year}>
              <button
                type="button"
                className={`yr${isActive ? ' on' : ''}`}
                onClick={() => onJump(y.year)}
                aria-current={isActive ? 'page' : undefined}
                title={`${y.count} event${y.count === 1 ? '' : 's'}`}
              >
                <span className="y">{y.year}</span>
                <span className="bar" style={{ width: `${pct}%` }} aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
