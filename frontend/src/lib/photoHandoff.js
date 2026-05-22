// One-shot handoff for the "Event from photo" / "Photo with AI captions" flows.
// File objects (and in-flight AI promises) don't round-trip cleanly through
// history.state, so TimelineView stashes them here and EventForm consumes
// them on mount. Cleared after consume so a refresh doesn't re-attach.

let pendingFile = null
let pendingCaption = null

export function setPendingPhoto(file) {
  pendingFile = file
}

export function consumePendingPhoto() {
  const f = pendingFile
  pendingFile = null
  return f
}

export function setPendingCaption(promise) {
  pendingCaption = promise
}

export function consumePendingCaption() {
  const p = pendingCaption
  pendingCaption = null
  return p
}
