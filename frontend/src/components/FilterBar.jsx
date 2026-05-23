import { personColor } from '../utils/colors'
import { useEventTypes } from '../utils/eventTypes'

export default function FilterBar({ filters, people, onChange }) {
  const types = useEventTypes()
  const CATEGORIES = [{ value: '', label: 'All' }, ...types]
  const togglePerson = (id) => {
    const current = filters.person_ids || []
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]
    onChange({ person_ids: next })
  }

  return (
    <div className="filters">
      <div className="filter-row">
        <span className="filter-label">Category</span>
        {CATEGORIES.map((c) => (
          <button
            key={c.value || 'all'}
            type="button"
            className="chip"
            aria-pressed={filters.event_type === c.value}
            onClick={() => onChange({ event_type: c.value })}
          >
            {c.label}
          </button>
        ))}
      </div>

      {people.length > 0 && (
        <div className="filter-row">
          <span className="filter-label">People</span>
          {people.map((p) => {
            const color = personColor(p.color)
            const selected = (filters.person_ids || []).includes(p._id)
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
          {(filters.person_ids?.length || 0) > 0 && (
            <button
              type="button"
              className="chip-clear"
              onClick={() => onChange({ person_ids: [] })}
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
