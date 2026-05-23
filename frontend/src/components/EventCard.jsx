import { Link } from 'react-router-dom'
import { shortDate, formatRangeCompact } from '../utils/date'
import { locationDisplay } from '../utils/location'
import { categoryClass, categoryLabel, categoryStyle } from '../utils/eventTypes'
import { usePeopleStore, useThreadStore } from '../store'
import { personColor } from '../utils/colors'
import PeopleChips from './PeopleChips'

const MAX_MEDIA = 4

export default function EventCard({ event }) {
  const peopleById = usePeopleStore((s) => s.peopleById)
  const { threads, byId: threadsById } = useThreadStore()
  const showThreadChip = threads.length > 1
  const thread = event.thread_id ? threadsById[event.thread_id] : null
  const media = event.media ?? event.photos ?? []
  const shown = media.slice(0, MAX_MEDIA)
  const extra = Math.max(0, media.length - shown.length)
  const cls = categoryClass(event.event_type)
  const catStyle = categoryStyle(event.event_type)
  const location = locationDisplay(event.location)

  return (
    <article className={`event ${cls}`} data-event-id={event._id} style={catStyle}>
      <span className="event-node" aria-hidden="true" />
      <div className="event-date-stub">
        <strong>{shortDate(event.date)}</strong>
        {event.end_date ? <span>{shortDate(event.end_date)}</span> : null}
      </div>

      <Link to={`/events/${event._id}`} className="card">
        <div className="event-meta">
          <span className="cat-tag">{categoryLabel(event.event_type) || event.event_type}</span>
          <span className="event-range">
            · {formatRangeCompact(event.date, event.end_date)}
          </span>
          {showThreadChip && thread && (
            <span
              className="thread-chip"
              style={{ '--thread-color': personColor(thread.color) }}
            >
              <span className="thread-dot" />
              {thread.name}
            </span>
          )}
        </div>

        <h3 className="event-title">{event.title}</h3>

        {location && <div className="event-location">{location}</div>}

        {event.description && (
          <p className="event-body">{event.description}</p>
        )}

        {shown.length > 0 && (
          <div className="event-photos">
            {shown.map((m, i) => {
              const kind = m.kind || 'photo'
              const src = m.thumb_url || (kind === 'photo' ? m.url : null)
              const isLast = i === shown.length - 1
              return (
                <div key={m.key ?? i} className={`photo media-tile media-${kind}`}>
                  {src ? (
                    <img src={src} alt="" loading="lazy" />
                  ) : kind === 'audio' ? (
                    <span className="audio-placeholder-icon" aria-hidden="true">♪</span>
                  ) : null}
                  {kind === 'video' && src && <span className="media-badge" aria-hidden="true">▶</span>}
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
