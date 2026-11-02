import { useMemo } from 'react'
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { useRouter } from 'expo-router'
import { Icon, IconTile, TintButton } from '@/components/ui'
import { useAppearanceStore, type AppearancePref } from '@/store/appearance'
import { useAuthStore } from '@/store/auth'
import { dark, light, useTheme, type Theme } from '@/theme'

// Account sheet, opened from the person button on the Timeline: who's signed
// in, the System / Light / Dark appearance picker, links, and Sign Out (kept as
// its own card at the bottom so it's hard to hit by accident).

const MODES: { pref: AppearancePref; label: string }[] = [
  { pref: 'system', label: 'System' },
  { pref: 'light', label: 'Light' },
  { pref: 'dark', label: 'Dark' },
]

// A tiny phone screen in the given palette; System shows light|dark halves.
function Preview({ pref, styles }: { pref: AppearancePref; styles: Styles }) {
  const half = (p: Theme) => (
    <View style={[styles.previewHalf, { backgroundColor: p.bg }]}>
      <View style={[styles.previewBar, { backgroundColor: p.label }]} />
      <View style={[styles.previewCard, { backgroundColor: p.card }]} />
      <View style={[styles.previewCard, { backgroundColor: p.card }]} />
    </View>
  )
  if (pref === 'system') {
    return (
      <View style={styles.previewScreen}>
        {half(light)}
        {half(dark)}
      </View>
    )
  }
  return <View style={styles.previewScreen}>{half(pref === 'dark' ? dark : light)}</View>
}

export default function AccountScreen() {
  const router = useRouter()
  const t = useTheme()
  const styles = useMemo(() => makeStyles(t), [t])
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const pref = useAppearanceStore((s) => s.pref)
  const setPref = useAppearanceStore((s) => s.setPref)

  const email = user?.email ?? ''
  const version = Constants.expoConfig?.version ?? ''

  const confirmSignOut = () => {
    Alert.alert('Sign out of Hindsite?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      // The auth guard in _layout swaps the whole tree to /login on its own.
      { text: 'Sign Out', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <View style={{ width: 44 }} />
        <Text style={styles.headerTitle}>Account</Text>
        <TintButton icon="checkmark" accessibilityLabel="Done" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.card, styles.profile]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(email[0] || '?').toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>
              {email || 'Signed in'}
            </Text>
            {user?.role === 'admin' ? <Text style={styles.sub}>Admin</Text> : null}
          </View>
        </View>

        <View>
          <Text style={styles.sectionLabel}>APPEARANCE</Text>
          <View style={[styles.card, styles.modes]} accessibilityRole="radiogroup">
            {MODES.map((m) => {
              const on = pref === m.pref
              return (
                <Pressable
                  key={m.pref}
                  style={styles.mode}
                  onPress={() => setPref(m.pref)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={m.label}
                >
                  <View style={[styles.previewFrame, on && styles.previewFrameOn]}>
                    <Preview pref={m.pref} styles={styles} />
                  </View>
                  <Text style={styles.modeLabel}>{m.label}</Text>
                  {on ? (
                    <View style={styles.radioOn}>
                      <Icon name="checkmark" size={13} color={t.onTint} weight="bold" />
                    </View>
                  ) : (
                    <View style={styles.radioOff} />
                  )}
                </Pressable>
              )
            })}
          </View>
          <Text style={styles.footnote}>
            System follows your iPhone’s Light or Dark setting, including automatic switching at sunset.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <IconTile icon="info" color="#8E8E93" />
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>{version}</Text>
          </View>
          <View style={styles.separator} />
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => void Linking.openURL('https://hindsite.app/privacy')}
          >
            <IconTile icon="hand.raised.fill" color="#34A853" />
            <Text style={styles.rowLabel}>Privacy Policy</Text>
            <Icon name="chevron.right" size={13} color={t.chevron} weight="bold" />
          </Pressable>
        </View>

        <Pressable style={({ pressed }) => [styles.card, styles.signOut, pressed && styles.pressed]} onPress={confirmSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  )
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles(t: Theme) {
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: t.modalBg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 4,
    },
    headerTitle: { fontSize: 17, fontWeight: '600', color: t.label },
    body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 48, gap: 26 },
    card: { backgroundColor: t.modalCard, borderRadius: 22, overflow: 'hidden' },
    profile: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
    avatar: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: t.tint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: t.onTint, fontSize: 24, fontWeight: '600' },
    name: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: t.label },
    sub: { fontSize: 15, color: t.secondary, marginTop: 2 },
    sectionLabel: { fontSize: 13, color: t.secondary, marginHorizontal: 16, marginBottom: 8, letterSpacing: 0.2 },
    modes: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 18, paddingBottom: 16, paddingHorizontal: 12 },
    mode: { alignItems: 'center', gap: 10, width: 96 },
    previewFrame: {
      width: 64,
      height: 112,
      borderRadius: 14,
      padding: 3,
      borderWidth: 1,
      borderColor: t.separator,
    },
    previewFrameOn: { borderWidth: 2.5, borderColor: t.tintText, padding: 1.5 },
    previewScreen: { flex: 1, borderRadius: 11, overflow: 'hidden', flexDirection: 'row' },
    previewHalf: { flex: 1, paddingTop: 14, paddingHorizontal: 5, gap: 5 },
    previewBar: { width: '70%', height: 5, borderRadius: 3, opacity: 0.85 },
    previewCard: { height: 26, borderRadius: 6 },
    modeLabel: { fontSize: 15, fontWeight: '500', color: t.label },
    radioOn: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.tint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOff: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: t.chevron },
    footnote: { fontSize: 13, lineHeight: 18, color: t.secondary, marginHorizontal: 16, marginTop: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 52 },
    rowLabel: { flex: 1, fontSize: 17, color: t.label },
    rowValue: { fontSize: 17, color: t.secondary },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.modalSeparator, marginLeft: 56 },
    pressed: { opacity: 0.6 },
    signOut: { height: 52, alignItems: 'center', justifyContent: 'center' },
    signOutText: { fontSize: 17, fontWeight: '500', color: t.danger },
  })
}
