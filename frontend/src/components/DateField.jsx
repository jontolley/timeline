import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from './Icons'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const POPOVER_H = 348 // approximate, for flip-up near the viewport bottom

const pad = (n) => String(n).padStart(2, '0')
const toIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

// Parse free-typed text. Returns 'YYYY-MM-DD' on success, '' when empty, or
// null when unparseable (so the caller can leave the prior value untouched).
function parseTyped(text) {
  const t = text.trim()
  if (!t) return ''
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3]
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? toIso(y, m, d) : null
  }
  // new Date() reads date-only strings ("May 14, 1997", "5/14/1997") at local
  // midnight, so the Y/M/D components match what was typed — no UTC shift since
  // we only read the components, never serialize the Date.
  const dt = new Date(t)
  if (!Number.isNaN(dt.getTime())) return toIso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
  return null
}

// 'YYYY-MM-DD' → "May 14, 1997" (rendered via UTC so the day never shifts).
function formatDisplay(value) {
  if (!value) return ''
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return value
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * Typed date input + calendar popover. value/onChange speak 'YYYY-MM-DD' (the
 * form's UTC-safe calendar-date contract); display is the friendly long form.
 *
 * The popover is rendered in a portal with fixed positioning so it escapes the
 * date field's range-reveal `overflow: hidden` clip and always layers above the
 * location map.
 */
export default function DateField({ id, value, onChange, placeholder = 'May 14, 1997', min, required }) {
  const [text, setText] = useState(() => formatDisplay(value))
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState(null)
  const [view, setView] = useState(() => {
    const base = value ? new Date(`${value}T00:00:00`) : new Date()
    return { year: base.getFullYear(), month: base.getMonth() }
  })
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const calRef = useRef(null)

  // Keep the visible text in sync with external value changes, but never stomp
  // on the user while they're actively typing in the field.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setText(formatDisplay(value))
  }, [value])

  const reposition = () => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = r.bottom + 8
    const flip = below + POPOVER_H > window.innerHeight && r.top - POPOVER_H - 8 > 0
    const left = Math.min(Math.max(8, r.left), window.innerWidth - 308)
    setCoords({ top: flip ? r.top - POPOVER_H - 8 : below, left })
  }

  useLayoutEffect(() => {
    if (open) reposition()
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (wrapRef.current?.contains(e.target)) return
      if (calRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => reposition()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  const openCal = () => {
    const base = value ? new Date(`${value}T00:00:00`) : new Date()
    setView({ year: base.getFullYear(), month: base.getMonth() })
    setOpen((o) => !o)
  }

  const handleChange = (e) => {
    setText(e.target.value)
    const parsed = parseTyped(e.target.value)
    if (parsed !== null) onChange(parsed)
  }
  const handleBlur = () => {
    const parsed = parseTyped(text)
    if (parsed === null) setText(formatDisplay(value))
    else setText(formatDisplay(parsed))
  }

  const selectDay = (day) => {
    const iso = toIso(view.year, view.month + 1, day)
    onChange(iso)
    // Update the visible text directly: focusing the input below makes the
    // value-sync effect skip its own setText, so without this the field would
    // keep showing the old date even though the value changed.
    setText(formatDisplay(iso))
    setOpen(false)
    inputRef.current?.focus()
  }

  const firstDow = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const isSelected = (d) => value === toIso(view.year, view.month + 1, d)
  const isDisabled = (d) => min && toIso(view.year, view.month + 1, d) < min

  return (
    <div className="ef-datewrap" ref={wrapRef}>
      <div className="ef-ibox">
        <span className="ef-lead"><CalendarIcon size={17} /></span>
        <input
          id={id}
          ref={inputRef}
          className="ef-inp"
          type="text"
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
        />
        <span className="ef-trail">
          <button type="button" className="ef-iconbtn" onClick={openCal} aria-label="Open calendar" aria-expanded={open}>
            <CalendarIcon size={18} />
          </button>
        </span>
      </div>

      {open && coords && createPortal(
        <div className="ef-cal" ref={calRef} style={{ top: coords.top, left: coords.left }}>
          <div className="ef-cal-head">
            <button
              type="button"
              className="ef-iconbtn"
              aria-label="Previous month"
              onClick={() => setView((v) => {
                const m = v.month - 1
                return m < 0 ? { year: v.year - 1, month: 11 } : { ...v, month: m }
              })}
            ><ChevronLeftIcon size={18} /></button>
            <div className="ef-cal-m">{MONTHS[view.month]} {view.year}</div>
            <button
              type="button"
              className="ef-iconbtn"
              aria-label="Next month"
              onClick={() => setView((v) => {
                const m = v.month + 1
                return m > 11 ? { year: v.year + 1, month: 0 } : { ...v, month: m }
              })}
            ><ChevronRightIcon size={18} /></button>
          </div>
          <div className="ef-cal-grid">
            {DOW.map((d) => <div key={d} className="ef-dow">{d}</div>)}
            {cells.map((d, i) => d === null
              ? <span key={`x${i}`} />
              : (
                <button
                  key={d}
                  type="button"
                  className={isSelected(d) ? 'sel' : ''}
                  disabled={isDisabled(d)}
                  onClick={() => selectDay(d)}
                >
                  {d}
                </button>
              ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
