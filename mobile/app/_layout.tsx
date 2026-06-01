import { useEffect } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
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
    // The only public route is the login screen. Anon users get pushed there
    // from anywhere else; authed users get pushed off it into the tabs. Other
    // authed routes (e.g. /event/new) are left alone.
    const onLogin = segments[0] === 'login'
    if (status === 'anon' && !onLogin) {
      router.replace('/login')
    } else if (status === 'authed' && onLogin) {
      router.replace('/(tabs)')
    }
  }, [status, segments, router])

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="event/new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="event/[id]" options={{ presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  )
}
