import { useEffect, useMemo, useState } from 'react'
import { listEvents } from '../api/events'
import EventCard from '../components/EventCard'
import FilterBar from '../components/FilterBar'
import QuickCapture from '../components/QuickCapture'
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

export default function TimelineView() {
  const [events, setEvents] = useState([])
  const [filters, setFilters] = useState({ event_type: '', person_ids: [] })
  const [loading, setLoading] = useState(true)
  const [quickOpen, setQuickOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
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
  }, [filters, reloadKey])

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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setQuickOpen(true)}
        >
          <PlusIcon />
          Add event
        </button>
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

      <QuickCapture
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </div>
  )
}
