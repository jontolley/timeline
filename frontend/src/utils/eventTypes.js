import { useCategoryStore } from '../store'
import { personColor } from './colors'

// `cat-color` keeps the existing CSS rules (which read --cat-color) working
// for any category, including user-defined ones. The color comes from the
// category's palette key looked up against the shared person/category palette.
export function categoryClass(type) {
  return type ? 'cat-color' : ''
}

export function categoryStyle(type) {
  if (!type) return undefined
  const cat = useCategoryStore.getState().byName[type]
  if (!cat) return undefined
  return { '--cat-color': personColor(cat.color) }
}

export function categoryLabel(type) {
  if (!type) return ''
  const cat = useCategoryStore.getState().byName[type]
  return cat?.label || type
}

// React hook version for components that need to re-render when categories
// change (e.g. after the user edits a label or color in Settings).
export function useEventTypes() {
  const categories = useCategoryStore((s) => s.categories)
  return categories.map((c) => ({ value: c.name, label: c.label }))
}
