import { create } from 'zustand'
import { listPeople } from '../api/people'

export const useEventStore = create((set) => ({
  events: [],
  filters: { event_type: '', tag: '' },
  setEvents: (events) => set({ events }),
  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters } })),
}))

export const usePeopleStore = create((set, get) => ({
  people: [],
  peopleById: {},
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true })
    try {
      const people = await listPeople()
      const peopleById = Object.fromEntries(people.map((p) => [p._id, p]))
      set({ people, peopleById, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
}))
