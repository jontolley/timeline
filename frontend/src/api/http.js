// Shared fetch wrapper. Sends cookies on every request so the session cookie
// reaches the backend, and surfaces 401s as a synthetic event the auth store
// listens to so the UI can drop straight back to the login screen.
export async function http(url, options = {}) {
  const res = await fetch(url, { ...options, credentials: 'include' })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'))
    throw new Error('Unauthorized')
  }
  return res
}
