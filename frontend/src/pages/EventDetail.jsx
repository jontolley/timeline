import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getEvent, deleteEvent } from '../api/events'
import { hasTime, formatDate, formatTime } from '../utils/date'
import { locationDisplay, locationMapUrl } from '../utils/location'

const TYPE_STYLES = {
  career: 'bg-blue-100 text-blue-700',
  travel: 'bg-green-100 text-green-700',
  milestone: 'bg-purple-100 text-purple-700',
  family: 'bg-orange-100 text-orange-700',
}

export default function EventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getEvent(id)
      .then(setEvent)
      .catch(() => setEvent(null))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    if (!window.confirm('Delete this event? This cannot be undone.')) return
    await deleteEvent(id)
    navigate('/')
  }

  if (loading) return <p className="text-gray-400 py-12 text-center">Loading...</p>
  if (!event) return <p className="text-red-500 py-12 text-center">Event not found.</p>

  const dateStr = formatDate(event.date)
  const timeStr = hasTime(event.date) ? formatTime(event.date) : null

  return (
    <div className="max-w-2xl">
      <Link to="/" className="text-blue-600 hover:underline text-sm mb-4 block">
        &larr; Back to Timeline
      </Link>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
          <span
            className={`text-sm font-medium px-3 py-1 rounded-full shrink-0 ${
              TYPE_STYLES[event.event_type] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {event.event_type}
          </span>
        </div>
        <p className="text-gray-500 mb-2">
          {dateStr}{timeStr && <span className="ml-1 text-gray-400">at {timeStr}</span>}
        </p>
        {locationDisplay(event.location) && (
          <p className="text-gray-600 mb-3">
            &#128205;{' '}
            {locationMapUrl(event.location) ? (
              <a
                href={locationMapUrl(event.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-blue-600"
              >
                {locationDisplay(event.location)}
              </a>
            ) : (
              locationDisplay(event.location)
            )}
            {event.location?.lat != null && (
              <span className="ml-2 text-xs text-gray-400 font-mono">
                ({event.location.lat.toFixed(5)}, {event.location.lng.toFixed(5)})
              </span>
            )}
          </p>
        )}
        {event.description && (
          <p className="text-gray-700 mb-4 leading-relaxed">{event.description}</p>
        )}
        {event.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {event.tags.map((tag) => (
              <span
                key={tag}
                className="text-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-3 pt-2 border-t border-gray-100">
          <Link
            to={`/events/${id}/edit`}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-md text-sm font-medium hover:bg-red-100 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
