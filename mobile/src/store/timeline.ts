import { create } from 'zustand'

// Lightweight cross-screen signal: the Add-event screen bumps `refreshToken`
// on a successful create so the Timeline reloads its first page when the user
// returns, without forcing a reload on every tab switch.
type TimelineSignal = {
  refreshToken: number
  requestRefresh: () => void
}

export const useTimelineSignal = create<TimelineSignal>((set) => ({
  refreshToken: 0,
  requestRefresh: () => set((s) => ({ refreshToken: s.refreshToken + 1 })),
}))
