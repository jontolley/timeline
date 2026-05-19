import { useEffect, useRef, useState } from 'react'
import { createEvent } from '../api/events'

const CATEGORIES = [
  { value: 'family',    label: 'Family' },
  { value: 'travel',    label: 'Travel' },
  { value: 'career',    label: 'Career' },
  { value: 'milestone', label: 'Milestone' },
]

function todayIsoDate() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function QuickCapture({ open, onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIsoDate())
  const [category, setCategory] = useState('family')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const titleRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDate(todayIsoDate())
    setCategory('family')
    setNotes('')
    setError(null)
    setSaving(false)
    // Defer focus until the sheet's slide-up animation begins.
    requestAnimationFrame(() => titleRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const canSave = title.trim() && date && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title: title.trim(),
        event_type: category,
        date: `${date}T00:00:00.000Z`,
        end_date: null,
        description: notes.trim() || null,
        location: null,
        tags: [],
        people: [],
        photos: [],
      }
      const created = await createEvent(payload)
      onSaved?.(created)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Capture a moment</h3>
        <p className="sheet-sub">A title and a date are all you need. Add the rest later.</p>

        {error && <p className="sheet-error">{error}</p>}

        <div className="sheet-field">
          <label htmlFor="qc-title">Title</label>
          <input
            id="qc-title"
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What happened?"
            autoComplete="off"
          />
        </div>

        <div className="sheet-row">
          <div className="sheet-field">
            <label htmlFor="qc-date">Date</label>
            <input
              id="qc-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="sheet-field">
            <label htmlFor="qc-cat">Category</label>
            <select
              id="qc-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="sheet-field">
          <label htmlFor="qc-notes">Notes</label>
          <textarea
            id="qc-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="A line or two so future-you remembers what mattered."
          />
        </div>

        <div className="sheet-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : 'Save event'}
          </button>
        </div>
      </div>
    </div>
  )
}
