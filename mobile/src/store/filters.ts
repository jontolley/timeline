import { create } from 'zustand'

// Timeline + search filters, shared by the Filters sheet, the Timeline and the
// Search screen (the phone version of the web FilterModal). `sortBy` is a sort,
// not a filter: it isn't counted as active and survives Clear.
export type SortBy = 'date' | 'created_at'

export type Filters = {
  personIds: string[]
  threadIds: string[]
  sortBy: SortBy
}

type FilterState = {
  filters: Filters
  setFilters: (f: Filters) => void
  clear: () => void
}

export const EMPTY_FILTERS: Filters = { personIds: [], threadIds: [], sortBy: 'date' }

export const useFilterStore = create<FilterState>((set) => ({
  filters: EMPTY_FILTERS,
  setFilters: (filters) => set({ filters }),
  clear: () => set((s) => ({ filters: { ...EMPTY_FILTERS, sortBy: s.filters.sortBy } })),
}))

export function activeFilterCount(f: Filters): number {
  return f.personIds.length + f.threadIds.length
}

// Query params for GET /events, /events/years and /events/search.
export function filterParams(f: Filters): Record<string, unknown> {
  return {
    person_id: f.personIds,
    thread_id: f.threadIds,
    sort_by: f.sortBy === 'created_at' ? 'created_at' : undefined,
  }
}

// The value the list is ordered and grouped by. A legacy event with no
// created_at falls back to its date.
export function sortDateOf(ev: { date: string; created_at?: string | null }, sortBy: SortBy): string {
  return sortBy === 'created_at' && ev.created_at ? ev.created_at : ev.date
}
