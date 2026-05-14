import { useEffect, useState } from 'react'
import { listEvents } from '../api/events'
import EventCard from '../components/EventCard'
import FilterBar from '../components/FilterBar'

export default function TimelineView() {
  const [events, setEvents] = useState([])
  const [filters, setFilters] = useState({ event_type: '', tag: '' })
  const [loading, setLoading] = useState(true)

  const allTags = [...new Set(events.flatMap((e) => e.tags ?? []))]

  useEffect(() => {
    setLoading(true)
    const params = {}
    if (filters.event_type) params.event_type = filters.event_type
    if (filters.tag) params.tag = filters.tag
    listEvents(params)
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filters])

  const handleFilterChange = (change) =>
    setFilters((f) => ({ ...f, ...change }))

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Timeline</h1>
      <FilterBar filters={filters} tags={allTags} onChange={handleFilterChange} />

      {loading ? (
        <p className="text-gray-400 text-center py-12">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-gray-400 text-center py-12">No events found.</p>
      ) : (
        <div className="relative">
          <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200" />
          <div className="space-y-6 pl-10">
            {events.map((event) => (
              <div key={event._id} className="relative">
                <div className="absolute -left-7 top-4 w-3 h-3 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
                <EventCard event={event} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
