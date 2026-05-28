import { useNavigate } from 'react-router-dom'
import { locationDisplay } from '../utils/location'
import { usePeopleStore, useThreadStore } from '../store'
import { personColor } from '../utils/colors'

const MAX_MEDIA = 4

function MapPin() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
      <path
        d="M6 1 C 8.5 1 10 3 10 5 C 10 7.5 6 11 6 11 C 6 11 2 7.5 2 5 C 2 3 3.5 1 6 1 Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="5" r="1.2" fill="currentColor" />
    </svg>
  )
}

export default function EventCard({ event }) {
  const navigate = useNavigate()
  const peopleById = usePeopleStore((s) => s.peopleById)
  const { threads, byId: threadsById } = useThreadStore()
  const showThreadLabel = threads.length > 1
  const thread = event.thread_id ? threadsById[event.thread_id] : null
  const isShared = event.is_owner === false
  const media = event.media ?? event.photos ?? []
  const shown = media.slice(0, MAX_MEDIA)
  const extra = Math.max(0, media.length - shown.length)

  const threadColor = thread ? personColor(thread.color) : null
  const cardStyle = threadColor ? { '--cat-color': threadColor } : undefined

  const location = locationDisplay(event.location)

  // Photo grid is always 4-col so every tile is the same size regardless
  // of how many photos the event has.
  const photoLayout = 'four'

  // Resolve people names from the appropriate source (denorm for shared,
  // local store for owned events).
  const peopleSource = isShared && event.people_display
    ? Object.fromEntries(event.people_display.map((p) => [p.id, p]))
    : peopleById
  const peopleList = (event.people ?? []).map((id) => peopleSource[id]).filter(Boolean)
  const peopleShown = peopleList.slice(0, 4)
  const peopleExtra = Math.max(0, peopleList.length - peopleShown.length)

  const open = () => navigate(`/events/${event._id}`)
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

  const showMetaRow = (showThreadLabel && thread) || isShared

  return (
    <article
      className={`event cat-color${shown.length === 1 ? ' photo-feature' : ''}`}
      data-event-id={event._id}
      data-event-date={event.date}
      style={cardStyle}
      onClick={open}
      onKeyDown={onKey}
      role="link"
      tabIndex={0}
    >
      {showMetaRow && (
        <div className="e-meta">
          {showThreadLabel && thread && (
            <>
              <span className="swatch" style={{ background: 'var(--cat-color)' }} aria-hidden="true" />
              <span>{thread.name}</span>
            </>
          )}
          {isShared && <span className="e-shared">shared</span>}
        </div>
      )}

      <h3 className="e-title">{event.title}</h3>

      {location && (
        <p className="e-location">
          <MapPin />
          {location}
        </p>
      )}

      {event.description && (
        <p className="e-desc">{event.description}</p>
      )}

      {shown.length > 0 && (
        <div className={`e-photos ${photoLayout}`}>
          {shown.map((m, i) => {
            const kind = m.kind || 'photo'
            const src = m.thumb_url || (kind === 'photo' ? m.url : null)
            const isLast = i === shown.length - 1
            return (
              <div
                key={m.key ?? i}
                className={`ph media-${kind}${src ? '' : ' placeholder'}`}
                style={src ? { backgroundImage: `url(${src})` } : undefined}
              >
                {!src && kind === 'audio' && <span aria-hidden="true">♪ audio</span>}
                {!src && kind === 'video' && <span aria-hidden="true">video</span>}
                {kind === 'video' && src && <span className="media-badge" aria-hidden="true">▶</span>}
                {isLast && extra > 0 && (
                  <div className="ph-more">+{extra}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {event.tags?.length > 0 && (
        <div className="e-tags">
          {event.tags.map((tag) => (
            <span key={tag} className="tag" title={tag}>#{tag}</span>
          ))}
        </div>
      )}

      {peopleShown.length > 0 && (
        <div className="e-people">
          {peopleShown.map((p) => (
            <span key={p._id || p.id} className="p">
              <span className="d" style={{ background: personColor(p.color) }} />
              {p.name}
            </span>
          ))}
          {peopleExtra > 0 && (
            <span className="p more">+ {peopleExtra} more</span>
          )}
        </div>
      )}
    </article>
  )
}
