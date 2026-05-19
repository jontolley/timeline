import { personColor, personInitials } from '../utils/colors'

export default function PeopleChips({ peopleIds, peopleById }) {
  if (!peopleIds?.length) return null
  return (
    <>
      {peopleIds.map((id) => {
        const person = peopleById[id]
        if (!person) return null
        const color = personColor(person.color)
        return (
          <span
            key={id}
            className="person"
            style={{ '--person-color': color }}
          >
            <span className="person-avatar" style={{ background: color }}>
              {personInitials(person.name)}
            </span>
            {person.name}
          </span>
        )
      })}
    </>
  )
}
