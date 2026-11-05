// Set when the app is cold-launched from the share sheet. That first URL
// (/event/new?shared=1) arrives while the auth gate is still loading and hides
// New Moment, so expo-router falls back to the Timeline; the root layout takes
// this flag once signed in and opens New Moment itself.
let pending = false

export function markShareLaunch() {
  pending = true
}

export function takeShareLaunch(): boolean {
  const was = pending
  pending = false
  return was
}
