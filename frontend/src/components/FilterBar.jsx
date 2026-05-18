import { colorClasses } from '../utils/colors'

const TYPES = [
  { value: '',          label: 'All' },
  { value: 'career',    label: 'Career' },
  { value: 'travel',    label: 'Travel' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'family',    label: 'Family' },
]

function Pill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
        active
          ? 'bg-ink text-paper'
          : 'text-ink-mute ring-1 ring-ink-line bg-paper hover:bg-surface'
      }`}
    >
      {children}
    </button>
  )
}

export default function FilterBar({ filters, tags, people, onChange }) {
  const togglePerson = (id) => {
    const current = filters.person_ids || []
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id]
    onChange({ person_ids: next })
  }

  return (
    <div className="space-y-3 mb-8">
      <div className="flex flex-wrap items-center gap-1.5">
        {TYPES.map((t) => (
          <Pill
            key={t.value || 'all'}
            active={filters.event_type === t.value}
            onClick={() => onChange({ event_type: t.value })}
          >
            {t.label}
          </Pill>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill active={!filters.tag} onClick={() => onChange({ tag: '' })}>
            All tags
          </Pill>
          {tags.map((tag) => (
            <Pill
              key={tag}
              active={filters.tag === tag}
              onClick={() => onChange({ tag: filters.tag === tag ? '' : tag })}
            >
              #{tag}
            </Pill>
          ))}
        </div>
      )}

      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {people.map((p) => {
            const c = colorClasses(p.color)
            const selected = (filters.person_ids || []).includes(p._id)
            return (
              <button
                key={p._id}
                type="button"
                onClick={() => togglePerson(p._id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selected
                    ? `${c.chip} ring-1 ring-transparent`
                    : 'bg-paper text-ink-mute ring-1 ring-ink-line hover:bg-surface'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                {p.name}
              </button>
            )
          })}
          {(filters.person_ids?.length || 0) > 0 && (
            <button
              type="button"
              onClick={() => onChange({ person_ids: [] })}
              className="text-xs text-ink-mute hover:text-ink underline"
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  )
}
