import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { getEvent, deleteEvent, attachPhoto, removePhoto } from '../api/events'
import { uploadPhoto } from '../api/uploads'
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

  const handlePhotosSelected = async (files) => {
    if (!files?.length) return
    for (const file of files) {
      try {
        const meta = await uploadPhoto(file)
        const updated = await attachPhoto(id, meta)
        setEvent(updated)
      } catch (err) {
        window.alert(`Failed to upload ${file.name}: ${err.message}`)
      }
    }
  }

  const handlePhotoDelete = async (key) => {
    if (!window.confirm('Remove this photo?')) return
    try {
      const updated = await removePhoto(id, key)
      setEvent(updated)
    } catch (err) {
      window.alert(`Failed to remove photo: ${err.message}`)
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

      <PhotoSection
        photos={event.photos || []}
        onSelect={handlePhotosSelected}
        onDelete={handlePhotoDelete}
        onOpen={setLightboxIndex}
      />

      {lightboxIndex !== null && event.photos?.[lightboxIndex] && (
        <Lightbox
          photos={event.photos}
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

function PhotoSection({ photos, onSelect, onDelete, onOpen }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

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
          Photos{photos.length > 0 ? ` · ${photos.length}` : ''}
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '+ Add photos'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={handleChange}
        />
      </div>
      {photos.length === 0 ? (
        <p className="detail-photos-empty">No photos yet.</p>
      ) : (
        <div className="detail-photos">
          {photos.map((p, i) => (
            <div key={p.key} className="detail-photo">
              {p.url ? (
                <button type="button" className="tile" onClick={() => onOpen(i)}>
                  <img src={p.url} alt="" loading="lazy" />
                </button>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--ink-mute)' }}>
                  Unavailable
                </div>
              )}
              <button
                type="button"
                className="delete"
                onClick={() => onDelete(p.key)}
                aria-label="Remove photo"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Lightbox({ photos, index, onClose, onChange }) {
  const count = photos.length
  const photo = photos[index]
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

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <img src={photo.url} alt="" onClick={(e) => e.stopPropagation()} />
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
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-next"
            onClick={(e) => { e.stopPropagation(); goNext() }}
            aria-label="Next photo"
          >
            ›
          </button>
          <div className="lightbox-count">{index + 1} / {count}</div>
        </>
      )}
    </div>
  )
}
