// One-shot handoff for the "Event from photo" flow.
// File objects don't round-trip cleanly through history.state, so the
// TimelineView stashes the picked File here and the EventForm consumes it
// on mount. Cleared after consume so a refresh doesn't re-attach it.

let pending = null

export function setPendingPhoto(file) {
  pending = file
}

export function consumePendingPhoto() {
  const f = pending
  pending = null
  return f
}
