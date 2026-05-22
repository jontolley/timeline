import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { attachPhoto, createEvent, getEvent, updateEvent } from '../api/events'
import { uploadPhoto } from '../api/uploads'
import TagInput from '../components/TagInput'
import LocationPicker from '../components/LocationPicker'
import PeoplePicker from '../components/PeoplePicker'
import { consumePendingPhoto } from '../lib/photoHandoff'
import { usePeopleStore } from '../store'
import { hasTime } from '../utils/date'

const EMPTY_FORM = {
  title: '',
  description: '',
  event_type: 'career',
  date: '',
  includeTime: false,
  time: '',
  includeEndDate: false,
  end_date: '',
  includeEndTime: false,
  end_time: '',
  location: null,
  tags: [],
  people: [],
}

function buildInitialForm(prefill) {
  if (!prefill) return EMPTY_FORM
  const hasCoords = prefill.lat != null && prefill.lng != null
  return {
    ...EMPTY_FORM,
    date: prefill.date || '',
    includeTime: !!prefill.time,
    time: prefill.time || '',
    location: hasCoords
      ? { name: '', address: '', lat: prefill.lat, lng: prefill.lng }
      : null,
  }
}

export default function EventForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = !id ? location.state?.prefill : null
  const [form, setForm] = useState(() => buildInitialForm(prefill))
  const [pendingPhotos, setPendingPhotos] = useState(() => {
    if (id) return []
    const initial = consumePendingPhoto()
    return initial ? [initial] : []
  })
  const photoInputRef = useRef(null)
  const [photoNotice] = useState(() => {
    if (id || !prefill) return null
    if (prefill.has_exif) return 'Pre-filled from photo. Edit anything you like.'
    return "Couldn't read metadata from this photo — please fill manually."
  })
  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const { people, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()

  const pendingPhotoUrls = useMemo(
    () => pendingPhotos.map((f) => URL.createObjectURL(f)),
    [pendingPhotos],
  )
  useEffect(() => () => pendingPhotoUrls.forEach(URL.revokeObjectURL), [pendingPhotoUrls])

  const handleAddPhotos = (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) setPendingPhotos((arr) => [...arr, ...files])
  }
  const handleRemovePendingPhoto = (idx) => {
    setPendingPhotos((arr) => arr.filter((_, i) => i !== idx))
  }

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  useEffect(() => {
    if (!id) return
    getEvent(id)
      .then((event) => {
        const eventHasTime = hasTime(event.date)
        const d = new Date(event.date)
        const eventHasEndDate = !!event.end_date
        const eventHasEndTime = eventHasEndDate && hasTime(event.end_date)
        const ed = eventHasEndDate ? new Date(event.end_date) : null
        setForm({
          title: event.title ?? '',
          description: event.description ?? '',
          event_type: event.event_type ?? 'career',
          date: event.date ? event.date.slice(0, 10) : '',
          includeTime: eventHasTime,
          time: eventHasTime
            ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
            : '',
          includeEndDate: eventHasEndDate,
          end_date: event.end_date ? event.end_date.slice(0, 10) : '',
          includeEndTime: eventHasEndTime,
          end_time: eventHasEndTime
            ? `${String(ed.getUTCHours()).padStart(2, '0')}:${String(ed.getUTCMinutes()).padStart(2, '0')}`
            : '',
          location: typeof event.location === 'string'
            ? { name: event.location, address: null, lat: null, lng: null }
            : event.location ?? null,
          tags: event.tags ?? [],
          people: event.people ?? [],
        })
      })
      .catch(() => setError('Failed to load event.'))
      .finally(() => setLoading(false))
  }, [id])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const { includeTime, time, includeEndDate, end_date, includeEndTime, end_time, ...rest } = form
      const dateIso = includeTime && time
        ? `${rest.date}T${time}:00.000Z`
        : `${rest.date}T00:00:00.000Z`
      const endDateIso = includeEndDate && end_date
        ? includeEndTime && end_time
          ? `${end_date}T${end_time}:00.000Z`
          : `${end_date}T00:00:00.000Z`
        : null
      const payload = { ...rest, date: dateIso, end_date: endDateIso }
      if (id) {
        await updateEvent(id, payload)
        navigate(`/events/${id}`)
      } else {
        const created = await createEvent(payload)
        const failed = []
        for (const file of pendingPhotos) {
          try {
            const meta = await uploadPhoto(file)
            await attachPhoto(created._id, meta)
          } catch (photoErr) {
            failed.push(`${file.name}: ${photoErr.message}`)
          }
        }
        if (failed.length) {
          window.alert(`Event saved, but some photos failed:\n${failed.join('\n')}`)
        }
        navigate(`/events/${created._id}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="page-narrow"><p className="muted small">Loading…</p></div>

  return (
    <div className="page-narrow">
      <Link to={id ? `/events/${id}` : '/'} className="back-link">
        ← {id ? 'Back to event' : 'Back to timeline'}
      </Link>
      <h1 className="page-title" style={{ fontSize: 40, marginBottom: 28 }}>
        {id ? 'Edit event' : 'New event'}
      </h1>
      {error && <p className="form-error" style={{ marginBottom: 18 }}>{error}</p>}
      {photoNotice && (
        <p className="form-notice" style={{ marginBottom: 18 }}>
          {photoNotice}
        </p>
      )}

      <form className="form" onSubmit={handleSubmit}>
        <div className="field">
          <label className="field-label" htmlFor="ef-title">
            Title<span className="field-required">*</span>
          </label>
          <input
            id="ef-title"
            className="input"
            required
            value={form.title}
            onChange={set('title')}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ef-type">
            Type<span className="field-required">*</span>
          </label>
          <select
            id="ef-type"
            className="select"
            value={form.event_type}
            onChange={set('event_type')}
          >
            <option value="career">Career</option>
            <option value="travel">Travel</option>
            <option value="milestone">Milestone</option>
            <option value="family">Family</option>
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ef-date">
            Date<span className="field-required">*</span>
          </label>
          <input
            id="ef-date"
            className="input"
            type="date"
            required
            value={form.date}
            onChange={set('date')}
          />
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.includeTime}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                includeTime: e.target.checked,
                time: e.target.checked ? f.time : '',
              }))
            }
          />
          Include time
        </label>

        {form.includeTime && (
          <div className="field">
            <label className="field-label" htmlFor="ef-time">Time</label>
            <input
              id="ef-time"
              className="input"
              type="time"
              value={form.time}
              onChange={set('time')}
            />
          </div>
        )}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.includeEndDate}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                includeEndDate: e.target.checked,
                end_date: e.target.checked ? f.end_date : '',
                includeEndTime: e.target.checked ? f.includeEndTime : false,
                end_time: e.target.checked ? f.end_time : '',
              }))
            }
          />
          Include end date
        </label>

        {form.includeEndDate && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="ef-end-date">End date</label>
              <input
                id="ef-end-date"
                className="input"
                type="date"
                value={form.end_date}
                onChange={set('end_date')}
                min={form.date || undefined}
              />
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.includeEndTime}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    includeEndTime: e.target.checked,
                    end_time: e.target.checked ? f.end_time : '',
                  }))
                }
              />
              Include end time
            </label>
            {form.includeEndTime && (
              <div className="field">
                <label className="field-label" htmlFor="ef-end-time">End time</label>
                <input
                  id="ef-end-time"
                  className="input"
                  type="time"
                  value={form.end_time}
                  onChange={set('end_time')}
                />
              </div>
            )}
          </>
        )}

        <div className="field">
          <label className="field-label">Location</label>
          <LocationPicker
            value={form.location}
            onChange={(loc) => setForm((f) => ({ ...f, location: loc }))}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="ef-desc">Description</label>
          <textarea
            id="ef-desc"
            className="textarea"
            rows={3}
            spellCheck="true"
            value={form.description}
            onChange={set('description')}
          />
        </div>

        <div className="field">
          <label className="field-label">Tags</label>
          <TagInput
            tags={form.tags}
            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
          />
        </div>

        <div className="field">
          <label className="field-label">People</label>
          <p className="field-hint" style={{ marginBottom: 10 }}>
            Leave empty for events not tied to a specific person.
          </p>
          <PeoplePicker
            people={people}
            selectedIds={form.people}
            onChange={(ids) => setForm((f) => ({ ...f, people: ids }))}
          />
        </div>

        {!id && (
          <div className="field">
            <div className="photo-toolbar">
              <label className="field-label" style={{ margin: 0 }}>
                Photos{pendingPhotos.length > 0 ? ` · ${pendingPhotos.length}` : ''}
              </label>
              <button
                type="button"
                className="btn"
                onClick={() => photoInputRef.current?.click()}
              >
                + Add photos
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: 'none' }}
                onChange={handleAddPhotos}
              />
            </div>
            {pendingPhotos.length === 0 ? (
              <p className="field-hint" style={{ marginTop: 10 }}>
                Photos you add here will attach when you save.
              </p>
            ) : (
              <div className="detail-photos" style={{ marginTop: 10 }}>
                {pendingPhotos.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="detail-photo">
                    <div className="tile">
                      <img src={pendingPhotoUrls[i]} alt="" loading="lazy" />
                    </div>
                    <button
                      type="button"
                      className="delete"
                      onClick={() => handleRemovePendingPhoto(i)}
                      aria-label="Remove photo"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save event'}
          </button>
          <button type="button" className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
