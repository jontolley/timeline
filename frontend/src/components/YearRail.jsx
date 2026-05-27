import { useCallback, useEffect, useMemo, useRef } from 'react'

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
  const listRef = useRef(null)
  const observerRef = useRef(null)
  const maxCount = useMemo(
    () => (years && years.length ? Math.max(...years.map((y) => y.count || 0)) : 0),
    [years],
  )

  // Publish the rail's rendered height as --year-rail-h so the mobile
  // toolbar can stick directly underneath the horizontal year strip. Same
  // pattern as the topbar's --topbar-h. On desktop the var still updates
  // but the desktop CSS doesn't consume it, so it's a harmless no-op.
  //
  // Implemented as a ref callback (not a useEffect) because YearRail
  // returns null before `years` loads — a useEffect with [] deps would
  // fire once with no DOM node and never re-run when the rail later
  // mounts, leaving --year-rail-h unset and the mobile toolbar stuck
  // *under* the rail.
  const setRailNode = useCallback((el) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (!el) return
    const apply = () => {
      const h = Math.round(el.getBoundingClientRect().height)
      if (h > 0) document.documentElement.style.setProperty('--year-rail-h', `${h}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    observerRef.current = ro
  }, [])

  // Keep the active pill within the rail's own scroll viewport (horizontal on
  // mobile, vertical on desktop) without nudging the page scroll position.
  // The scroll container differs per breakpoint (.yearspine on desktop, .yr-list
  // on mobile), so walk up from the button to find whichever ancestor scrolls.
  useEffect(() => {
    const list = listRef.current
    if (!list || activeYear == null) return
    const btn = list.querySelector(`[data-year="${activeYear}"]`)
    if (!btn) return
    let scroller = btn.parentElement
    while (scroller) {
      const s = getComputedStyle(scroller)
      if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) break
      scroller = scroller.parentElement
    }
    if (!scroller) return
    const sRect = scroller.getBoundingClientRect()
    const bRect = btn.getBoundingClientRect()
    const margin = 24
    // Only push on axes the scroller actually scrolls on. Without these guards
    // the mobile horizontal strip would emit a vertical scrollBy (the pill's
    // top sits a few px below the list top inside the 24px margin), which some
    // browsers bubble to the window — kicking the page scroll and the active
    // year right back into a feedback loop.
    const canScrollX = scroller.scrollWidth - scroller.clientWidth > 1
    const canScrollY = scroller.scrollHeight - scroller.clientHeight > 1
    let dx = 0
    let dy = 0
    if (canScrollX) {
      if (bRect.left < sRect.left + margin) dx = bRect.left - sRect.left - margin
      else if (bRect.right > sRect.right - margin) dx = bRect.right - sRect.right + margin
    }
    if (canScrollY) {
      if (bRect.top < sRect.top + margin) dy = bRect.top - sRect.top - margin
      else if (bRect.bottom > sRect.bottom - margin) dy = bRect.bottom - sRect.bottom + margin
    }
    if (dx || dy) scroller.scrollBy({ left: dx, top: dy, behavior: 'smooth' })
  }, [activeYear])

  if (!years || years.length === 0) return null

  return (
    <aside className="yearspine" aria-label="Jump to year" ref={setRailNode}>
      <p className="yearspine-lbl">Years</p>
      <ul className="yr-list" ref={listRef}>
        {years.map((y) => {
          const isActive = y.year === activeYear
          const pct = maxCount > 0 ? Math.max(8, Math.round((y.count / maxCount) * 100)) : 0
          return (
            <li key={y.year}>
              <button
                type="button"
                className={`yr${isActive ? ' on' : ''}`}
                data-year={y.year}
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
