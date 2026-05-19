import { Link } from 'react-router-dom'
import { personColor } from '../utils/colors'

export default function PeoplePicker({ people, selectedIds, onChange }) {
  const toggle = (id) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id))
    else onChange([...selectedIds, id])
  }

  if (people.length === 0) {
    return (
      <p className="small muted">
        No people yet.{' '}
        <Link to="/people" style={{ color: 'var(--accent)', borderBottom: '1px solid currentColor' }}>
          Add some
        </Link>{' '}
        to associate with this event.
      </p>
    )
  }

  return (
    <div className="people-picker">
      {people.map((p) => {
        const color = personColor(p.color)
        const selected = selectedIds.includes(p._id)
        return (
          <button
            key={p._id}
            type="button"
            className="chip chip-people"
            style={{ '--person-color': color }}
            aria-pressed={selected}
            onClick={() => toggle(p._id)}
          >
            <span className="dot" />
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
