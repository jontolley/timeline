export const EVENT_TYPES = [
  { value: 'career',    label: 'Career' },
  { value: 'travel',    label: 'Travel' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'family',    label: 'Family' },
  { value: 'adventure', label: 'Adventure' },
]

const KNOWN = new Set(EVENT_TYPES.map((t) => t.value))

export function categoryClass(type) {
  return KNOWN.has(type) ? `cat-${type}` : ''
}
