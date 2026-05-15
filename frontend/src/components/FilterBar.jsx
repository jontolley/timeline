import { colorClasses } from '../utils/colors'

export default function FilterBar({ filters, tags, people, onChange }) {
  const togglePerson = (id) => {
    const current = filters.person_ids || []
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]
    onChange({ person_ids: next })
  }

  return (
    <div className="space-y-3 mb-6">
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.event_type || ''}
          onChange={(e) => onChange({ event_type: e.target.value })}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white text-gray-700"
        >
          <option value="">All Types</option>
          <option value="career">Career</option>
          <option value="travel">Travel</option>
          <option value="milestone">Milestone</option>
          <option value="family">Family</option>
        </select>
        <select
          value={filters.tag || ''}
          onChange={(e) => onChange({ tag: e.target.value })}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white text-gray-700"
        >
          <option value="">All Tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
      </div>
      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-gray-500 mr-1">People:</span>
          {people.map((p) => {
            const c = colorClasses(p.color)
            const selected = (filters.person_ids || []).includes(p._id)
            return (
              <button
                key={p._id}
                type="button"
                onClick={() => togglePerson(p._id)}
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
          {(filters.person_ids?.length || 0) > 0 && (
            <button
              type="button"
              onClick={() => onChange({ person_ids: [] })}
              className="text-xs text-gray-500 hover:text-gray-700 underline ml-1"
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
