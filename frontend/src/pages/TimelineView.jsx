import { useEffect, useState } from 'react'
import { listEvents } from '../api/events'
import EventCard from '../components/EventCard'
import FilterBar from '../components/FilterBar'
import { eventTypeStyles } from '../utils/eventTypes'
import { usePeopleStore } from '../store'

export default function TimelineView() {
  const [events, setEvents] = useState([])
  const [filters, setFilters] = useState({ event_type: '', tag: '', person_ids: [] })
  const [loading, setLoading] = useState(true)
  const { people, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()

  const allTags = [...new Set(events.flatMap((e) => e.tags ?? []))]

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (filters.event_type) params.event_type = filters.event_type
    if (filters.tag) params.tag = filters.tag
    if (filters.person_ids?.length) params.person_id = filters.person_ids
    listEvents(params)
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filters])

  const handleFilterChange = (change) =>
    setFilters((f) => ({ ...f, ...change }))

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tighter2 leading-none text-ink">
          Timeline
        </h1>
        {!loading && events.length > 0 && (
          <p className="text-sm text-ink-mute mt-2 num">
            {events.length} {events.length === 1 ? 'event' : 'events'}
          </p>
        )}
      </div>

      <FilterBar filters={filters} tags={allTags} people={people} onChange={handleFilterChange} />

      {loading ? (
        <p className="text-ink-faint text-center py-12">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-ink-faint text-center py-12">No events found.</p>
      ) : (
        <ol className="relative">
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-ink-line" />
          {events.map((event) => {
            const t = eventTypeStyles(event.event_type)
            return (
              <li key={event._id} className="relative pl-8 pb-8 last:pb-2">
                <span
                  className={`absolute left-0 top-[10px] w-[15px] h-[15px] rounded-full bg-paper ring-2 ${t.ring}`}
                />
                <EventCard event={event} />
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
