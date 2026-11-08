import { useEffect } from 'react'
import { Stack, usePathname, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import { Fraunces_500Medium } from '@expo-google-fonts/fraunces/500Medium'
import { Fraunces_500Medium_Italic } from '@expo-google-fonts/fraunces/500Medium_Italic'
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold'
import { Nunito_400Regular } from '@expo-google-fonts/nunito/400Regular'
import { Nunito_400Regular_Italic } from '@expo-google-fonts/nunito/400Regular_Italic'
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold'
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold'
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold'
import * as SystemUI from 'expo-system-ui'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useAppearanceStore } from '@/store/appearance'
import { useAuthStore } from '@/store/auth'
import { takeShareLaunch } from '@/lib/shareLaunch'
import { useTheme } from '@/theme'

// Keep the native splash up until init() has read the Keychain token and
// validated it, so the user never sees the login screen flash on launch.
void SplashScreen.preventAutoHideAsync()

// Expo Router's stock boundary: a render error shows an error screen with
// Retry instead of crashing — in Release builds an uncaught JS error aborts.
export { ErrorBoundary } from 'expo-router'

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
  const router = useRouter()
  const pathname = usePathname()
  // A font that fails to load falls back to the system font, so an error
  // counts as done rather than holding the splash forever.
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_500Medium,
    Fraunces_500Medium_Italic,
    Fraunces_600SemiBold,
    Nunito_400Regular,
    Nunito_400Regular_Italic,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  })
  const fontsReady = fontsLoaded || !!fontError

  useEffect(() => {
    void initAppearance()
    void init()
  }, [init, initAppearance])

  useEffect(() => {
    if (status !== 'loading' && fontsReady) SplashScreen.hide()
  }, [status, fontsReady])

  // A cold launch from the share sheet can land on the Timeline instead of New
  // Moment (the launch URL is resolved before we're signed in); open it now
  // that we are. Wait until the gate is off /login — pushing earlier gets
  // reset by its redirect. If it did land on New Moment, this just clears the flag.
  useEffect(() => {
    if (authed && pathname !== '/login' && takeShareLaunch() && pathname !== '/event/new') {
      router.push('/event/new?shared=1')
    }
  }, [authed, pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // The root window colour shows during transitions and behind sheets; keep it
  // on the page colour so switching appearance never flashes white.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(t.bg)
  }, [t.bg])

  // Don't mount the navigator until init() knows whether we're signed in.
  // While status is 'loading' the guards below would leave /login as the only
  // route, so it would mount under the splash and its autoFocus would raise
  // the keyboard — a window above the splash — and then the Timeline would
  // slide in over it once init() finished. Mounting late, the first screen is
  // already the right one.
  if (!fontsReady || status === 'loading') return null

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
          <Stack.Screen name="search" options={{ animation: 'fade' }} />
          {/* A document gets the whole screen to read in; Done closes it. */}
          <Stack.Screen name="pdf" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen
            name="filters"
            options={{
              presentation: 'formSheet',
              sheetAllowedDetents: [0.75, 1],
              sheetGrabberVisible: true,
              sheetCornerRadius: 28,
              contentStyle: { backgroundColor: t.bg },
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!authed}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  )
}
