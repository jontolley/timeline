import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { getEvent, deleteEvent, attachMedia, removeMedia } from '../api/events'
import { uploadMedia } from '../api/uploads'
import { formatDateRange, shortDate } from '../utils/date'
import { locationDisplay, locationMapUrl } from '../utils/location'
import { usePeopleStore } from '../store'
import PeopleChips from '../components/PeopleChips'
import { categoryClass } from '../utils/eventTypes'

async function geocodeLocation(loc) {
  const q = loc.address || loc.name
  if (!q) return loc
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } },
    )
    const data = await res.json()
    if (data[0]) {
      return { ...loc, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
    }
  } catch { /* leave coords null */ }
  return loc
}

export default function EventDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState(null)
  const [displayLocation, setDisplayLocation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const { peopleById, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  useEffect(() => {
    getEvent(id)
      .then(setEvent)
      .catch(() => setEvent(null))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!event) { setDisplayLocation(null); return }
    const loc = event.location
    if (!loc) { setDisplayLocation(null); return }
    if (loc.lat != null) { setDisplayLocation(loc); return }
    geocodeLocation(loc).then(setDisplayLocation)
  }, [event])

  const handleDelete = async () => {
    if (!window.confirm('Delete this event? This cannot be undone.')) return
    await deleteEvent(id)
    navigate('/')
  }

  const handleMediaSelected = async (files) => {
    if (!files?.length) return
    for (const file of files) {
      try {
        const meta = await uploadMedia(file)
        const updated = await attachMedia(id, meta)
        setEvent(updated)
      } catch (err) {
        window.alert(`Failed to upload ${file.name}: ${err.message}`)
      }
    }
  }

  const handleMediaDelete = async (key) => {
    if (!window.confirm('Remove this item?')) return
    try {
      const updated = await removeMedia(id, key)
      setEvent(updated)
    } catch (err) {
      window.alert(`Failed to remove: ${err.message}`)
    }
  }

  if (loading) return <div className="page-narrow"><p className="muted small">Loading…</p></div>
  if (!event) return <div className="page-narrow"><p className="form-error">Event not found.</p></div>

  const dateRange = formatDateRange(event.date, event.end_date)
  const location = locationDisplay(event.location)
  const mapUrl = locationMapUrl(event.location)
  const cls = categoryClass(event.event_type)

  return (
    <div className={`page-narrow ${cls}`}>
      <Link to="/" className="back-link">← Back to timeline</Link>

      <div className="event-meta" style={{ marginBottom: 8 }}>
        <span className="cat-tag">{event.event_type}</span>
        <span className="event-range">· {dateRange}</span>
      </div>
      <h1 className="page-title" style={{ fontSize: 44, marginBottom: 18 }}>
        {event.title}
      </h1>

      {location && (
        <p className="event-location" style={{ marginBottom: 16 }}>
          {mapUrl ? (
            <a href={mapUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
              {location}
            </a>
          ) : location}
          {displayLocation?.lat != null && (
            <span className="mono muted" style={{ marginLeft: 8 }}>
              ({displayLocation.lat.toFixed(5)}, {displayLocation.lng.toFixed(5)})
            </span>
          )}
        </p>
      )}

      {displayLocation?.lat != null && (
        <div className="location-map" style={{ height: 220, marginBottom: 24 }}>
          <MapContainer
            center={[displayLocation.lat, displayLocation.lng]}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
            dragging={false}
            zoomControl={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
            touchZoom={false}
            attributionControl={false}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[displayLocation.lat, displayLocation.lng]} />
          </MapContainer>
        </div>
      )}

      {event.description && (
        <p className="event-body" style={{ marginBottom: 24 }}>{event.description}</p>
      )}

      {event.people?.length > 0 && (
        <div className="event-people" style={{ marginBottom: 18 }}>
          <PeopleChips peopleIds={event.people} peopleById={peopleById} />
        </div>
      )}

      {event.tags?.length > 0 && (
        <div className="tag-list" style={{ marginBottom: 24 }}>
          {event.tags.map((tag) => (
            <span key={tag} className="tag">#{tag}</span>
          ))}
        </div>
      )}

      <MediaSection
        media={event.media || event.photos || []}
        onSelect={handleMediaSelected}
        onDelete={handleMediaDelete}
        onOpen={setLightboxIndex}
      />

      {lightboxIndex !== null && (
        <Lightbox
          items={(event.media || event.photos || []).filter((m) => (m.kind || 'photo') !== 'audio')}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onChange={setLightboxIndex}
        />
      )}

      <div className="divider" style={{ margin: '32px 0 20px' }} />
      <div className="form-actions">
        <Link to={`/events/${id}/edit`} className="btn btn-primary">Edit</Link>
        <button type="button" className="btn btn-danger" onClick={handleDelete}>Delete</button>
      </div>
    </div>
  )
}

// Include both MIME types AND extensions — some browsers (Safari especially)
// match only on extension for files like .m4a that report as audio/x-m4a.
const MEDIA_ACCEPT = [
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime',
  'audio/mpeg', 'audio/mp4',
  '.jpg', '.jpeg', '.png', '.webp',
  '.mp4', '.mov',
  '.mp3', '.m4a',
].join(',')

function MediaSection({ media, onSelect, onDelete, onOpen }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  const visual = media.filter((m) => (m.kind || 'photo') !== 'audio')
  const audio = media.filter((m) => m.kind === 'audio')

  const handleChange = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setUploading(true)
    try {
      await onSelect(files)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="photo-toolbar">
        <span className="label">
          Media{media.length > 0 ? ` · ${media.length}` : ''}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '+ Add media'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={MEDIA_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={handleChange}
        />
      </div>
      {media.length === 0 ? (
        <p className="detail-photos-empty">No media yet.</p>
      ) : (
        <>
          {visual.length > 0 && (
            <div className="detail-photos">
              {visual.map((m, i) => {
                const kind = m.kind || 'photo'
                const poster = m.thumb_url || (kind === 'photo' ? m.url : null)
                return (
                  <div key={m.key} className={`detail-photo media-${kind}`}>
                    {poster || kind === 'photo' ? (
                      <button type="button" className="tile" onClick={() => onOpen(i)}>
                        {poster ? <img src={poster} alt="" loading="lazy" /> : null}
                        {kind === 'video' && (
                          <span className="media-play" aria-hidden="true">▶</span>
                        )}
                      </button>
                    ) : (
                      <div className="media-fallback">Unavailable</div>
                    )}
                    <button
                      type="button"
                      className="delete"
                      onClick={() => onDelete(m.key)}
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {audio.length > 0 && (
            <div className="detail-audio-list">
              {audio.map((m) => (
                <div key={m.key} className="detail-audio-row">
                  <span className="media-badge audio" aria-hidden="true">♪</span>
                  {m.url ? (
                    <audio controls src={m.url} preload="metadata" />
                  ) : (
                    <span className="media-fallback">Unavailable</span>
                  )}
                  <button
                    type="button"
                    className="audio-remove"
                    onClick={() => onDelete(m.key)}
                    aria-label="Remove audio"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Lightbox({ items, index, onClose, onChange }) {
  const count = items.length
  const item = items[index]
  const kind = item?.kind || 'photo'
  const goPrev = () => onChange((index - 1 + count) % count)
  const goNext = () => onChange((index + 1) % count)

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [index, count]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      {kind === 'video' ? (
        <video
          key={item.key}
          src={item.url}
          poster={item.thumb_url || undefined}
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img src={item.url} alt="" onClick={(e) => e.stopPropagation()} />
      )}
      <button
        type="button"
        className="lightbox-close"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label="Close"
      >
        ✕
      </button>
      {count > 1 && (
        <>
          <button
            type="button"
            className="lightbox-prev"
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            aria-label="Previous"
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-next"
            onClick={(e) => { e.stopPropagation(); goNext() }}
            aria-label="Next"
          >
            ›
          </button>
          <div className="lightbox-count">{index + 1} / {count}</div>
        </>
      )}
    </div>
  )
}
