import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import { Document, Page } from 'react-pdf'
import { getEvent, deleteEvent, attachMedia, removeMedia } from '../api/events'
import { uploadMedia } from '../api/uploads'
import { formatDateRange, shortDate } from '../utils/date'
import { locationDisplay, locationMapUrl } from '../utils/location'
import { useEventStore, usePeopleStore, useThreadStore } from '../store'
import AddMediaButton from '../components/AddMediaButton'
import PeopleChips from '../components/PeopleChips'
import { personColor } from '../utils/colors'
import { useAlert, useConfirm } from '../lib/confirm'
import '../lib/pdfjs'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

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
  const { threads, byId: threadsById } = useThreadStore()
  const confirm = useConfirm()
  const alert = useAlert()

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
    const ok = await confirm({
      title: 'Delete this event?',
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await deleteEvent(id)
    useEventStore.getState().invalidate()
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
        await alert({ title: `Upload failed: ${file.name}`, body: err.message })
      }
    }
  }

  const handleMediaDelete = async (key) => {
    const ok = await confirm({
      title: 'Remove this item?',
      body: 'The file will be deleted from your timeline.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      const updated = await removeMedia(id, key)
      setEvent(updated)
    } catch (err) {
      await alert({ title: 'Removal failed', body: err.message })
    }
  }

  if (loading) return <div className="page-narrow"><p className="muted small">Loading…</p></div>
  if (!event) return <div className="page-narrow"><p className="form-error">Event not found.</p></div>

  const dateRange = formatDateRange(event.date, event.end_date)
  const location = locationDisplay(event.location)
  const mapUrl = locationMapUrl(event.location)
  const isShared = event.is_owner === false
  const showThreadLabel = threads.length > 1
  const thread = event.thread_id ? threadsById[event.thread_id] : null
  const threadColor = thread ? personColor(thread.color) : null
  const pageStyle = threadColor ? { '--cat-color': threadColor } : undefined

  return (
    <div className="page-narrow cat-color" style={pageStyle}>
      <Link to="/" className="back-link">← Back to timeline</Link>

      <div className="event-meta" style={{ marginBottom: 8 }}>
        {showThreadLabel && thread && (
          <span className="cat-tag">{thread.name}</span>
        )}
        <span className="event-range">{showThreadLabel && thread ? '· ' : ''}{dateRange}</span>
        {isShared && <span className="shared-event-banner">shared (read-only)</span>}
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

      {event.description && (
        <p className="event-body" style={{ marginBottom: 24 }}>{event.description}</p>
      )}

      {event.people?.length > 0 && (
        <div className="event-people" style={{ marginBottom: 18 }}>
          <PeopleChips
            peopleIds={event.people}
            peopleById={
              isShared && event.people_display
                ? Object.fromEntries(event.people_display.map((p) => [p.id, p]))
                : peopleById
            }
          />
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
        readOnly={isShared}
      />

      {lightboxIndex !== null && (
        <Lightbox
          items={(event.media || event.photos || []).filter((m) => {
            const k = m.kind || 'photo'
            return k !== 'audio' && k !== 'pdf'
          })}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onChange={setLightboxIndex}
        />
      )}

      {displayLocation?.lat != null && (
        <div className="location-map" style={{ height: 220, marginTop: 24 }}>
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

      {!isShared && (
        <>
          <div className="divider" style={{ margin: '32px 0 20px' }} />
          <div className="form-actions">
            <Link to={`/events/${id}/edit`} className="btn btn-primary">Edit</Link>
            <button type="button" className="btn btn-danger" onClick={handleDelete}>Delete</button>
          </div>
        </>
      )}
    </div>
  )
}

function MediaSection({ media, onSelect, onDelete, onOpen, readOnly = false }) {
  const [uploading, setUploading] = useState(false)

  const visual = media.filter((m) => {
    const k = m.kind || 'photo'
    return k !== 'audio' && k !== 'pdf'
  })
  const audio = media.filter((m) => m.kind === 'audio')
  const pdfs = media.filter((m) => m.kind === 'pdf')

  const handleFiles = async (files) => {
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
        {!readOnly && <AddMediaButton onFiles={handleFiles} busy={uploading} />}
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
                    {!readOnly && (
                      <button
                        type="button"
                        className="delete"
                        onClick={() => onDelete(m.key)}
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    )}
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
                  {!readOnly && (
                    <button
                      type="button"
                      className="audio-remove"
                      onClick={() => onDelete(m.key)}
                      aria-label="Remove audio"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {pdfs.length > 0 && (
            <div className="detail-pdf-list">
              {pdfs.map((m) => (
                <PdfViewer
                  key={m.key}
                  item={m}
                  onDelete={readOnly ? null : () => onDelete(m.key)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PdfViewer({ item, onDelete }) {
  const containerRef = useRef(null)
  const [numPages, setNumPages] = useState(item.page_count || null)
  const [pageNumber, setPageNumber] = useState(1)
  const [width, setWidth] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setWidth(Math.floor(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const goPrev = () => setPageNumber((n) => Math.max(1, n - 1))
  const goNext = () => setPageNumber((n) => Math.min(numPages || n, n + 1))
  const total = numPages || item.page_count || '?'

  if (!item.url) {
    return (
      <div className="detail-pdf-row">
        <span className="media-fallback">PDF unavailable</span>
      </div>
    )
  }

  return (
    <div className="detail-pdf-row">
      <div className="detail-pdf-toolbar">
        <span className="media-badge pdf static" aria-hidden="true">PDF</span>
        <div className="detail-pdf-pager">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={goPrev}
            disabled={pageNumber <= 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="detail-pdf-pagenum mono">
            {pageNumber} / {total}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={goNext}
            disabled={!!numPages && pageNumber >= numPages}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
        <div className="detail-pdf-actions">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost"
            title="Open in new tab"
          >
            ↗
          </a>
          {onDelete && (
            <button
              type="button"
              className="audio-remove"
              onClick={onDelete}
              aria-label="Remove PDF"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="detail-pdf-canvas" ref={containerRef}>
        {error ? (
          <span className="media-fallback">{error}</span>
        ) : (
          <Document
            file={item.url}
            onLoadSuccess={({ numPages: n }) => {
              setNumPages(n)
              setError(null)
            }}
            onLoadError={() => setError('Could not load PDF')}
            loading={<span className="muted small">Loading PDF…</span>}
          >
            {width > 0 && (
              <Page
                pageNumber={pageNumber}
                width={width}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
            )}
          </Document>
        )}
      </div>
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
