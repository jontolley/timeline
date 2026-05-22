import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listEvents } from '../api/events'
import { describePhoto, extractExif } from '../api/uploads'
import EventCard from '../components/EventCard'
import FilterBar from '../components/FilterBar'
import { setPendingCaption, setPendingPhoto } from '../lib/photoHandoff'
import { useEventStore, usePeopleStore } from '../store'
import { yearOf } from '../utils/date'

const PAGE_SIZE = 20

function buildListParams(filters, cursor) {
  const params = { limit: PAGE_SIZE }
  if (filters.event_type) params.event_type = filters.event_type
  if (filters.person_ids?.length) params.person_id = filters.person_ids
  if (cursor) {
    params.before_date = cursor.date
    params.before_id = cursor.id
  }
  return params
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <line x1="6.5" y1="1.5" x2="6.5" y2="11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="1.5" y1="6.5" x2="11.5" y2="6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function PhotoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 3.5 L6 2 L10 2 L11 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function SparkleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1 L9.2 6 L14 7.2 L9.2 8.4 L8 13.4 L6.8 8.4 L2 7.2 L6.8 6 Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M13 11 L13.6 12.8 L15.4 13.4 L13.6 14 L13 15.8 L12.4 14 L10.6 13.4 L12.4 12.8 Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}

export default function TimelineView() {
  const navigate = useNavigate()
  const {
    events,
    filters,
    hasMore,
    anchorId,
    loaded,
    setFilters: setStoreFilters,
    setInitialPage,
    appendPage,
    setAnchorId,
  } = useEventStore()
  const [loading, setLoading] = useState(!loaded)
  const [loadingMore, setLoadingMore] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [aiPhotoBusy, setAiPhotoBusy] = useState(false)
  const photoInputRef = useRef(null)
  const aiPhotoInputRef = useRef(null)
  const sentinelRef = useRef(null)
  // Guards loadMore from stale-state re-entry and from racing the initial load.
  const fetchingRef = useRef(false)
  // One-shot guard: restore anchor only on the first event-render after mount.
  const anchorRestoredRef = useRef(false)
  const { people, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()

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
    fetchingRef.current = true
    setLoading(true)
    listEvents(buildListParams(filters, null))
      .then((page) => {
        if (cancelled) return
        setInitialPage(page, page.length === PAGE_SIZE)
      })
      .catch(console.error)
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        fetchingRef.current = false
      })
    return () => { cancelled = true }
  }, [filters, loaded, setInitialPage])

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

  // Continuously track the topmost visible card while the user scrolls.
  // The cleanup-on-unmount approach fails because React removes the DOM
  // before the cleanup runs, so we save eagerly into the store instead.
  // Throttled with rAF so it costs ~one querySelector pass per frame.
  useEffect(() => {
    let rafId = null
    const update = () => {
      rafId = null
      const cards = document.querySelectorAll('[data-event-id]')
      for (const card of cards) {
        const top = card.getBoundingClientRect().top
        if (top >= -64) {
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

  const loadMore = useCallback(async () => {
    if (fetchingRef.current || loadingMore || !hasMore || events.length === 0) return
    fetchingRef.current = true
    setLoadingMore(true)
    const last = events[events.length - 1]
    try {
      const page = await listEvents(buildListParams(filters, { date: last.date, id: last._id }))
      appendPage(page, page.length === PAGE_SIZE)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingMore(false)
      fetchingRef.current = false
    }
  }, [events, filters, hasMore, loadingMore, appendPage])

  // IntersectionObserver pages the next batch when the sentinel scrolls into view.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasMore || loading) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore()
      },
      { rootMargin: '400px' }, // trigger a bit before the user actually hits the bottom
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore, hasMore, loading])

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
      window.alert(err.message || 'Could not read photo')
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
      window.alert(err.message || 'Could not read photo')
    } finally {
      setAiPhotoBusy(false)
    }
  }

  // The API returns events newest-first when paginated, so no client-side sort.
  const groups = useMemo(() => {
    const out = []
    let current = null
    for (const ev of events) {
      const y = yearOf(ev.date)
      if (!current || current.year !== y) {
        current = { year: y, items: [] }
        out.push(current)
      }
      current.items.push(ev)
    }
    return out
  }, [events])

  const isFiltered = filters.event_type !== '' || (filters.person_ids?.length || 0) > 0
  const handleFilterChange = (change) => {
    // Mark anchor as already restored so the new filter's page-1 doesn't
    // try to jump to a card that's no longer in the result set.
    anchorRestoredRef.current = true
    setStoreFilters(change)
    window.scrollTo(0, 0)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Timeline</h1>
          {!loading && (
            <div className="page-sub">
              <span className="mono num">
                {String(events.length).padStart(2, '0')}
                {hasMore ? '+' : ''}{' '}
                {events.length === 1 ? 'event' : 'events'}
              </span>
              {isFiltered ? <span> · filtered</span> : null}
            </div>
          )}
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn"
            onClick={() => aiPhotoInputRef.current?.click()}
            disabled={aiPhotoBusy}
          >
            <SparkleIcon />
            {aiPhotoBusy ? 'Reading…' : 'Photo with AI captions'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => photoInputRef.current?.click()}
            disabled={photoBusy}
          >
            <PhotoIcon />
            {photoBusy ? 'Reading…' : 'Event from photo'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/events/new')}
          >
            <PlusIcon />
            Add event
          </button>
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
        </div>
      </div>

      <FilterBar filters={filters} people={people} onChange={handleFilterChange} />

      <div className="timeline">
        {loading ? (
          <div className="empty">loading…</div>
        ) : groups.length === 0 ? (
          <div className="empty">
            {isFiltered ? 'no events match — clear filters?' : 'nothing here yet — capture a moment'}
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.year}>
                <div className="year-marker">
                  <span className="year">
                    <strong>{g.year}</strong>
                  </span>
                </div>
                {g.items.map((ev) => (
                  <EventCard key={ev._id} event={ev} />
                ))}
              </div>
            ))}
            <div ref={sentinelRef} className="timeline-sentinel" aria-hidden="true" />
            {loadingMore && <div className="empty">loading more…</div>}
            {!hasMore && events.length > 0 && (
              <div className="timeline-end">end of timeline</div>
            )}
          </>
        )}
      </div>

    </div>
  )
}
