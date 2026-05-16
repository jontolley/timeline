import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { getEvent, createEvent, updateEvent } from '../api/events'
import TagInput from '../components/TagInput'
import LocationPicker from '../components/LocationPicker'
import PeoplePicker from '../components/PeoplePicker'
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

export default function EventForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const { people, loaded: peopleLoaded, load: loadPeople } = usePeopleStore()

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
        await createEvent(payload)
        navigate('/')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-gray-400 py-12 text-center">Loading...</p>

  return (
    <div className="max-w-2xl">
      <Link to={id ? `/events/${id}` : '/'} className="text-blue-600 hover:underline text-sm mb-4 block">
        &larr; {id ? 'Back to Event' : 'Back to Timeline'}
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {id ? 'Edit Event' : 'New Event'}
      </h1>
      {error && (
        <p className="text-red-600 text-sm mb-4 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            required
            value={form.title}
            onChange={set('title')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Type <span className="text-red-500">*</span>
          </label>
          <select
            value={form.event_type}
            onChange={set('event_type')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="career">Career</option>
            <option value="travel">Travel</option>
            <option value="milestone">Milestone</option>
            <option value="family">Family</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="date"
            value={form.date}
            onChange={set('date')}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="includeTime"
            checked={form.includeTime}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                includeTime: e.target.checked,
                time: e.target.checked ? f.time : '',
              }))
            }
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="includeTime" className="text-sm text-gray-700 select-none">
            Include time
          </label>
        </div>

        {form.includeTime && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
            <input
              type="time"
              value={form.time}
              onChange={set('time')}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="includeEndDate"
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
            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="includeEndDate" className="text-sm text-gray-700 select-none">
            Include end date
          </label>
        </div>

        {form.includeEndDate && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={set('end_date')}
                min={form.date || undefined}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="includeEndTime"
                checked={form.includeEndTime}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    includeEndTime: e.target.checked,
                    end_time: e.target.checked ? f.end_time : '',
                  }))
                }
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="includeEndTime" className="text-sm text-gray-700 select-none">
                Include end time
              </label>
            </div>
            {form.includeEndTime && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="time"
                  value={form.end_time}
                  onChange={set('end_time')}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <LocationPicker
            value={form.location}
            onChange={(loc) => setForm((f) => ({ ...f, location: loc }))}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={set('description')}
            rows={3}
            spellCheck="true"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
          <TagInput
            tags={form.tags}
            onChange={(tags) => setForm((f) => ({ ...f, tags }))}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">People</label>
          <p className="text-xs text-gray-500 mb-2">Leave empty for events not tied to a specific person.</p>
          <PeoplePicker
            people={people}
            selectedIds={form.people}
            onChange={(ids) => setForm((f) => ({ ...f, people: ids }))}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Event'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
