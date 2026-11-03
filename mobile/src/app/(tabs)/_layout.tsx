import { NativeTabs } from 'expo-router/native-tabs'
import { useTheme } from '@/theme'

// Mirrors the web BottomNav (Timeline / Chat). Native tabs render the system
// UITabBar (Liquid Glass on iOS 26+) with SF Symbols icons; the bar follows the
// Appearance override on its own, only the tint needs the theme.
export default function TabsLayout() {
  const t = useTheme()
  return (
    <NativeTabs tintColor={t.tintText}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'clock', selected: 'clock.fill' }} md="schedule" />
        <NativeTabs.Trigger.Label>Timeline</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'bubble.left.and.text.bubble.right', selected: 'bubble.left.and.text.bubble.right.fill' }}
          md="chat"
        />
        <NativeTabs.Trigger.Label>Chat</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
