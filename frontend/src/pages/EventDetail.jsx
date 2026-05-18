import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { getEvent, deleteEvent, attachPhoto, removePhoto } from '../api/events'
import { uploadPhoto } from '../api/uploads'
import { formatDateRange } from '../utils/date'
import { locationDisplay, locationMapUrl } from '../utils/location'
import { usePeopleStore } from '../store'
import PeopleChips from '../components/PeopleChips'
import { eventTypeStyles } from '../utils/eventTypes'

async function geocodeLocation(loc) {
  const q = loc.address || loc.name
  if (!q) return loc
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
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

  if (loading) return <p className="text-ink-faint py-12 text-center">Loading…</p>
  if (!event) return <p className="text-rose-600 py-12 text-center">Event not found.</p>

  const dateRange = formatDateRange(event.date, event.end_date)
  const t = eventTypeStyles(event.event_type)

  return (
    <div>
      <Link to="/" className="text-ink-mute hover:text-ink text-sm mb-4 inline-block">
        &larr; Back to Timeline
      </Link>
      <div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className={`text-[11px] font-medium tracking-wide uppercase ${t.label}`}>
            {event.event_type}
          </span>
          <span className="text-[11px] text-ink-faint num">· {dateRange}</span>
        </div>
        <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tighter2 leading-tight text-ink mb-4">
          {event.title}
        </h1>
        {locationDisplay(event.location) && (
          <p className="text-sm text-ink-mute mb-3">
            {locationMapUrl(event.location) ? (
              <a
                href={locationMapUrl(event.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {locationDisplay(event.location)}
              </a>
            ) : (
              locationDisplay(event.location)
            )}
            {displayLocation?.lat != null && (
              <span className="ml-2 text-xs text-ink-faint font-mono num">
                ({displayLocation.lat.toFixed(5)}, {displayLocation.lng.toFixed(5)})
              </span>
            )}
          </p>
        )}
        {displayLocation?.lat != null && (
          <div className="rounded-lg overflow-hidden ring-1 ring-ink-line mb-5" style={{ height: 200 }}>
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
          <p className="text-[15px] text-ink-soft mb-5 leading-relaxed whitespace-pre-wrap">{event.description}</p>
        )}
        {event.people?.length > 0 && (
          <div className="mb-4">
            <PeopleChips peopleIds={event.people} peopleById={peopleById} size="md" />
          </div>
        )}
        {event.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {event.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] text-ink-mute bg-surface ring-1 ring-ink-line px-2 py-0.5 rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
        <PhotoSection
          photos={event.photos || []}
          onSelect={handlePhotosSelected}
          onDelete={handlePhotoDelete}
        />
        <div className="flex gap-3 pt-6 border-t border-ink-line">
          <Link
            to={`/events/${id}/edit`}
            className="px-4 py-2 bg-ink text-paper rounded-md text-sm font-medium hover:bg-ink-soft transition-colors"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-paper text-rose-600 ring-1 ring-rose-200 rounded-md text-sm font-medium hover:bg-rose-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

function PhotoSection({ photos, onSelect, onDelete }) {
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
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-ink-soft">
          Photos {photos.length > 0 && <span className="text-ink-faint">({photos.length})</span>}
        </h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-3 py-1.5 bg-white border border-ink-line text-ink-soft rounded-md hover:bg-surface disabled:opacity-50 transition-colors"
        >
          {uploading ? 'Uploading…' : '+ Add photos'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={handleChange}
        />
      </div>
      {photos.length === 0 ? (
        <p className="text-xs text-ink-faint italic">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.key} className="relative group aspect-square overflow-hidden rounded-md border border-ink-line bg-surface">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={p.url}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover hover:opacity-90 transition-opacity"
                  />
                </a>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-ink-faint">
                  Unavailable
                </div>
              )}
              <button
                type="button"
                onClick={() => onDelete(p.key)}
                title="Remove photo"
                className="absolute top-1 right-1 bg-white/90 text-rose-600 rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
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
