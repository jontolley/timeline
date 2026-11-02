import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import * as SystemUI from 'expo-system-ui'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAppearanceStore } from '@/store/appearance'
import { useAuthStore } from '@/store/auth'
import { useTheme } from '@/theme'

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
  const initAppearance = useAppearanceStore((s) => s.init)
  const authed = status === 'authed'
  const t = useTheme()

  useEffect(() => {
    void initAppearance()
    void init()
  }, [init, initAppearance])

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hide()
  }, [status])

  // The root window colour shows during transitions and behind sheets; keep it
  // on the page colour so switching appearance never flashes white.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg)
  }, [t.bg])

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Protected guard={authed}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="event/new"
            options={{ presentation: 'modal', contentStyle: { backgroundColor: t.modalBg } }}
          />
          {/* Detail is a pushed card (native back swipe); edit opens over it as a modal. */}
          <Stack.Screen name="event/[id]/index" options={{ contentStyle: { backgroundColor: t.detailBg } }} />
          <Stack.Screen
            name="event/[id]/edit"
            options={{ presentation: 'modal', contentStyle: { backgroundColor: t.modalBg } }}
          />
          <Stack.Screen
            name="account"
            options={{ presentation: 'modal', contentStyle: { backgroundColor: t.modalBg } }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  )
}
