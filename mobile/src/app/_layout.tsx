import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAuthStore } from '@/store/auth'

// Keep the native splash up until init() has read the Keychain token and
// validated it, so the user never sees the login screen flash on launch.
void SplashScreen.preventAutoHideAsync()

// Root layout = the auth gate. `init()` runs once on launch; after that the
// Stack.Protected guards keep the route tree in sync with auth status: anon
// users can only reach /login, and authed users can't sit on it. When a guard
// flips, expo-router redirects to the first available screen and drops the
// now-forbidden history entries.
export default function RootLayout() {
  const status = useAuthStore((s) => s.status)
  const init = useAuthStore((s) => s.init)
  const authed = status === 'authed'

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hide()
  }, [status])

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={authed}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="event/new" options={{ presentation: 'modal' }} />
          {/* Detail is a pushed card (native back swipe); edit opens over it as a modal. */}
          <Stack.Screen name="event/[id]/index" />
          <Stack.Screen name="event/[id]/edit" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  )
}
