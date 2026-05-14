import { Link } from 'react-router-dom'
import { hasTime, formatDate, formatTime } from '../utils/date'

const TYPE_STYLES = {
  career: 'bg-blue-100 text-blue-700',
  travel: 'bg-green-100 text-green-700',
  milestone: 'bg-purple-100 text-purple-700',
  family: 'bg-orange-100 text-orange-700',
}

export default function EventCard({ event }) {
  const dateStr = formatDate(event.date)
  const timeStr = hasTime(event.date) ? formatTime(event.date) : null

  return (
    <Link to={`/events/${event._id}`} className="block group">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 group-hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {event.title}
          </h3>
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${
              TYPE_STYLES[event.event_type] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {event.event_type}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          {dateStr}{timeStr && <span className="ml-1 text-gray-400">at {timeStr}</span>}
        </p>
        {event.location && (
          <p className="text-sm text-gray-600 mt-1">&#128205; {event.location}</p>
        )}
        {event.description && (
          <p className="text-sm text-gray-600 mt-2 line-clamp-2">{event.description}</p>
        )}
        {event.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {event.tags.map((tag) => (
              <span
                key={tag}
                className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}
