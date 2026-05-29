import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { imagesToPdf, isHeic } from '../lib/imagesToPdf'

let uid = 0

// Lets a user pick several images, reorder them into the page order they want,
// and combine them into a single PDF that joins the event's media queue. The
// generated File is handed back via onCreate and flows through the normal
// uploadPdf pipeline (thumbnail, page count, viewer) with no extra plumbing.
export default function CombinePdfModal({ open, onClose, onCreate }) {
  const [items, setItems] = useState([]) // { id, file, url, failed }
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const fileInputRef = useRef(null)
  const dragFrom = useRef(null)

  // Revoke preview URLs on close so we don't leak object URLs.
  const reset = () => {
    setItems((arr) => {
      arr.forEach((it) => it.url && URL.revokeObjectURL(it.url))
      return []
    })
    setError(null)
    setProgress(null)
    setDragOver(null)
  }
  useEffect(() => {
    if (!open) reset()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => items.forEach((it) => it.url && URL.revokeObjectURL(it.url)), []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setError(null)
    setItems((arr) => [
      ...arr,
      ...files.map((file) => ({
        id: ++uid,
        file,
        // HEIC can't be previewed via <img> outside Safari — skip the URL and
        // let the placeholder show instead of a broken image flash.
        url: isHeic(file) ? null : URL.createObjectURL(file),
        failed: false,
      })),
    ])
  }

  const remove = (id) =>
    setItems((arr) => {
      const hit = arr.find((it) => it.id === id)
      if (hit?.url) URL.revokeObjectURL(hit.url)
      return arr.filter((it) => it.id !== id)
    })

  const markFailed = (id) =>
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, failed: true } : it)))

  const reorder = (from, to) => {
    if (from === to || from == null || to == null) return
    setItems((arr) => {
      if (to < 0 || to >= arr.length) return arr
      const next = [...arr]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  // Touch-friendly reordering: native drag-and-drop doesn't fire on
  // touchscreens, so each tile also gets explicit back/forward controls.
  const move = (index, dir) => reorder(index, index + dir)

  const handleCreate = async () => {
    if (!items.length || generating) return
    setGenerating(true)
    setError(null)
    setProgress({ done: 0, total: items.length })
    try {
      const file = await imagesToPdf(
        items.map((it) => it.file),
        { onProgress: (done, total) => setProgress({ done, total }) },
      )
      onCreate(file)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not build the PDF.')
    } finally {
      setGenerating(false)
      setProgress(null)
    }
  }

  return (
    <Modal
      open={open}
      onClose={generating ? undefined : onClose}
      eyebrow="Media"
      title="Combine images into a"
      titleEm="PDF"
      sub="Reorder the thumbnails to set the page order. The PDF attaches when you save the event."
      width={560}
      secondary={
        <button type="button" className="btn" onClick={onClose} disabled={generating}>
          Cancel
        </button>
      }
      primary={
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={!items.length || generating}
        >
          {generating
            ? progress
              ? `Adding page ${progress.done} of ${progress.total}…`
              : 'Building…'
            : `Create PDF${items.length ? ` · ${items.length}` : ''}`}
        </button>
      }
    >
      <div className="photo-toolbar">
        <label className="field-label" style={{ margin: 0 }}>
          Images{items.length ? ` · ${items.length}` : ''}
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={generating}
        >
          + Add images
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
          multiple
          style={{ display: 'none' }}
          onChange={handleAdd}
        />
      </div>

      {error && <p className="form-error" style={{ marginTop: 10 }}>{error}</p>}

      {items.length === 0 ? (
        <p className="field-hint" style={{ marginTop: 10 }}>
          Add JPEG, PNG, WebP, or HEIC images. Each image becomes one page.
        </p>
      ) : (
        <div className="detail-photos cpdf-grid" style={{ marginTop: 10 }}>
          {items.map((it, i) => (
            <div
              key={it.id}
              className={`detail-photo cpdf-tile${dragOver === i ? ' drag-over' : ''}`}
              draggable={!generating}
              onDragStart={() => { dragFrom.current = i }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(i) }}
              onDragLeave={() => setDragOver((d) => (d === i ? null : d))}
              onDrop={(e) => {
                e.preventDefault()
                reorder(dragFrom.current, i)
                dragFrom.current = null
                setDragOver(null)
              }}
              onDragEnd={() => { dragFrom.current = null; setDragOver(null) }}
            >
              {it.url && !it.failed ? (
                <div className="tile">
                  <img src={it.url} alt="" loading="lazy" onError={() => markFailed(it.id)} />
                </div>
              ) : (
                <div className="audio-placeholder">
                  <span className="audio-placeholder-icon" aria-hidden="true">🖼️</span>
                  <span className="audio-placeholder-label">{isHeic(it.file) ? 'HEIC' : 'Image'}</span>
                </div>
              )}
              <span className="cpdf-page-no" aria-hidden="true">{i + 1}</span>
              {!generating && (
                <>
                  <button
                    type="button"
                    className="delete"
                    onClick={() => remove(it.id)}
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                  <div className="cpdf-move">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="Move earlier"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === items.length - 1}
                      aria-label="Move later"
                    >
                      ›
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
