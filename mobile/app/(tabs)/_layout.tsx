import { Tabs } from 'expo-router'
import { Text } from 'react-native'
import { colors } from '../../src/theme'

// Mirrors the web BottomNav (Timeline / Chat). Icons are simple glyphs for now
// — swap in an icon set (e.g. @expo/vector-icons) when the design firms up.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.rule },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Timeline',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>◷</Text>,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>✦</Text>,
        }}
      />
    </Tabs>
  )
}
