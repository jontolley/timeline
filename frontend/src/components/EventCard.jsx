import { Link } from 'react-router-dom'
import { formatDateRange } from '../utils/date'
import { locationDisplay } from '../utils/location'
import { usePeopleStore } from '../store'
import PeopleChips from './PeopleChips'

const TYPE_STYLES = {
  career: 'bg-blue-100 text-blue-700',
  travel: 'bg-green-100 text-green-700',
  milestone: 'bg-purple-100 text-purple-700',
  family: 'bg-orange-100 text-orange-700',
}

const MAX_THUMBS = 4

export default function EventCard({ event }) {
  const peopleById = usePeopleStore((s) => s.peopleById)
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
          {formatDateRange(event.date, event.end_date)}
        </p>
        {locationDisplay(event.location) && (
          <p className="text-sm text-gray-600 mt-1">&#128205; {locationDisplay(event.location)}</p>
        )}
        {event.description && (
          <p className="text-sm text-gray-600 mt-2 line-clamp-2">{event.description}</p>
        )}
        {event.people?.length > 0 && (
          <div className="mt-2">
            <PeopleChips peopleIds={event.people} peopleById={peopleById} />
          </div>
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
        {event.photos?.length > 0 && <PhotoStrip photos={event.photos} />}
      </div>
    </Link>
  )
}

function PhotoStrip({ photos }) {
  const shown = photos.slice(0, MAX_THUMBS)
  const extra = photos.length - shown.length
  return (
    <div className="flex gap-1.5 mt-3">
      {shown.map((p, i) => {
        const src = p.thumb_url || p.url
        if (!src) return null
        const isLast = i === shown.length - 1
        return (
          <div
            key={p.key}
            className="relative w-14 h-14 rounded-md overflow-hidden border border-gray-200 bg-gray-50 shrink-0"
          >
            <img
              src={src}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
            {isLast && extra > 0 && (
              <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-semibold">
                +{extra}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
