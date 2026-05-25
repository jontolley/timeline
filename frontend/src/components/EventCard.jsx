import { useNavigate } from 'react-router-dom'
import { hasTime, formatTime } from '../utils/date'
import { locationDisplay } from '../utils/location'
import { categoryClass, categoryLabel, categoryStyle } from '../utils/eventTypes'
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

/** Short descriptor that sits next to the category in the meta row. */
function deriveTypeLabel(event) {
  if (event.end_date) {
    const start = new Date(event.date)
    const end = new Date(event.end_date)
    const days = Math.max(1, Math.round((end - start) / 86400000) + 1)
    return `trip · ${days} day${days === 1 ? '' : 's'}`
  }
  const media = event.media ?? event.photos ?? []
  if (media.some((m) => (m.kind || 'photo') === 'photo')) return 'photo'
  if (media.some((m) => m.kind === 'video')) return 'video'
  if (media.some((m) => m.kind === 'audio')) return 'audio'
  if (hasTime(event.date)) return formatTime(event.date)
  return 'note'
}

export default function EventCard({ event }) {
  const navigate = useNavigate()
  const peopleById = usePeopleStore((s) => s.peopleById)
  const { threads, byId: threadsById } = useThreadStore()
  const showThreadChip = threads.length > 1
  const thread = event.thread_id ? threadsById[event.thread_id] : null
  const isShared = event.is_owner === false
  const media = event.media ?? event.photos ?? []
  const shown = media.slice(0, MAX_MEDIA)
  const extra = Math.max(0, media.length - shown.length)

  // For shared events, use the denormalized category info from the backend so
  // we render the owner's color/label without needing their category store.
  const denormCat = event.category_display
  const cls = isShared && denormCat ? 'cat-color' : categoryClass(event.event_type)
  const catStyle = isShared && denormCat
    ? { '--cat-color': personColor(denormCat.color) }
    : categoryStyle(event.event_type)
  const catTagText = isShared && denormCat
    ? denormCat.label
    : (categoryLabel(event.event_type) || event.event_type)

  const location = locationDisplay(event.location)
  const typeLabel = deriveTypeLabel(event)

  // Photo grid layout class: 1 photo → big 16:9, 3 photos → 3-col, otherwise 4.
  const photoLayout = shown.length === 1 ? 'one' : shown.length === 3 ? 'three' : 'four'

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

  return (
    <article
      className={`event ${cls}${shown.length === 1 ? ' photo-feature' : ''}`}
      data-event-id={event._id}
      data-event-date={event.date}
      style={catStyle}
      onClick={open}
      onKeyDown={onKey}
      role="link"
      tabIndex={0}
    >
      <div className="e-meta">
        <span className="swatch" style={{ background: 'var(--cat-color)' }} aria-hidden="true" />
        <span>{catTagText}</span>
        <span className="sep" aria-hidden="true" />
        <span>{typeLabel}</span>
        {isShared && <span className="e-shared">shared</span>}
        {showThreadChip && thread && (
          <span className="thread-pill" style={{ '--thread-color': personColor(thread.color) }}>
            <span className="dot" />
            {thread.name}
          </span>
        )}
      </div>

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
