import { useEffect, useState } from 'react'
import Modal from './Modal'
import { personColor } from '../utils/colors'
import { useEventTypes } from '../utils/eventTypes'
import { useThreadStore } from '../store'

/**
 * Filter modal opened from the timeline toolbar. Manages a draft copy of the
 * filter state and applies it on "Show results" so the user can cancel without
 * committing. Same selection semantics as the inline FilterBar — only the
 * presentation changes.
 */
export default function FilterModal({ open, filters, people, onClose, onApply }) {
  const [draft, setDraft] = useState(() => ({
    event_type: filters.event_type ?? '',
    person_ids: [...(filters.person_ids ?? [])],
    thread_ids: [...(filters.thread_ids ?? [])],
  }))
  // Sync draft to current filters whenever the modal opens. Otherwise the
  // useState initializer above only runs once on first mount, so if filters
  // change externally (e.g. via the empty-state "Clear filters" button) the
  // modal would still show the old draft the next time it opens.
  useEffect(() => {
    if (!open) return
    setDraft({
      event_type: filters.event_type ?? '',
      person_ids: [...(filters.person_ids ?? [])],
      thread_ids: [...(filters.thread_ids ?? [])],
    })
  }, [open, filters])
  const types = useEventTypes()
  const threads = useThreadStore((s) => s.threads)
  const categories = [{ value: '', label: 'All' }, ...types]

  if (!open) return null

  const togglePerson = (id) => setDraft((d) => ({
    ...d,
    person_ids: d.person_ids.includes(id)
      ? d.person_ids.filter((x) => x !== id)
      : [...d.person_ids, id],
  }))
  const toggleThread = (id) => setDraft((d) => ({
    ...d,
    thread_ids: d.thread_ids.includes(id)
      ? d.thread_ids.filter((x) => x !== id)
      : [...d.thread_ids, id],
  }))
  const setCategory = (value) => setDraft((d) => ({ ...d, event_type: value }))

  const activeCount =
    (draft.event_type ? 1 : 0) +
    draft.person_ids.length +
    draft.thread_ids.length

  const reset = () => setDraft({ event_type: '', person_ids: [], thread_ids: [] })
  const apply = () => { onApply(draft); onClose() }

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Filter · timeline"
      title="Narrow"
      titleEm="the view."
      sub="Combine categories, threads, and people. Filters apply across the whole timeline."
      primary={
        <button type="button" className="btn btn-accent" onClick={apply}>
          {activeCount === 0 ? 'Show all' : `Show ${activeCount === 1 ? '1 filter' : `${activeCount} filters`}`}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={reset} disabled={activeCount === 0}>
          Clear
        </button>
      }
    >
      <div className="field">
        <div className="field-label"><span>Category</span></div>
        <div className="filter-row" style={{ flexWrap: 'wrap' }}>
          {categories.map((c) => (
            <button
              key={c.value || 'all'}
              type="button"
              className="chip"
              aria-pressed={draft.event_type === c.value}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {threads.length > 1 && (
        <div className="field">
          <div className="field-label"><span>Threads</span></div>
          <div className="filter-row" style={{ flexWrap: 'wrap' }}>
            {threads.map((t) => {
              const color = personColor(t.color)
              const selected = draft.thread_ids.includes(t._id)
              return (
                <button
                  key={t._id}
                  type="button"
                  className="chip chip-people"
                  style={{ '--person-color': color }}
                  aria-pressed={selected}
                  onClick={() => toggleThread(t._id)}
                >
                  <span className="dot" />
                  {t.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {people.length > 0 && (
        <div className="field">
          <div className="field-label"><span>People</span></div>
          <div className="filter-row" style={{ flexWrap: 'wrap' }}>
            {people.map((p) => {
              const color = personColor(p.color)
              const selected = draft.person_ids.includes(p._id)
              return (
                <button
                  key={p._id}
                  type="button"
                  className="chip chip-people"
                  style={{ '--person-color': color }}
                  aria-pressed={selected}
                  onClick={() => togglePerson(p._id)}
                >
                  <span className="dot" />
                  {p.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
