import { Link } from 'react-router-dom'
import { formatDateRange } from '../utils/date'
import { locationDisplay } from '../utils/location'
import { eventTypeStyles } from '../utils/eventTypes'
import { usePeopleStore } from '../store'
import PeopleChips from './PeopleChips'

const MAX_THUMBS = 4

export default function EventCard({ event }) {
  const peopleById = usePeopleStore((s) => s.peopleById)
  const t = eventTypeStyles(event.event_type)

  return (
    <Link to={`/events/${event._id}`} className="block group">
      <div className="flex items-baseline gap-2 mb-1">
        <span className={`text-[11px] font-medium tracking-wide uppercase ${t.label}`}>
          {event.event_type}
        </span>
        <span className="text-[11px] text-ink-faint num">
          · {formatDateRange(event.date, event.end_date)}
        </span>
      </div>

      <h3 className="text-[17px] font-semibold tracking-tightish text-ink leading-snug group-hover:text-accent transition-colors">
        {event.title}
      </h3>

      {locationDisplay(event.location) && (
        <p className="text-sm text-ink-mute mt-1">{locationDisplay(event.location)}</p>
      )}

      {event.description && (
        <p className="text-[15px] text-ink-soft mt-3 leading-relaxed line-clamp-3">
          {event.description}
        </p>
      )}

      {event.photos?.length > 0 && <PhotoStrip photos={event.photos} />}

      {(event.people?.length > 0 || event.tags?.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-4">
          {event.people?.length > 0 && (
            <PeopleChips peopleIds={event.people} peopleById={peopleById} />
          )}
          {event.tags?.map((tag) => (
            <span
              key={tag}
              className="text-[11px] text-ink-mute bg-surface ring-1 ring-ink-line px-2 py-0.5 rounded-full"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}

function PhotoStrip({ photos }) {
  const shown = photos.slice(0, MAX_THUMBS)
  const extra = photos.length - shown.length
  return (
    <div className="grid grid-cols-4 gap-1.5 mt-4 max-w-sm">
      {shown.map((p, i) => {
        const src = p.thumb_url || p.url
        if (!src) return null
        const isLast = i === shown.length - 1
        return (
          <div
            key={p.key}
            className="relative aspect-square rounded-md overflow-hidden ring-1 ring-ink-line bg-surface"
          >
            <img
              src={src}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
            {isLast && extra > 0 && (
              <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-xs font-semibold">
                +{extra}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
