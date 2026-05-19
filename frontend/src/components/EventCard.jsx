import { Link } from 'react-router-dom'
import { shortDate, formatRangeCompact } from '../utils/date'
import { locationDisplay } from '../utils/location'
import { categoryClass } from '../utils/eventTypes'
import { usePeopleStore } from '../store'
import PeopleChips from './PeopleChips'

const MAX_PHOTOS = 4

export default function EventCard({ event }) {
  const peopleById = usePeopleStore((s) => s.peopleById)
  const photos = event.photos ?? []
  const shown = photos.slice(0, MAX_PHOTOS)
  const extra = Math.max(0, photos.length - shown.length)
  const cls = categoryClass(event.event_type)
  const location = locationDisplay(event.location)

  return (
    <article className={`event ${cls}`}>
      <span className="event-node" aria-hidden="true" />
      <div className="event-date-stub">
        <strong>{shortDate(event.date)}</strong>
        {event.end_date ? <span>{shortDate(event.end_date)}</span> : null}
      </div>

      <Link to={`/events/${event._id}`} className="card">
        <div className="event-meta">
          <span className="cat-tag">{event.event_type}</span>
          <span className="event-range">
            · {formatRangeCompact(event.date, event.end_date)}
          </span>
        </div>

        <h3 className="event-title">{event.title}</h3>

        {location && <div className="event-location">{location}</div>}

        {event.description && (
          <p className="event-body">{event.description}</p>
        )}

        {shown.length > 0 && (
          <div className="event-photos">
            {shown.map((p, i) => {
              const src = p.thumb_url || p.url
              const isLast = i === shown.length - 1
              return (
                <div key={p.key ?? i} className="photo">
                  {src ? <img src={src} alt="" loading="lazy" /> : null}
                  {isLast && extra > 0 && (
                    <div className="photo-more">+{extra}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {event.people?.length > 0 && (
          <div className="event-people">
            <PeopleChips peopleIds={event.people} peopleById={peopleById} />
          </div>
        )}
      </Link>
    </article>
  )
}
