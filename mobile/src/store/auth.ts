import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { setAuthToken, setUnauthorizedHandler } from '../api/client'
import { fetchMe, requestCode, exchangeCode, type Me } from '../api/auth'

// The 30-day session token lives in the iOS Keychain / Android Keystore via
// expo-secure-store — never AsyncStorage (which is plaintext on disk). The last
// known user profile is cached next to it so an offline launch can still show
// who's signed in.
const TOKEN_KEY = 'hindsite_session_token'
const USER_KEY = 'hindsite_user'

export type User = { email: string; role: string; user_id: string }
export type AuthStatus = 'loading' | 'authed' | 'anon'

type AuthState = {
  status: AuthStatus
  user: User | null
  // Read the stored token on launch and validate it against /me. Registers the
  // 401 handler so any expired/revoked token mid-session bounces to login.
  init: () => Promise<void>
  // Step 1 of sign-in: email a 6-digit code.
  sendCode: (email: string) => Promise<void>
  // Step 2: exchange the code for a token, persist it, and load the user.
  verifyCode: (email: string, code: string) => Promise<void>
  signOut: () => Promise<void>
}

function toUser(me: Me, fallbackEmail = ''): User {
  return { email: me.email ?? fallbackEmail, role: me.role ?? 'user', user_id: me.user_id ?? '' }
}

async function readCachedUser(): Promise<User | null> {
  try {
    const raw = await SecureStore.getItemAsync(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

async function cacheUser(user: User) {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)).catch(() => {})
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,

  init: async () => {
    setUnauthorizedHandler(() => {
      void get().signOut()
    })
    const token = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!token) {
      set({ status: 'anon' })
      return
    }
    setAuthToken(token)
    let me: Me
    try {
      me = await fetchMe()
    } catch {
      // Offline, or the backend is down / cold-starting. Only the server can
      // say a token is bad, so keep it and let the user in on what we know;
      // a real 401 on a later request still bounces through signOut().
      set({ status: 'authed', user: await readCachedUser() })
      return
    }
    if (me.authenticated) {
      const user = toUser(me)
      await cacheUser(user)
      set({ status: 'authed', user })
    } else {
      await get().signOut()
    }
  },

  sendCode: async (email: string) => {
    await requestCode(email.trim().toLowerCase())
  },

  verifyCode: async (email: string, code: string) => {
    const normalized = email.trim().toLowerCase()
    const { token } = await exchangeCode(normalized, code.trim())
    await SecureStore.setItemAsync(TOKEN_KEY, token)
    setAuthToken(token)
    // The exchange already proved the token; a failed /me here just means we
    // fill in the profile on the next launch.
    const me = await fetchMe().catch((): Me => ({ authenticated: true, email: normalized }))
    const user = toUser(me, normalized)
    await cacheUser(user)
    set({ status: 'authed', user })
  },

  signOut: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    await SecureStore.deleteItemAsync(USER_KEY)
    setAuthToken(null)
    set({ status: 'anon', user: null })
  },
}))
