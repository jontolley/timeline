import { create } from 'zustand'

export const useEventStore = create((set) => ({
  events: [],
  filters: { event_type: '', tag: '' },
  setEvents: (events) => set({ events }),
  setFilters: (filters) =>
    set((state) => ({ filters: { ...state.filters, ...filters } })),
}))
