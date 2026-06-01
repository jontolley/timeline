import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '../src/store/auth'

// Root layout = the auth gate. It runs `init()` once on launch (reads the
// SecureStore token, validates against /me) and then keeps the route in sync
// with auth status: anon users can't sit on a (tabs) route, and authed users
// get bounced off the login screen. This is the documented expo-router
// protected-routes pattern.
export default function RootLayout() {
  const status = useAuthStore((s) => s.status)
  const init = useAuthStore((s) => s.init)
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (status === 'loading') return
    const inTabs = segments[0] === '(tabs)'
    if (status === 'anon' && inTabs) {
      router.replace('/login')
    } else if (status === 'authed' && !inTabs) {
      router.replace('/(tabs)')
    }
  }, [status, segments, router])

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Slot />
    </SafeAreaProvider>
  )
}
