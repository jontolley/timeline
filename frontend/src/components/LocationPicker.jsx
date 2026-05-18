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

  // On mount: if value has a name/address but no coords, geocode automatically
  useEffect(() => {
    if (autoGeocodedRef.current) return
    if (!value || value.lat != null || !(value.name || value.address)) return
    autoGeocodedRef.current = true
    const q = value.address || value.name
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
      .then((r) => r.json())
      .then((data) => {
        if (data[0]) {
          onChange({ ...value, lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) })
          setShowMap(true)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback((q) => {
    clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`,
          { headers: { 'Accept-Language': 'en' } }
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
        { headers: { 'Accept-Language': 'en' } }
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
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleQueryChange}
          placeholder="Search for a place or address…"
          className="w-full border border-ink-line rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
        {searching && (
          <span className="absolute right-3 top-2 text-xs text-ink-faint">Searching…</span>
        )}
        {results.length > 0 && (
          <ul className="absolute z-[1000] left-0 right-0 mt-1 bg-white border border-ink-line rounded-md shadow-lg max-h-52 overflow-y-auto">
            {results.map((r) => (
              <li key={r.place_id}>
                <button
                  type="button"
                  onClick={() => selectResult(r)}
                  className="w-full text-left px-3 py-2 text-sm text-ink-soft hover:bg-accent-soft truncate"
                >
                  {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => setShowMap((s) => !s)}
        className="text-sm text-accent hover:text-ink flex items-center gap-1"
      >
        {showMap ? '▾ Hide map' : '▸ Pick on map'}
      </button>

      {showMap && (
        <div className="rounded-lg overflow-hidden border border-ink-line" style={{ height: 280 }}>
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
        <div className="flex items-start justify-between bg-surface border border-ink-line rounded-md px-3 py-2 text-sm">
          <div className="min-w-0">
            {(value.name || value.address) && (
              <p className="font-medium text-ink truncate">{value.name || value.address}</p>
            )}
            {value.lat != null && (
              <p className="text-xs text-ink-faint mt-0.5 font-mono">
                {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="text-ink-faint hover:text-ink-mute ml-3 shrink-0 text-xs"
          >
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
