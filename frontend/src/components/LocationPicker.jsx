import { useState, useEffect, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'

const DEFAULT_CENTER = [37.7749, -122.4194]

export default function LocationPicker({ value, onChange }) {
  return <LocationPickerInner value={value} onChange={onChange} />
}

function LocationPickerInner({ value, onChange }) {
  const [showMap, setShowMap] = useState(false)
  const [query, setQuery] = useState(value?.address || value?.name || '')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef(null)
  const autoGeocodedRef = useRef(false)

  useEffect(() => {
    setQuery(value?.address || value?.name || '')
  }, [value?.address, value?.name])

  useEffect(() => {
    if (autoGeocodedRef.current) return
    if (!value) return
    const hasCoords = value.lat != null && value.lng != null
    const hasText = !!(value.name || value.address)
    if (hasCoords && hasText) return
    if (!hasCoords && !hasText) return
    autoGeocodedRef.current = true

    if (!hasCoords) {
      // Text only → forward geocode to coords.
      const q = value.address || value.name
      fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
        { headers: { 'Accept-Language': 'en' } },
      )
        .then((r) => r.json())
        .then((data) => {
          if (data[0]) {
            onChange({ ...value, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
            setShowMap(true)
          }
        })
        .catch(() => {})
    } else {
      // Coords only (e.g. from photo EXIF) → reverse geocode to fill name/address.
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${value.lat}&lon=${value.lng}`,
        { headers: { 'Accept-Language': 'en' } },
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.display_name) {
            onChange({
              ...value,
              name: value.name || data.name || '',
              address: data.display_name,
            })
            setQuery(data.display_name)
            setShowMap(true)
          }
        })
        .catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback((q) => {
    clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`,
          { headers: { 'Accept-Language': 'en' } },
        )
        const data = await res.json()
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
  }, [])

  const handleQueryChange = (e) => {
    setQuery(e.target.value)
    if (!e.target.value) onChange(null)
    else search(e.target.value)
  }

  const selectResult = (r) => {
    const loc = {
      name: r.name || '',
      address: r.display_name || '',
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
    }
    onChange(loc)
    setQuery(r.display_name)
    setResults([])
    setShowMap(true)
  }

  const handleMapClick = useCallback(async (lat, lng) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { 'Accept-Language': 'en' } },
      )
      const data = await res.json()
      const addr = data.display_name || ''
      onChange({ name: '', address: addr, lat, lng })
      setQuery(addr)
    } catch {
      onChange({ name: '', address: '', lat, lng })
      setQuery(`${lat.toFixed(6)}, ${lng.toFixed(6)}`)
    }
    setResults([])
  }, [onChange])

  const handleClear = () => {
    onChange(null)
    setQuery('')
    setResults([])
  }

  const markerPos = value?.lat != null ? [value.lat, value.lng] : null
  const mapCenter = markerPos ?? DEFAULT_CENTER

  return (
    <div className="location-picker">
      <div className="location-search">
        <input
          type="text"
          className="input"
          value={query}
          onChange={handleQueryChange}
          placeholder="Search for a place or address…"
        />
        {searching && <span className="location-searching">Searching…</span>}
        {results.length > 0 && (
          <ul className="location-results" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {results.map((r) => (
              <li key={r.place_id}>
                <button type="button" onClick={() => selectResult(r)}>
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className="location-pick-toggle"
        onClick={() => setShowMap((s) => !s)}
      >
        {showMap ? '▾ Hide map' : '▸ Pick on map'}
      </button>

      {showMap && (
        <div className="location-map">
          <MapContainer
            center={mapCenter}
            zoom={13}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapClickHandler onMapClick={handleMapClick} />
            <MapCenterUpdater center={mapCenter} />
            {markerPos && <Marker position={markerPos} />}
          </MapContainer>
        </div>
      )}

      {value && (value.name || value.address || value.lat != null) && (
        <div className="location-summary">
          <div>
            {(value.name || value.address) && (
              <div className="name">{value.name || value.address}</div>
            )}
            {value.lat != null && (
              <div className="coords">
                {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
              </div>
            )}
          </div>
          <button type="button" className="clear" onClick={handleClear}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function MapCenterUpdater({ center }) {
  const map = useMap()
  const prev = useRef(center)
  useEffect(() => {
    if (prev.current[0] !== center[0] || prev.current[1] !== center[1]) {
      map.panTo(center)
      prev.current = center
    }
  }, [map, center])
  return null
}
