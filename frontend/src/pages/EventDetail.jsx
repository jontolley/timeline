import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { getEvent, deleteEvent, attachPhoto, removePhoto } from '../api/events'
import { uploadPhoto } from '../api/uploads'
import { formatDateRange } from '../utils/date'
import { locationDisplay, locationMapUrl } from '../utils/location'
import { usePeopleStore } from '../store'
import PeopleChips from '../components/PeopleChips'

const TYPE_STYLES = {
  career: 'bg-blue-100 text-blue-700',
  travel: 'bg-green-100 text-green-700',
  milestone: 'bg-purple-100 text-purple-700',
  family: 'bg-orange-100 text-orange-700',
}

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

  if (loading) return <p className="text-gray-400 py-12 text-center">Loading...</p>
  if (!event) return <p className="text-red-500 py-12 text-center">Event not found.</p>

  const dateRange = formatDateRange(event.date, event.end_date)

  return (
    <div className="max-w-2xl">
      <Link to="/" className="text-blue-600 hover:underline text-sm mb-4 block">
        &larr; Back to Timeline
      </Link>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
          <span
            className={`text-sm font-medium px-3 py-1 rounded-full shrink-0 ${
              TYPE_STYLES[event.event_type] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {event.event_type}
          </span>
        </div>
        <p className="text-gray-500 mb-2">{dateRange}</p>
        {locationDisplay(event.location) && (
          <p className="text-gray-600 mb-3">
            &#128205;{' '}
            {locationMapUrl(event.location) ? (
              <a
                href={locationMapUrl(event.location)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline text-blue-600"
              >
                {locationDisplay(event.location)}
              </a>
            ) : (
              locationDisplay(event.location)
            )}
            {displayLocation?.lat != null && (
              <span className="ml-2 text-xs text-gray-400 font-mono">
                ({displayLocation.lat.toFixed(5)}, {displayLocation.lng.toFixed(5)})
              </span>
            )}
          </p>
        )}
        {displayLocation?.lat != null && (
          <div className="rounded-lg overflow-hidden border border-gray-200 mb-4" style={{ height: 200 }}>
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
          <p className="text-gray-700 mb-4 leading-relaxed">{event.description}</p>
        )}
        {event.people?.length > 0 && (
          <div className="mb-4">
            <PeopleChips peopleIds={event.people} peopleById={peopleById} size="md" />
          </div>
        )}
        {event.tags?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {event.tags.map((tag) => (
              <span
                key={tag}
                className="text-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
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
        <div className="flex gap-3 pt-2 border-t border-gray-100">
          <Link
            to={`/events/${id}/edit`}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Edit
          </Link>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-md text-sm font-medium hover:bg-red-100 transition-colors"
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
        <h2 className="text-sm font-medium text-gray-700">
          Photos {photos.length > 0 && <span className="text-gray-400">({photos.length})</span>}
        </h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
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
        <p className="text-xs text-gray-400 italic">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            <div key={p.key} className="relative group aspect-square overflow-hidden rounded-md border border-gray-200 bg-gray-50">
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
                <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                  Unavailable
                </div>
              )}
              <button
                type="button"
                onClick={() => onDelete(p.key)}
                title="Remove photo"
                className="absolute top-1 right-1 bg-white/90 text-red-600 rounded-full w-6 h-6 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity shadow"
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
