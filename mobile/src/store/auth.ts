import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'
import * as Crypto from 'expo-crypto'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { getAuthToken, setAuthToken, setUnauthorizedHandler } from '../api/client'
import {
  GOOGLE_REDIRECT,
  exchangeCode,
  fetchMe,
  googleAppExchange,
  googleStartUrl,
  logout,
  requestCode,
  type Me,
} from '../api/auth'

// The session token lives in the iOS Keychain / Android Keystore via
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
  // Google, via the web OAuth flow in a browser sheet. Resolves false if the
  // user backed out, throws with a user-facing message on failure.
  signInWithGoogle: () => Promise<boolean>
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

// PKCE (RFC 7636): only this app holds the verifier, so a one-time code that
// leaked out of the redirect is useless on its own.
async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  })
  const challenge = digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { verifier, challenge }
}

// Persist a freshly issued token and load the profile. The exchange already
// proved the token; a failed /me here just means we fill in the profile on
// the next launch.
async function completeSignIn(token: string, email: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token)
  setAuthToken(token)
  const me = await fetchMe().catch((): Me => ({ authenticated: true, email }))
  const user = toUser(me, email)
  await cacheUser(user)
  useAuthStore.setState({ status: 'authed', user })
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
    await completeSignIn(token, normalized)
  },

  signInWithGoogle: async () => {
    const { verifier, challenge } = await pkcePair()
    const result = await WebBrowser.openAuthSessionAsync(googleStartUrl(challenge), GOOGLE_REDIRECT)
    if (result.type !== 'success') return false
    const params = Linking.parse(result.url).queryParams ?? {}
    const code = typeof params.code === 'string' ? params.code : null
    if (!code) {
      if (params.error === 'cancelled') return false
      if (params.error === 'unauthorized') {
        throw new Error(
          `${params.email || 'That Google account'} isn't on the list for Hindsite yet. Ask the person who runs it to add you.`,
        )
      }
      throw new Error('Google sign-in didn’t work. Please try again.')
    }
    const { token, email } = await googleAppExchange(code, verifier)
    await completeSignIn(token, email)
    return true
  },

  signOut: async () => {
    // Revoke the session on the server, best-effort and not awaited: signing
    // out offline should still be instant, and the local copy is gone either way.
    const token = getAuthToken()
    if (token) logout(token).catch(() => {})
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    await SecureStore.deleteItemAsync(USER_KEY)
    setAuthToken(null)
    set({ status: 'anon', user: null })
  },
}))
