import { Stack } from 'expo-router'
import { useTheme } from '@/theme'

// The Account sheet is its own stack, so Threads, People and their editors
// push inside the sheet (native back swipe) instead of opening more modals.
export default function AccountLayout() {
  const t = useTheme()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
}
