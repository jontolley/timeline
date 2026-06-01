import { Redirect } from 'expo-router'
import { ActivityIndicator, View } from 'react-native'
import { useAuthStore } from '../src/store/auth'
import { colors } from '../src/theme'

// Entry route: park on a spinner until init() resolves, then hand off to the
// right tree. The _layout guard keeps them there.
export default function Index() {
  const status = useAuthStore((s) => s.status)

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return <Redirect href={status === 'authed' ? '/(tabs)' : '/login'} />
}
