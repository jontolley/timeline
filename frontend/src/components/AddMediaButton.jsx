import { useEffect, useRef, useState } from 'react'
import CombinePdfModal from './CombinePdfModal'

// Include both MIME types AND extensions — some browsers (Safari especially)
// match only on extension for files like .m4a that report as audio/x-m4a.
const MEDIA_ACCEPT = [
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime',
  'audio/mpeg', 'audio/mp4',
  'application/pdf',
  '.jpg', '.jpeg', '.png', '.webp',
  '.mp4', '.mov',
  '.mp3', '.m4a',
  '.pdf',
].join(',')

/**
 * Split button for adding media, mirroring the timeline's "Add event" control.
 * Main button opens the file picker; the chevron menu offers the same upload
 * plus "Combine images to PDF". Shared by EventForm (create) and EventDetail.
 *
 * onFiles(files: File[]) receives picked files OR the single generated PDF.
 */
export default function AddMediaButton({ onFiles, busy = false }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [combineOpen, setCombineOpen] = useState(false)
  const fileInputRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const openPicker = () => fileInputRef.current?.click()

  const handleChange = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) onFiles(files)
  }

  return (
    <div className="tl-add-split media-add-split" ref={wrapRef}>
      <button type="button" className="tl-add-main" onClick={openPicker} disabled={busy}>
        <span className="tl-plus" aria-hidden="true" />
        {busy ? 'Uploading…' : 'Add media'}
      </button>
      <button
        type="button"
        className="tl-add-chev"
        aria-label="More media options"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
      >
        ▾
      </button>
      {menuOpen && (
        <div className="tl-add-menu" role="menu">
          <button
            type="button"
            className="tl-add-menu-item"
            role="menuitem"
            onClick={() => { setMenuOpen(false); openPicker() }}
          >
            <span className="tl-add-menu-t">Upload files</span>
            <span className="tl-add-menu-s">Photos, videos, audio, or PDFs</span>
          </button>
          <button
            type="button"
            className="tl-add-menu-item"
            role="menuitem"
            onClick={() => { setMenuOpen(false); setCombineOpen(true) }}
          >
            <span className="tl-add-menu-t">Combine images to PDF</span>
            <span className="tl-add-menu-s">Merge several images into one document</span>
          </button>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <CombinePdfModal
        open={combineOpen}
        onClose={() => setCombineOpen(false)}
        onCreate={(file) => onFiles([file])}
      />
    </div>
  )
}
