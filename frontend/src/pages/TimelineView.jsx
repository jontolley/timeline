import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listEvents, listEventYears } from '../api/events'
import { describePhoto, extractExif } from '../api/uploads'
import EventCard from '../components/EventCard'
import FilterModal from '../components/FilterModal'
import TimelineToolbar from '../components/TimelineToolbar'
import YearRail from '../components/YearRail'
import { setPendingCaption, setPendingPhoto } from '../lib/photoHandoff'
import { useAlert } from '../lib/confirm'
import { useEventStore, usePeopleStore, useThreadStore } from '../store'
import { dayOf, monthDayShort, monthNameOf, monthOf, weekdayShort, yearOf } from '../utils/date'

const PAGE_SIZE = 20

function buildFilterParams(filters) {
  const params = {}
  if (filters.event_type) params.event_type = filters.event_type
  if (filters.person_ids?.length) params.person_id = filters.person_ids
  if (filters.thread_ids?.length) params.thread_id = filters.thread_ids
  return params
}

function buildListParams(filters, { before = null, after = null } = {}) {
  const params = { limit: PAGE_SIZE, ...buildFilterParams(filters) }
  if (before) {
    params.before_date = before.date
    params.before_id = before.id
  }
  if (after) {
    params.after_date = after.date
    params.after_id = after.id
  }
  return params
}

