import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { listPeople } from '../api/people'
import { listThreads } from '../api/threads'
import { listUsers } from '../api/users'
import { streamChat } from '../api/chat'
import { fetchMe, logout as apiLogout } from '../api/auth'

export const useAuthStore = create((set, get) => ({
  status: 'loading',  // 'loading' | 'authenticated' | 'unauthenticated'
  email: null,
  role: null,         // 'admin' | 'user' | null
  userId: null,
  // Populated only for Google-OAuth users. Magic-link users have nulls and
  // fall back to an initial-pill avatar.
  name: null,
  pictureUrl: null,

  check: async () => {
    console.log('[boot] useAuthStore.check() start')
    const result = await fetchMe()
    const userId = result.user_id || null
    const nextStatus = result.authenticated ? 'authenticated' : 'unauthenticated'
    console.log(`[boot] useAuthStore.check() → ${nextStatus}`, { userId, role: result.role || null })
    set({
      status: nextStatus,
      email: result.email || null,
      role: result.role || null,
      userId,
      name: result.name || null,
      pictureUrl: result.picture_url || null,
    })
    // Keep the chat scoped to the signed-in user: same user across a reload
    // keeps their history, a different user (or a fresh sign-in after sign-out)
    // gets a clean slate.
    if (result.authenticated && userId) {
      useChatStore.getState().claim(userId)
    } else {
      useChatStore.getState().reset()
    }
  },

  signOut: async () => {
    try { await apiLogout() } catch { /* clear local state regardless */ }
    set({ status: 'unauthenticated', email: null, role: null, userId: null, name: null, pictureUrl: null })
    useChatStore.getState().reset()
  },

  markUnauthorized: () => {
    if (get().status !== 'unauthenticated') {
      set({ status: 'unauthenticated', email: null, role: null, userId: null, name: null, pictureUrl: null })
      useChatStore.getState().reset()
    }
  },
}))

// Threads — per-user groupings of events. Loaded on auth; the timeline
// renders a chip + filter when there are 2+ threads. Mutators on the
// Settings page call load(true) to refresh.
export const useThreadStore = create((set, get) => ({
  threads: [],
  byId: {},
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true })
    try {
      const threads = await listThreads()
      const byId = Object.fromEntries(threads.map((t) => [t._id, t]))
      set({ threads, byId, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  invalidate: () => set({ loaded: false }),
}))

// Admin-only — lazy-loaded from the Users tab in Settings.
export const useUserStore = create((set, get) => ({
  users: [],
  loaded: false,
  loading: false,
  load: async (force = false) => {
    if (get().loading) return
    if (get().loaded && !force) return
    set({ loading: true })
    try {
      const users = await listUsers()
      set({ users, loaded: true })
    } finally {
      set({ loading: false })
    }
  },
  invalidate: () => set({ loaded: false }),
}))

// Timeline list state lives in the store so navigating to an event and back
// preserves the loaded pages and the user's scroll position. Position is
// anchored on an event _id (not a pixel offset) so it survives image-load
// height shifts. Cache is invalidated on event create/update/delete.
const DEFAULT_FILTERS = { person_ids: [], thread_ids: [] }

export const useEventStore = create((set, get) => ({
  events: [],
  filters: DEFAULT_FILTERS,
  // Bidirectional pagination. `hasMoreOlder` is the bottom edge (scroll down
  // loads older events); `hasMoreNewer` is the top edge (after a year-jump,
  // scroll up loads newer events back toward today). On a normal "page 1
  // from today" load, `hasMoreNewer` is false — we're already at the top.
  hasMoreOlder: true,
  hasMoreNewer: false,
  anchorId: null, // _id of the topmost visible event card when leaving
  loaded: false,

  setFilters: (patch) =>
    set({
      filters: { ...get().filters, ...patch },
      events: [],
      hasMoreOlder: true,
      hasMoreNewer: false,
      anchorId: null,
      loaded: false,
    }),

  setInitialPage: (events, hasMoreOlder) =>
    set({ events, hasMoreOlder, hasMoreNewer: false, loaded: true }),

  appendOlder: (page, hasMoreOlder) =>
    set({ events: [...get().events, ...page], hasMoreOlder }),

  prependNewer: (page, hasMoreNewer) =>
    set({ events: [...page, ...get().events], hasMoreNewer }),

  // Year-jump: replace the list with a window straddling the target year.
  // Caller supplies both edge flags so the top/bottom sentinels can be
  // accurate from the first paint.
  jumpToWindow: (events, hasMoreOlder, hasMoreNewer) =>
    set({
      events,
      hasMoreOlder,
      hasMoreNewer,
      anchorId: null,
      loaded: true,
    }),

  setAnchorId: (id) => set({ anchorId: id }),

  invalidate: () =>
    set({
      events: [],
      hasMoreOlder: true,
      hasMoreNewer: false,
      anchorId: null,
      loaded: false,
    }),
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
  ownerId: null,
  filter: 'all',
  streaming: false,

  setFilter: (filter) => set({ filter }),
  reset: () => set({ messages: [], streaming: false, ownerId: null }),

  // Called on every successful auth check. Wipes chat if the stored
  // owner no longer matches (different user, or post-signout state where
  // ownerId is null). Preserves chat across same-user page reloads.
  claim: (userId) => {
    if (!userId) return
    if (get().ownerId !== userId) {
      set({ messages: [], streaming: false, ownerId: userId })
    }
  },

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
    ownerId: state.ownerId,
  }),
  onRehydrateStorage: () => (state) => {
    if (!state) return
    state.streaming = false
    state.messages = (state.messages || []).map((m) =>
      m.thinking ? { ...m, thinking: false } : m
    )
  },
}))
