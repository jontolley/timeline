import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import { setAuthToken, setUnauthorizedHandler } from '../api/client'
import { fetchMe, requestCode, exchangeCode } from '../api/auth'

// The 30-day session token lives in the iOS Keychain / Android Keystore via
// expo-secure-store — never AsyncStorage (which is plaintext on disk).
const TOKEN_KEY = 'hindsite_session_token'

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
    const me = await fetchMe()
    if (me.authenticated) {
      set({
        status: 'authed',
        user: { email: me.email!, role: me.role ?? 'user', user_id: me.user_id ?? '' },
      })
    } else {
      await SecureStore.deleteItemAsync(TOKEN_KEY)
      setAuthToken(null)
      set({ status: 'anon', user: null })
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
    const me = await fetchMe()
    set({
      status: 'authed',
      user: {
        email: me.email ?? normalized,
        role: me.role ?? 'user',
        user_id: me.user_id ?? '',
      },
    })
  },

  signOut: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    setAuthToken(null)
    set({ status: 'anon', user: null })
  },
}))
