import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listEvents } from '../api/events'
import { extractExif } from '../api/uploads'
import EventCard from '../components/EventCard'
import FilterBar from '../components/FilterBar'
import { setPendingPhoto } from '../lib/photoHandoff'
import { usePeopleStore } from '../store'
import { yearOf } from '../utils/date'

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

export default function TimelineView() {
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [filters, setFilters] = useState({ event_type: '', person_ids: [] })
  const [loading, setLoading] = useState(true)
  const [photoBusy, setPhotoBusy] = useState(false)
  const photoInputRef = useRef(null)
  const { people, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (filters.event_type) params.event_type = filters.event_type
    if (filters.person_ids?.length) params.person_id = filters.person_ids
    listEvents(params)
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filters])

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

  // The API returns events ascending by date; the redesign reads newest-first.
  const sorted = useMemo(
    () => [...events].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [events],
  )

  const groups = useMemo(() => {
    const out = []
    let current = null
    for (const ev of sorted) {
      const y = yearOf(ev.date)
      if (!current || current.year !== y) {
        current = { year: y, items: [] }
        out.push(current)
      }
      current.items.push(ev)
    }
    return out
  }, [sorted])

  const isFiltered = filters.event_type !== '' || (filters.person_ids?.length || 0) > 0
  const handleFilterChange = (change) => setFilters((f) => ({ ...f, ...change }))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Timeline</h1>
          {!loading && (
            <div className="page-sub">
              <span className="mono num">
                {String(sorted.length).padStart(2, '0')} {sorted.length === 1 ? 'event' : 'events'}
              </span>
              {isFiltered ? <span> · filtered</span> : null}
            </div>
          )}
        </div>
        <div className="page-head-actions">
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
          groups.map((g) => (
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
          ))
        )}
      </div>

    </div>
  )
}
