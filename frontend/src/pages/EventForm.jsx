import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { attachMedia, createEvent, getEvent, updateEvent } from '../api/events'
import { createThread } from '../api/threads'
import { extractAudioWaveformUrl, extractPdfPosterUrl, extractVideoPosterUrl, uploadMedia } from '../api/uploads'
import AddMediaButton from '../components/AddMediaButton'
import DateField from '../components/DateField'
import LocationPicker from '../components/LocationPicker'
import ThreadModal from '../components/ThreadModal'
import { ArrowLeftIcon, CheckIcon, PlusIcon, XIcon } from '../components/Icons'
import { consumePendingCaption, consumePendingPhoto } from '../lib/photoHandoff'
import { useEventStore, usePeopleStore, useThreadStore } from '../store'
import { useAlert } from '../lib/confirm'
import { personColor, personInitials } from '../utils/colors'
import { hasTime } from '../utils/date'

const EMPTY_FORM = {
  title: '',
  description: '',
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
  thread_id: '',
}

const EMPTY_THREAD_DRAFT = { name: '', color: 'slate', visibility: 'private' }

// Local calendar date (YYYY-MM-DD). Used as the create-page default so a new
// event lands on today unless a photo's EXIF supplies a date.
function todayLocalIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function buildInitialForm(prefill) {
  const base = { ...EMPTY_FORM, date: todayLocalIso() }
  if (!prefill) return base
  const hasCoords = prefill.lat != null && prefill.lng != null
  return {
    ...base,
    date: prefill.date || todayLocalIso(),
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
  const [pendingMedia, setPendingMedia] = useState(() => {
    if (id) return []
    const initial = consumePendingPhoto()
    return initial ? [initial] : []
  })
  // Parallel array of poster URLs (null for non-poster files). Populated
  // asynchronously as files are added; revoked when files are removed.
  const [pendingPosters, setPendingPosters] = useState(() => pendingMedia.map(() => null))
  const [photoNotice] = useState(() => {
    if (id || !prefill) return null
    if (prefill.has_exif) return 'Pre-filled from photo. Edit anything you like.'
    return "Couldn't read metadata from this photo — please fill manually."
  })
  const [captionPromise] = useState(() => (id ? null : consumePendingCaption()))
  const [captionStatus, setCaptionStatus] = useState(() => (captionPromise ? 'pending' : 'idle'))
  const titleTouchedRef = useRef(false)
  const descriptionTouchedRef = useRef(false)
  const geoTriedRef = useRef(false)
  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [tagFocus, setTagFocus] = useState(false)

  // New-thread dialog (reuses the Settings → Threads modal).
  const [threadModal, setThreadModal] = useState(null)
  const [threadBusy, setThreadBusy] = useState(false)
  const [threadErr, setThreadErr] = useState(null)

  const { people, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()
  const threads = useThreadStore((s) => s.threads)
  const ownedThreads = useMemo(() => threads.filter((t) => t.is_owner), [threads])
  const alert = useAlert()

  const pendingMediaUrls = useMemo(
    () => pendingMedia.map((f) => URL.createObjectURL(f)),
    [pendingMedia],
  )
  useEffect(() => () => pendingMediaUrls.forEach(URL.revokeObjectURL), [pendingMediaUrls])

  // Append files to the pending queue and kick off background poster/waveform/
  // page-1 extraction. Shared by the file picker and the combine-to-PDF modal.
  const appendMediaFiles = (files) => {
    if (!files.length) return
    setPendingMedia((arr) => {
      const baseIdx = arr.length
      files.forEach((file, i) => {
        const type = file.type || ''
        const ext = (file.name.split('.').pop() || '').toLowerCase()
        const isPdf = type === 'application/pdf' || ext === 'pdf'
        const extractor = type.startsWith('video/')
          ? extractVideoPosterUrl
          : type.startsWith('audio/')
            ? extractAudioWaveformUrl
            : isPdf
              ? extractPdfPosterUrl
              : null
        if (!extractor) return
        extractor(file)
          .then((url) => {
            setPendingPosters((posters) => {
              const next = [...posters]
              next[baseIdx + i] = url
              return next
            })
          })
          .catch(() => {})
      })
      return [...arr, ...files]
    })
    setPendingPosters((arr) => [...arr, ...files.map(() => null)])
  }
  const handleRemovePendingMedia = (idx) => {
    setPendingMedia((arr) => arr.filter((_, i) => i !== idx))
    setPendingPosters((arr) => {
      const removed = arr[idx]
      if (removed) URL.revokeObjectURL(removed)
      return arr.filter((_, i) => i !== idx)
    })
  }

  // Revoke any lingering poster URLs when the page unmounts.
  useEffect(() => () => {
    pendingPosters.forEach((u) => u && URL.revokeObjectURL(u))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!peopleLoaded) loadPeople().catch(() => {})
  }, [peopleLoaded, loadPeople])

  // On the create path, default the thread to the user's oldest owned thread
  // once the store has loaded. Edit keeps whatever the event has.
  useEffect(() => {
    if (id) return
    if (!ownedThreads.length) return
    setForm((f) => (f.thread_id ? f : { ...f, thread_id: ownedThreads[0]._id }))
  }, [id, ownedThreads])

  // On the create path, if a photo didn't supply a location, fall back to the
  // browser's geolocation (reverse-geocoded to an address). Best-effort — a
  // permission denial or error is silently ignored, and we never overwrite a
  // location that's already set.
  useEffect(() => {
    if (id || geoTriedRef.current) return
    geoTriedRef.current = true
    if (form.location && form.location.lat != null) return
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        let loc = { name: '', address: '', lat, lng }
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
            { headers: { 'Accept-Language': 'en' } },
          )
          const data = await res.json()
          if (data.display_name) loc = { name: data.name || '', address: data.display_name, lat, lng }
        } catch { /* keep coords-only */ }
        setForm((f) => (f.location && f.location.lat != null ? f : { ...f, location: loc }))
      },
      () => {},
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

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
          thread_id: event.thread_id ?? '',
        })
      })
      .catch(() => setError('Failed to load event.'))
      .finally(() => setLoading(false))
  }, [id])

  const setTitle = (e) => {
    titleTouchedRef.current = true
    setForm((f) => ({ ...f, title: e.target.value }))
  }
  const setDescription = (e) => {
    descriptionTouchedRef.current = true
    setForm((f) => ({ ...f, description: e.target.value }))
  }

  useEffect(() => {
    if (!captionPromise) return
    let cancelled = false
    captionPromise.then((result) => {
      if (cancelled) return
      if (!result || result.error) {
        setCaptionStatus('error')
        return
      }
      setForm((f) => ({
        ...f,
        title: titleTouchedRef.current || f.title ? f.title : result.title || '',
        description:
          descriptionTouchedRef.current || f.description ? f.description : result.description || '',
      }))
      setCaptionStatus('done')
    })
    return () => { cancelled = true }
  }, [captionPromise])

  // ---- date / time / range toggles ----
  const toggleTime = () => setForm((f) => {
    const on = !f.includeTime
    return { ...f, includeTime: on, time: on ? f.time : '' }
  })
  const toggleRange = () => setForm((f) => {
    const on = !f.includeEndDate
    return {
      ...f,
      includeEndDate: on,
      end_date: on ? f.end_date : '',
      includeEndTime: on ? f.includeEndTime : false,
      end_time: on ? f.end_time : '',
    }
  })
  const toggleEndTime = () => setForm((f) => {
    const on = !f.includeEndTime
    return { ...f, includeEndTime: on, end_time: on ? f.end_time : '' }
  })

  // ---- tags ----
  const addTag = (raw) => {
    const trimmed = raw.trim().replace(/,$/, '').toLowerCase()
    if (!trimmed) return
    setForm((f) => (f.tags.includes(trimmed) ? f : { ...f, tags: [...f.tags, trimmed] }))
  }
  const removeTag = (tag) => setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))
  const onTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
      setTagInput('')
    } else if (e.key === 'Backspace' && tagInput === '' && form.tags.length) {
      removeTag(form.tags[form.tags.length - 1])
    }
  }

  // ---- people ----
  const togglePerson = (pid) => setForm((f) => ({
    ...f,
    people: f.people.includes(pid) ? f.people.filter((x) => x !== pid) : [...f.people, pid],
  }))

  // ---- new thread ----
  const openNewThread = () => { setThreadErr(null); setThreadModal({ mode: 'new', draft: EMPTY_THREAD_DRAFT }) }
  const saveThread = async (e) => {
    e.preventDefault()
    if (!threadModal) return
    setThreadBusy(true)
    setThreadErr(null)
    try {
      const created = await createThread({
        name: threadModal.draft.name.trim(),
        color: threadModal.draft.color,
        visibility: threadModal.draft.visibility,
      })
      await useThreadStore.getState().load(true)
      setForm((f) => ({ ...f, thread_id: created._id }))
      setThreadModal(null)
    } catch (err) {
      setThreadErr(err.message)
    } finally {
      setThreadBusy(false)
    }
  }

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
        useEventStore.getState().invalidate()
        navigate(`/events/${id}`)
      } else {
        const created = await createEvent(payload)
        const failed = []
        for (const file of pendingMedia) {
          try {
            const meta = await uploadMedia(file)
            await attachMedia(created._id, meta)
          } catch (mediaErr) {
            failed.push(`${file.name}: ${mediaErr.message}`)
          }
        }
        useEventStore.getState().invalidate()
        if (failed.length) {
          await alert({
            title: 'Event saved, but some media failed',
            body: failed.join('\n'),
          })
        }
        navigate(`/events/${created._id}`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="eventform"><p className="muted small">Loading…</p></div>

  return (
    <>
      <form className="eventform" id="eventForm" autoComplete="off" onSubmit={handleSubmit}>
        <button type="button" className="ef-back" onClick={() => navigate(id ? `/events/${id}` : '/')}>
          <ArrowLeftIcon size={16} /> {id ? 'Back to event' : 'Back to timeline'}
        </button>
        <h1 className="ef-title">{id ? 'Edit event' : 'New event'}</h1>

        {error && <p className="ef-error">{error}</p>}
        {photoNotice && <p className="ef-notice">{photoNotice}</p>}

        {/* TITLE */}
        <div className="ef-field">
          <div className="ef-lab">
            Title <span className="req">*</span>
            {captionStatus === 'pending' && <span className="ef-lab-hint">· AI is captioning…</span>}
          </div>
          <input
            className="ef-inp title"
            type="text"
            placeholder="What happened?"
            required
            value={form.title}
            onChange={setTitle}
          />
        </div>

        {/* THREAD */}
        <div className="ef-field">
          <div className="ef-lab">Thread <span className="req">*</span></div>
          <div className="ef-pillrow" role="group" aria-label="Thread">
            {ownedThreads.map((t) => (
              <button
                key={t._id}
                type="button"
                className="ef-pill"
                aria-pressed={form.thread_id === t._id}
                onClick={() => setForm((f) => ({ ...f, thread_id: t._id }))}
              >
                <span className="dot" style={{ background: personColor(t.color) }} />
                {t.name}
              </button>
            ))}
            <button type="button" className="ef-pill ghost" onClick={openNewThread}>
              <PlusIcon size={15} /> New thread
            </button>
          </div>
        </div>

        {/* DATE */}
        <div className="ef-field">
          <div className="ef-lab">Date <span className="req">*</span></div>
          <DateField
            id="ef-date"
            value={form.date}
            onChange={(v) => setForm((f) => ({ ...f, date: v }))}
            required
          />

          <div className="ef-dtoggles">
            <button
              type="button"
              className="ef-dtoggle"
              aria-pressed={form.includeTime}
              onClick={toggleTime}
            >
              <span className="ic"><PlusIcon size={14} /></span> Add a time
            </button>
            <button
              type="button"
              className="ef-dtoggle"
              aria-pressed={form.includeEndDate}
              onClick={toggleRange}
            >
              <span className="ic"><PlusIcon size={14} /></span> Make it a range
            </button>
          </div>

          <div className={`ef-reveal${form.includeTime ? ' show' : ''}`}>
            <div className="inner">
              <div className="ef-two">
                <div>
                  <div className="ef-mini-lab">Time</div>
                  <input
                    className="ef-inp"
                    type="time"
                    value={form.time}
                    onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className={`ef-reveal${form.includeEndDate ? ' show' : ''}`}>
            <div className="inner">
              <div className="ef-mini-lab">Ends</div>
              <DateField
                value={form.end_date}
                onChange={(v) => setForm((f) => ({ ...f, end_date: v }))}
                min={form.date || undefined}
                placeholder="May 21, 1997"
              />
              <div className="ef-dtoggles" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="ef-dtoggle"
                  aria-pressed={form.includeEndTime}
                  onClick={toggleEndTime}
                >
                  <span className="ic"><PlusIcon size={14} /></span> Add a time
                </button>
              </div>
              <div className={`ef-reveal${form.includeEndTime ? ' show' : ''}`}>
                <div className="inner">
                  <div className="ef-two">
                    <div>
                      <div className="ef-mini-lab">End time</div>
                      <input
                        className="ef-inp"
                        type="time"
                        value={form.end_time}
                        onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* LOCATION */}
        <div className="ef-field">
          <div className="ef-lab">Location</div>
          <LocationPicker
            value={form.location}
            onChange={(loc) => setForm((f) => ({ ...f, location: loc }))}
          />
        </div>

        {/* DESCRIPTION */}
        <div className="ef-field">
          <div className="ef-lab">
            Description
            {captionStatus === 'pending' && <span className="ef-lab-hint">· AI is captioning…</span>}
            {captionStatus === 'error' && <span className="ef-lab-hint">· auto-caption failed — please write one</span>}
          </div>
          <textarea
            className="ef-inp"
            rows={3}
            spellCheck="true"
            placeholder="Tell the story…"
            value={form.description}
            onChange={setDescription}
          />
        </div>

        {/* TAGS */}
        <div className="ef-field">
          <div className="ef-lab">Tags</div>
          <div
            className={`ef-tagbox${tagFocus ? ' focus' : ''}`}
            onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.querySelector('input')?.focus() }}
          >
            {form.tags.map((tag) => (
              <span key={tag} className="ef-chip">
                <span>{tag}</span>
                <span className="x" onClick={() => removeTag(tag)} role="button" aria-label={`Remove ${tag}`}>
                  <XIcon size={13} />
                </span>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKeyDown}
              onFocus={() => setTagFocus(true)}
              onBlur={() => { setTagFocus(false); if (tagInput.trim()) { addTag(tagInput); setTagInput('') } }}
              placeholder="Type a tag, press Enter"
            />
          </div>
        </div>

        {/* PEOPLE */}
        <div className="ef-field">
          <div className="ef-lab">People</div>
          <p className="ef-help" style={{ margin: '-3px 2px 11px' }}>
            Leave empty for events not tied to a specific person.
          </p>
          {people.length === 0 ? (
            <p className="ef-help">
              No people yet.{' '}
              <Link to="/people" style={{ color: 'var(--accent)', borderBottom: '1px solid currentColor' }}>
                Add some
              </Link>{' '}
              to associate with this event.
            </p>
          ) : (
            <div className="ef-people" role="group" aria-label="People">
              {people.map((p) => {
                const selected = form.people.includes(p._id)
                return (
                  <button
                    key={p._id}
                    type="button"
                    className="ef-person"
                    aria-pressed={selected}
                    onClick={() => togglePerson(p._id)}
                  >
                    <span className="av" style={{ background: personColor(p.color) }}>
                      {personInitials(p.name).charAt(0)}
                      {selected && <span className="tick"><CheckIcon size={15} /></span>}
                    </span>
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* MEDIA (create only — edit manages media on the detail page) */}
        {!id && (
          <div className="ef-field" style={{ marginBottom: 0 }}>
            <div className="ef-lab">Media{pendingMedia.length > 0 ? ` · ${pendingMedia.length}` : ''}</div>
            <div className="ef-media-row">
              <AddMediaButton onFiles={appendMediaFiles} />
            </div>
            {pendingMedia.length === 0 ? (
              <p className="ef-help">Photos, videos, audio, or PDFs you add here will attach when you save.</p>
            ) : (
              <div className="detail-photos" style={{ marginTop: 12 }}>
                {pendingMedia.map((file, i) => {
                  const t = file.type || ''
                  const ext = (file.name.split('.').pop() || '').toLowerCase()
                  const kind = t.startsWith('video/')
                    ? 'video'
                    : t.startsWith('audio/')
                      ? 'audio'
                      : t === 'application/pdf' || ext === 'pdf'
                        ? 'pdf'
                        : 'photo'
                  const posterUrl = pendingPosters[i]
                  return (
                    <div key={`${file.name}-${i}`} className={`detail-photo media-${kind}`}>
                      {kind === 'photo' ? (
                        <div className="tile"><img src={pendingMediaUrls[i]} alt="" loading="lazy" /></div>
                      ) : kind === 'video' && posterUrl ? (
                        <div className="tile">
                          <img src={posterUrl} alt="" loading="lazy" />
                          <span className="media-play" aria-hidden="true">▶</span>
                        </div>
                      ) : kind === 'audio' && posterUrl ? (
                        <div className="tile"><img src={posterUrl} alt="" loading="lazy" /></div>
                      ) : kind === 'pdf' && posterUrl ? (
                        <div className="tile">
                          <img src={posterUrl} alt="" loading="lazy" />
                          <span className="media-badge pdf" aria-hidden="true">PDF</span>
                        </div>
                      ) : (
                        <div className="audio-placeholder">
                          <span className="audio-placeholder-icon" aria-hidden="true">
                            {kind === 'pdf' ? '📄' : '♪'}
                          </span>
                          <span className="audio-placeholder-label">
                            {kind === 'video' ? 'Video' : kind === 'pdf' ? 'PDF' : 'Audio'}
                          </span>
                        </div>
                      )}
                      <button
                        type="button"
                        className="delete"
                        onClick={() => handleRemovePendingMedia(i)}
                        aria-label="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </form>

      <div className="ef-footer">
        <div className="ef-footer-inner">
          <button type="submit" form="eventForm" className="ef-btn ef-save" disabled={saving}>
            {saving ? 'Saving…' : 'Save event'}
          </button>
          <button type="button" className="ef-btn ef-cancel" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <span className="ef-req-note"><span style={{ color: 'var(--danger)' }}>*</span> required</span>
        </div>
      </div>

      {threadModal && (
        <ThreadModal
          modalState={threadModal}
          setDraft={(updater) => setThreadModal((s) => ({ ...s, draft: updater(s.draft) }))}
          onClose={() => { setThreadModal(null); setThreadErr(null) }}
          onSubmit={saveThread}
          busy={threadBusy}
          error={threadErr}
        />
      )}
    </>
  )
}
