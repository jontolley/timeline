import { useEffect, useRef, useState } from 'react'

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 L 13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4 H14 M4 8 H12 M6 12 H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Sticky toolbar for the timeline feed: search, filter, add-event split button.
 *
 * Search is intentionally render-only for now — submitting does nothing. Filter
 * opens the parent's modal. Add-event has a chevron dropdown for the two photo
 * capture flows.
 */
export default function TimelineToolbar({
  filterCount,
  onOpenFilters,
  onAddEvent,
  onAiPhoto,
  onPhotoEvent,
  aiPhotoBusy,
  photoBusy,
  searchQuery,
  onSearchChange,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const pickAi = () => { setMenuOpen(false); onAiPhoto?.() }
  const pickPhoto = () => { setMenuOpen(false); onPhotoEvent?.() }

  return (
    <div className="tl-toolbar">
      <label className="tl-search">
        <SearchIcon />
        <input
          type="text"
          placeholder="search the timeline…"
          aria-label="Search timeline"
          value={searchQuery || ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && searchQuery) {
              e.preventDefault()
              // Stop the event before it can close anything else listening
              // for Escape (e.g. a future global handler).
              e.stopPropagation()
              onSearchChange?.('')
            }
          }}
        />
        {searchQuery ? (
          <button
            type="button"
            className="tl-search-clear"
            aria-label="Clear search"
            onClick={() => onSearchChange?.('')}
          >
            ×
          </button>
        ) : (
          <span className="tl-kbd" aria-hidden="true">⌘K</span>
        )}
      </label>

      <button type="button" className="tl-filter-btn" onClick={onOpenFilters}>
        <FilterIcon />
        Filter
        {filterCount > 0 ? (
          <span className="tl-filter-count">· {filterCount}</span>
        ) : (
          <span className="tl-filter-count">· 0</span>
        )}
      </button>

      <div className="tl-add-split" ref={menuRef}>
        <button type="button" className="tl-add-main" onClick={onAddEvent}>
          <span className="tl-plus" aria-hidden="true" />
          Add event
        </button>
        <button
          type="button"
          className="tl-add-chev"
          aria-label="More capture options"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ▾
        </button>
        {menuOpen && (
          <div className="tl-add-menu" role="menu">
            <button
              type="button"
              className="tl-add-menu-item"
              role="menuitem"
              onClick={pickPhoto}
              disabled={photoBusy}
            >
              <span className="tl-add-menu-t">Event from photo</span>
              <span className="tl-add-menu-s">Date + GPS from EXIF, you write the rest</span>
            </button>
            <button
              type="button"
              className="tl-add-menu-item"
              role="menuitem"
              onClick={pickAi}
              disabled={aiPhotoBusy}
            >
              <span className="tl-add-menu-t">Photo with AI captions</span>
              <span className="tl-add-menu-s">EXIF + Claude-written title and description</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