export default function TimelineView() {
  const navigate = useNavigate()
  const {
    events,
    filters,
    hasMoreOlder,
    hasMoreNewer,
    anchorId,
    loaded,
    setFilters: setStoreFilters,
    setInitialPage,
    appendOlder,
    prependNewer,
    jumpToWindow,
    setAnchorId,
  } = useEventStore()
  const [loading, setLoading] = useState(!loaded)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [aiPhotoBusy, setAiPhotoBusy] = useState(false)
  const [years, setYears] = useState([])
  const [activeYear, setActiveYear] = useState(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const threadCount = useThreadStore((s) => s.threads.length)
  const photoInputRef = useRef(null)
  const aiPhotoInputRef = useRef(null)
  const bottomSentinelRef = useRef(null)
  const topSentinelRef = useRef(null)
  // Guards async loaders from stale-state re-entry and from racing the initial load.
  const fetchingOlderRef = useRef(false)
  const fetchingNewerRef = useRef(false)
  // One-shot guard: restore anchor only on the first event-render after mount.
  const anchorRestoredRef = useRef(false)
  // Scroll-anchor snapshot used to keep the viewport stable when newer events
  // are prepended. Cleared by the useLayoutEffect that applies the correction.
  const pendingScrollFixRef = useRef(null)
  const { people, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()
  const alert = useAlert()

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  // Initial load — skip if the store already has events from a previous mount.
  useEffect(() => {
    if (loaded) {
      setLoading(false)
      return
    }
    let cancelled = false
    fetchingOlderRef.current = true
    setLoading(true)
    listEvents(buildListParams(filters))
      .then((page) => {
        if (cancelled) return
        setInitialPage(page, page.length === PAGE_SIZE)
      })
      .catch(console.error)
      .finally(() => {
        // Always release the ref lock — even if cancelled — so the next
        // loadOlder call doesn't bail out on a stale "in-flight" flag.
        fetchingOlderRef.current = false
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [filters, loaded, setInitialPage])

  // Year-bucket index for the sidebar. Refetched on filter change so the
  // rail only lists years that actually have matching events.
  useEffect(() => {
    let cancelled = false
    listEventYears(buildFilterParams(filters))
      .then((data) => { if (!cancelled) setYears(data) })
      .catch(() => { if (!cancelled) setYears([]) })
    return () => { cancelled = true }
  }, [filters])

  // Restore scroll position by scrolling the anchor element into view.
  // Robust to image-load height shifts because we anchor on a DOM node, not a
  // pixel offset.
  useEffect(() => {
    if (anchorRestoredRef.current) return
    if (events.length === 0) return
    anchorRestoredRef.current = true
    if (!anchorId) return
    const el = document.querySelector(`[data-event-id="${anchorId}"]`)
    if (el) {
      requestAnimationFrame(() =>
        el.scrollIntoView({ behavior: 'auto', block: 'start' }),
      )
    }
  }, [events.length, anchorId])

  // Continuously track scroll position. We update two things from one rAF
  // tick:
  //   • `anchorId`  — for nav-back scroll restoration. Comes from event cards.
  //   • `activeYear` — sidebar highlight. Comes from year-markers, not cards:
  //     the active year is the *last* marker whose top has crossed the
  //     topbar's bottom edge. Marker-based tracking is direction-symmetric
  //     because both up and down scrolling cross the same line in the same
  //     way, whereas a card-based test ("first card whose bottom is below
  //     the topbar") can flip a frame too early/late depending on which
  //     direction you crossed the year boundary.
  useEffect(() => {
    let rafId = null
    const topbarHeight = () => {
      const el = document.querySelector('.topbar')
      return el ? el.getBoundingClientRect().height : 64
    }
    const update = () => {
      rafId = null
      const topbarH = topbarHeight()
      // Buffer so the year flips when the marker is *approaching* the top
      // edge, not strictly after it crosses. Feels more responsive when
      // scrolling slowly.
      const threshold = topbarH + 24

      // Year-marker scrollspy. Markers are in document order, newest first
      // (2026 → … → 1970). The "active" one is the latest in DOM order
      // whose top is still at or above the threshold.
      const markers = document.querySelectorAll('[data-year-marker]')
      let activeMarker = null
      for (const m of markers) {
        if (m.getBoundingClientRect().top <= threshold) {
          activeMarker = m
        } else {
          break // remaining markers are further down, can't beat this
        }
      }
      if (activeMarker) {
        const y = parseInt(activeMarker.getAttribute('data-year-marker'), 10)
        if (y) setActiveYear(y)
      }

      // Anchor tracking for nav-back scroll restoration.
      const cards = document.querySelectorAll('[data-event-id]')
      for (const card of cards) {
        if (card.getBoundingClientRect().bottom > topbarH) {
          const id = card.getAttribute('data-event-id')
          if (id) setAnchorId(id)
          return
        }
      }
    }
    const onScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    // Capture an initial anchor too, so a fresh page load sets one immediately.
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [setAnchorId])

  // Apply scroll-anchor correction after a prepend. Stored ref carries the
  // topmost visible event's id + its viewport-relative top at fetch-time;
  // after React paints the new (now-larger) list, we shift scroll by the delta
  // so the user's view stays put.
  useLayoutEffect(() => {
    const fix = pendingScrollFixRef.current
    if (!fix) return
    pendingScrollFixRef.current = null
    const el = document.querySelector(`[data-event-id="${fix.anchorId}"]`)
    if (!el) return
    const newTop = el.getBoundingClientRect().top
    const delta = newTop - fix.originalTop
    if (delta !== 0) window.scrollBy(0, delta)
  }, [events])

  const loadOlder = useCallback(async () => {
    if (fetchingOlderRef.current || loadingMore || !hasMoreOlder || events.length === 0) return
    fetchingOlderRef.current = true
    setLoadingMore(true)
    const last = events[events.length - 1]
    try {
      const page = await listEvents(
        buildListParams(filters, { before: { date: last.date, id: last._id } }),
      )
      appendOlder(page, page.length === PAGE_SIZE)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
      fetchingOlderRef.current = false
    }
  }, [events, filters, hasMoreOlder, loadingMore, appendOlder])

  const loadNewer = useCallback(async () => {
    if (fetchingNewerRef.current || loadingNewer || !hasMoreNewer || events.length === 0) return
    fetchingNewerRef.current = true
    setLoadingNewer(true)
    const first = events[0]
    // Snapshot the current top anchor *before* we mutate state — after the
    // prepend, the useLayoutEffect uses this to keep the viewport stable.
    const anchorEl = document.querySelector(`[data-event-id="${first._id}"]`)
    if (anchorEl) {
      pendingScrollFixRef.current = {
        anchorId: first._id,
        originalTop: anchorEl.getBoundingClientRect().top,
      }
    }
    try {
      const page = await listEvents(
        buildListParams(filters, { after: { date: first.date, id: first._id } }),
      )
      // Backend returns newest-first; prepend in the same order.
      prependNewer(page, page.length === PAGE_SIZE)
    } catch (err) {
      console.error(err)
      pendingScrollFixRef.current = null
    } finally {
      setLoadingNewer(false)
      fetchingNewerRef.current = false
    }
  }, [events, filters, hasMoreNewer, loadingNewer, prependNewer])

  // Bottom sentinel — loads older events.
  useEffect(() => {
    const node = bottomSentinelRef.current
    if (!node || !hasMoreOlder || loading) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadOlder() },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadOlder, hasMoreOlder, loading])

  // Top sentinel — loads newer events after a year-jump.
  useEffect(() => {
    const node = topSentinelRef.current
    if (!node || !hasMoreNewer || loading) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadNewer() },
      { rootMargin: '400px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadNewer, hasMoreNewer, loading])

  const handleJumpToYear = useCallback(async (year) => {
    // Find the year already loaded? Just scroll to its first card.
    const existing = document.querySelector(`[data-year-marker="${year}"]`)
    if (existing) {
      anchorRestoredRef.current = true // skip the one-shot anchor restore on re-render
      existing.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveYear(year)
      return
    }
    // Not loaded — replace the list with a window that *straddles* the year:
    //   • a page of events strictly *after* Y/12/31 (newer years, providing
    //     context above the target year on first render)
    //   • a page of events at or before Y/12/31 (the target year and a few
    //     years older)
    // Combining both means the user lands in the middle of a window rather
    // than at the top, and scrolling up or down extends the window via the
    // normal sentinels.
    fetchingOlderRef.current = true
    setLoading(true)
    try {
      const cutoff = `${year + 1}-01-01T00:00:00.000Z`
      const [newer, older] = await Promise.all([
        listEvents(buildListParams(filters, { after: { date: cutoff } })),
        listEvents(buildListParams(filters, { before: { date: cutoff } })),
      ])
      anchorRestoredRef.current = true // we'll handle scroll ourselves
      jumpToWindow(
        [...newer, ...older],
        older.length === PAGE_SIZE,
        newer.length === PAGE_SIZE,
      )
      setActiveYear(year)
      // After paint, anchor on the first event of the target year so the user
      // lands at the year they clicked rather than at the very top of the
      // window.
      requestAnimationFrame(() => {
        const target = document.querySelector(`[data-year-marker="${year}"]`)
        if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' })
        else window.scrollTo({ top: 0, behavior: 'auto' })
      })
    } catch (err) {
      console.error(err)
    } finally {
      fetchingOlderRef.current = false
      setLoading(false)
    }
  }, [filters, jumpToWindow])

  const handlePhotoPicked = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try {
      const exif = await extractExif(file)
      setPendingPhoto(file)
      navigate('/events/new', { state: { prefill: exif } })
    } catch (err) {
      await alert({ title: 'Could not read photo', body: err.message || '' })
    } finally {
      setPhotoBusy(false)
    }
  }

  const handleAiPhotoPicked = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAiPhotoBusy(true)
    try {
      // Kick the AI call off first so it runs in parallel with the EXIF call.
      const captionPromise = describePhoto(file).catch((err) => ({ error: err.message }))
      const exif = await extractExif(file)
      setPendingPhoto(file)
      setPendingCaption(captionPromise)
      navigate('/events/new', { state: { prefill: { ...exif, aiCaption: true } } })
    } catch (err) {
      await alert({ title: 'Could not read photo', body: err.message || '' })
    } finally {
      setAiPhotoBusy(false)
    }
  }

  // API returns newest-first; nest groups year → month → day for the new
  // layout. We track the first month of each year so we can hang
  // `data-year-marker` on it for the scrollspy + jump targets.
  const groups = useMemo(() => {
    const years = []
    let curYear = null
    let curMonth = null
    let curDay = null
    for (const ev of events) {
      const y = yearOf(ev.date)
      const m = monthOf(ev.date)
      const d = dayOf(ev.date)
      if (!curYear || curYear.year !== y) {
        curYear = { year: y, months: [], firstMonthFlag: true }
        years.push(curYear)
        curMonth = null
        curDay = null
      }
      if (!curMonth || curMonth.month !== m) {
        curMonth = {
          month: m,
          monthName: monthNameOf(ev.date),
          sampleDate: ev.date,
          days: [],
          count: 0,
          isFirstOfYear: curYear.months.length === 0,
        }
        curYear.months.push(curMonth)
        curDay = null
      }
      if (!curDay || curDay.day !== d) {
        curDay = { day: d, sampleDate: ev.date, events: [] }
        curMonth.days.push(curDay)
      }
      curDay.events.push(ev)
      curMonth.count += 1
    }
    return years
  }, [events])

  const earliestYear = useMemo(() => {
    if (years.length === 0) return null
    return years[years.length - 1].year
  }, [years])

  const filterCount =
    (filters.event_type ? 1 : 0) +
    (filters.person_ids?.length || 0) +
    (filters.thread_ids?.length || 0)
  const isFiltered = filterCount > 0
  const handleFilterChange = (next) => {
    // Mark anchor as already restored so the new filter's page-1 doesn't
    // try to jump to a card that's no longer in the result set.
    anchorRestoredRef.current = true
    setStoreFilters(next)
    window.scrollTo(0, 0)
  }

  return (
    <div className="tl-page">
      <div className="tl-grid">
        <YearRail years={years} activeYear={activeYear} onJump={handleJumpToYear} />

        <main className="tl-feed">
          <header className="tl-feed-head">
            <div>
              <h1 className="tl-feed-title">Timeline.</h1>
              {!loading && (
                <p className="tl-feed-stats">
                  <span>{events.length.toLocaleString()}{hasMoreOlder || hasMoreNewer ? '+' : ''} {events.length === 1 ? 'event' : 'events'}</span>
                  {earliestYear && (
                    <>
                      <span className="sep" aria-hidden="true" />
                      <span>since {earliestYear}</span>
                    </>
                  )}
                  {threadCount > 0 && (
                    <>
                      <span className="sep" aria-hidden="true" />
                      <span>{threadCount} thread{threadCount === 1 ? '' : 's'}</span>
                    </>
                  )}
                  {isFiltered && (
                    <>
                      <span className="sep" aria-hidden="true" />
                      <span>filtered</span>
                    </>
                  )}
                </p>
              )}
            </div>
          </header>

          <TimelineToolbar
            filterCount={filterCount}
            onOpenFilters={() => setFilterOpen(true)}
            onAddEvent={() => navigate('/events/new')}
            onAiPhoto={() => aiPhotoInputRef.current?.click()}
            onPhotoEvent={() => photoInputRef.current?.click()}
            aiPhotoBusy={aiPhotoBusy}
            photoBusy={photoBusy}
          />
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handlePhotoPicked}
          />
          <input
            ref={aiPhotoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleAiPhotoPicked}
          />

          <div className="tl-stream">
            {loading ? (
              <div className="empty">loading…</div>
            ) : groups.length === 0 ? (
              <div className="empty">
                {isFiltered ? 'no events match — clear filters?' : 'nothing here yet — capture a moment'}
              </div>
            ) : (
              <>
                <div ref={topSentinelRef} className="timeline-sentinel top" aria-hidden="true" />
                {loadingNewer && <div className="empty">loading newer…</div>}
                {groups.map((yearGroup) =>
                  yearGroup.months.map((m) => (
                    <Fragment key={`${yearGroup.year}-${m.month}`}>
                      <div
                        className="tl-month"
                        data-year-marker={m.isFirstOfYear ? yearGroup.year : undefined}
                      >
                        <span className="m">{m.monthName}<em>.</em></span>
                        <span className="y">{yearGroup.year}</span>
                        <span className="rule" aria-hidden="true" />
                        <span className="count">{m.count} event{m.count === 1 ? '' : 's'}</span>
                      </div>
                      {m.days.map((day) => (
                        <div className="tl-day" key={`${yearGroup.year}-${m.month}-${day.day}`}>
                          <div className="tl-date">
                            <span className="d">{monthDayShort(day.sampleDate)}</span>
                            <span className="w">{weekdayShort(day.sampleDate)}</span>
                          </div>
                          <div className="tl-events">
                            {day.events.map((ev) => (
                              <EventCard key={ev._id} event={ev} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </Fragment>
                  )),
                )}
                <div ref={bottomSentinelRef} className="timeline-sentinel" aria-hidden="true" />
                {loadingMore && <div className="empty">loading more…</div>}
                {!hasMoreOlder && events.length > 0 && (
                  <div className="timeline-end">end of timeline</div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      <FilterModal
        open={filterOpen}
        filters={filters}
        people={people}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => handleFilterChange(next)}
      />
    </div>
  )
}
