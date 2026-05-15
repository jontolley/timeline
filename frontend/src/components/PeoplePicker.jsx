import { Link } from 'react-router-dom'
import { colorClasses } from '../utils/colors'

export default function PeoplePicker({ people, selectedIds, onChange }) {
  const toggle = (id) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id))
    else onChange([...selectedIds, id])
  }

  if (people.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No people yet.{' '}
        <Link to="/people" className="text-blue-600 hover:underline">
          Add some
        </Link>{' '}
        to associate with this event.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {people.map((p) => {
        const c = colorClasses(p.color)
        const selected = selectedIds.includes(p._id)
        return (
          <button
            key={p._id}
            type="button"
            onClick={() => toggle(p._id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              selected
                ? `${c.chip} border-transparent`
                : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${c.dot}`} />
            {p.name}
          </button>
        )
      })}
    </div>
  )
}
