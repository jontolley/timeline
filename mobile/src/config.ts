import Constants from 'expo-constants'

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string }

// Native clients can't use the web Vite proxy / nginx `/api` rewrite, so they
// need an absolute origin. Resolution order:
//   1. EXPO_PUBLIC_API_BASE_URL env var (set in .env for LAN dev, e.g.
//      http://192.168.1.20:8000 pointing at a local `docker compose` backend)
//   2. expo.extra.apiBaseUrl in app.json
//   3. production
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || extra.apiBaseUrl || 'https://hindsite.app'

// Every backend route is mounted under /api.
export const API = `${API_BASE_URL}/api`
