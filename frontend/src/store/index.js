import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { listCategories } from '../api/categories'
import { listPeople } from '../api/people'
import { streamChat } from '../api/chat'
import { fetchMe, logout as apiLogout } from '../api/auth'

export const useAuthStore = create((set, get) => ({
  status: 'loading',  // 'loading' | 'authenticated' | 'unauthenticated'
  email: null,

  check: async () => {
    const result = await fetchMe()
    set({
      status: result.authenticated ? 'authenticated' : 'unauthenticated',
      email: result.email || null,
    })
  },

  signOut: async () => {
    try { await apiLogout() } catch { /* clear local state regardless */ }
    set({ status: 'unauthenticated', email: null })
  },

  markUnauthorized: () => {
    if (get().status !== 'unauthenticated') {
      set({ status: 'unauthenticated', email: null })
    }
  },
}))

// Timeline list state lives in the store so navigating to an event and back
// preserves the loaded pages and the user's scroll position. Position is
// anchored on an event _id (not a pixel offset) so it survives image-load
// height shifts. Cache is invalidated on event create/update/delete.
const DEFAULT_FILTERS = { event_type: '', person_ids: [] }

export const useEventStore = create((set, get) => ({
  events: [],
  filters: DEFAULT_FILTERS,
  hasMore: true,
  anchorId: null, // _id of the topmost visible event card when leaving
  loaded: false,

  setFilters: (patch) =>
    set({
      filters: { ...get().filters, ...patch },
      events: [],
      hasMore: true,
      anchorId: null,
      loaded: false,
    }),

  setInitialPage: (events, hasMore) => set({ events, hasMore, loaded: true }),

  appendPage: (page, hasMore) =>
    set({ events: [...get().events, ...page], hasMore }),

  setAnchorId: (id) => set({ anchorId: id }),

  invalidate: () =>
    set({ events: [], hasMore: true, anchorId: null, loaded: false }),
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

// Categories drive event_type slugs + colors on the timeline. Loaded once
// per session; consumers call `load()` from a useEffect and read the list /
// byName lookup. Mutators on the Settings page call `invalidate()` then
// re-`load(true)` so changes flow through immediately.
export const useCategoryStore = create((set, get) => ({
  categories: [],
  byName: {},
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true })
    try {
      const categories = await listCategories()
      const byName = Object.fromEntries(categories.map((c) => [c.name, c]))
      set({ categories, byName, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  invalidate: () => set({ loaded: false }),
}))

// Chat session lives in the store (not component state) so it persists when
// the user navigates away from /chat and back. Streaming continues in the
// background — callbacks write to the store via get(), so updates land
// regardless of whether ChatView is mounted.
function toApiMessages(messages) {
  return messages
    .filter((m) => m.content)
    .map((m) => ({ role: m.role, content: m.content }))
}

export const useChatStore = create(persist((set, get) => ({
  messages: [],
  filter: 'all',
  streaming: false,

  setFilter: (filter) => set({ filter }),
  reset: () => set({ messages: [], streaming: false }),

  _appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  _updateLast: (patch) =>
    set((s) => {
      if (s.messages.length === 0) return s
      const updated = [...s.messages]
      updated[updated.length - 1] = { ...updated[updated.length - 1], ...patch }
      return { messages: updated }
    }),

  _updateAt: (index, patch) =>
    set((s) => {
      if (index < 0 || index >= s.messages.length) return s
      const updated = [...s.messages]
      updated[index] = { ...updated[index], ...patch }
      return { messages: updated }
    }),

  _appendToken: (token) =>
    set((s) => {
      if (s.messages.length === 0) return s
      const updated = [...s.messages]
      const last = updated[updated.length - 1]
      updated[updated.length - 1] = {
        ...last,
        content: last.content + token,
        thinking: false,
      }
      return { messages: updated }
    }),

  _run: async (history, action = null) => {
    const { filter } = get()
    get()._appendMessage({
      role: 'assistant',
      content: '',
      sources: [],
      thinking: true,
      eventAction: null,
      pendingEdit: null,
    })
    set({ streaming: true })

    try {
      await streamChat(history, filter, {
        onSources: (sources) => get()._updateLast({ sources }),
        onToken: (token) => get()._appendToken(token),
        onEventCreated: (event) =>
          get()._updateLast({ eventAction: { type: 'created', event } }),
        onEventUpdated: (event) =>
          get()._updateLast({ eventAction: { type: 'updated', event } }),
        onPendingEdit: (data) =>
          get()._updateLast({
            pendingEdit: {
              target: data.target,
              alternatives: data.alternatives || [],
              changes: data.changes || {},
              status: 'awaiting',
            },
            thinking: false,
          }),
        onDone: () => {
          set({ streaming: false })
          get()._updateLast({ thinking: false })
        },
      }, action)
    } catch (err) {
      set({ streaming: false })
      get()._updateLast({
        thinking: false,
        content: 'Sorry, something went wrong while streaming the response.',
      })
    }
  },

  sendMessage: async (text) => {
    const q = text.trim()
    if (!q || get().streaming) return
    get()._appendMessage({ role: 'user', content: q })
    await get()._run(toApiMessages(get().messages))
  },

  confirmPendingEdit: async (messageIndex, eventId, changes, label) => {
    if (get().streaming) return
    const msg = get().messages[messageIndex]
    if (!msg?.pendingEdit) return
    get()._updateAt(messageIndex, {
      pendingEdit: { ...msg.pendingEdit, status: 'confirmed' },
    })
    get()._appendMessage({ role: 'user', content: label })
    await get()._run(toApiMessages(get().messages), {
      type: 'confirm_edit',
      event_id: eventId,
      changes,
    })
  },

  cancelPendingEdit: (messageIndex) => {
    const msg = get().messages[messageIndex]
    if (!msg?.pendingEdit) return
    get()._updateAt(messageIndex, {
      pendingEdit: { ...msg.pendingEdit, status: 'cancelled' },
    })
  },
}), {
  name: 'timeline-chat',
  storage: createJSONStorage(() => localStorage),
  // Persist only what's safe to restore. `streaming` and any in-flight
  // `thinking` flag would otherwise come back stuck if the user reloaded
  // mid-stream — onRehydrateStorage scrubs those.
  partialize: (state) => ({
    messages: state.messages,
  }),
  onRehydrateStorage: () => (state) => {
    if (!state) return
    state.streaming = false
    state.messages = (state.messages || []).map((m) =>
      m.thinking ? { ...m, thinking: false } : m
    )
  },
}))
