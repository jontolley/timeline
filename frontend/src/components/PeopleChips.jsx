import { colorClasses } from '../utils/colors'

export default function PeopleChips({ peopleIds, peopleById, size = 'sm' }) {
  if (!peopleIds?.length) return null
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
  return (
    <div className="flex flex-wrap gap-1">
      {peopleIds.map((id) => {
        const person = peopleById[id]
        if (!person) return null
        const c = colorClasses(person.color)
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1.5 rounded-full font-medium ${c.chip} ${padding}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
            {person.name}
          </span>
        )
      })}
    </div>
  )
}
