import { useEffect, useRef, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { FillButton, Icon } from '@/components/ui'
import type { Thread } from '@/api/types'
import { cardShadow, font, paletteColor, useTheme, type Theme } from '@/theme'

// Shared pieces for the screens inside the Account sheet (Threads, People and
// their editors): the sheet header, the palette picker, an autosave hook and
// the card / row styles the Account screen already uses.

// The backend's ALLOWED_COLORS, ordered round the colour wheel.
export const PALETTE_KEYS = ['blue', 'violet', 'cyan', 'emerald', 'lime', 'amber', 'orange', 'rose', 'fuchsia', 'slate']

// "Only you" / "Shared with 2 people" under a thread's name.
export function sharingText(thread: Thread): string {
  if (thread.visibility !== 'shared') return 'Only you'
  const n = thread.subscriber_count ?? 0
  if (n === 0) return 'Shared, not with anyone yet'
  return n === 1 ? 'Shared with 1 person' : `Shared with ${n} people`
}

// Title in the middle; a back chevron on pushed screens (none on the root,
// which has Done); an optional action on the right.
export function SheetHeader({
  title,
  back = true,
  right,
}: {
  title: string
  back?: boolean
  right?: ReactNode
}) {
  const router = useRouter()
  const t = useTheme()
  return (
    <View style={styles.header}>
      {back ? (
        <FillButton icon="chevron.left" accessibilityLabel="Back" onPress={() => router.back()} />
      ) : (
        <View style={styles.side} />
      )}
      <Text style={[styles.title, { color: t.label }]} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={styles.side} />}
    </View>
  )
}

export function ColorSwatches({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const t = useTheme()
  return (
    <View style={styles.swatches} accessibilityRole="radiogroup">
      {PALETTE_KEYS.map((key) => {
        const on = key === value
        const color = paletteColor(key, t.dark)
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="radio"
            accessibilityLabel={key}
            accessibilityState={{ checked: on }}
            style={({ pressed }) => [styles.swatchHit, pressed && { opacity: 0.6 }]}
          >
            <View style={[styles.swatchRing, on && { borderColor: color }]}>
              <View style={[styles.swatch, { backgroundColor: color }]}>
                {on ? <Icon name="checkmark" size={16} color="#FFFFFF" weight="bold" /> : null}
              </View>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

// Saves `value` `delay` ms after it stops changing, and right away if the
// screen closes with a save still pending (a back swipe mid-typing). The first
// value (what was loaded) is never saved back.
export function useAutosave<T>(value: T, save: (value: T) => void, delay = 600) {
  const latest = useRef({ value, save })
  latest.current = { value, save }
  const first = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      latest.current.save(latest.current.value)
    }, delay)
  }, [value, delay])

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        latest.current.save(latest.current.value)
      }
    },
    [],
  )
}

// The Account sheet's card + row look, shared by every screen in it.
export function makeSettingsStyles(t: Theme) {
  return StyleSheet.create({
    sheet: { flex: 1, backgroundColor: t.bg },
    body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 48, gap: 24 },
    card: { backgroundColor: t.card, borderRadius: 24, ...cardShadow(t) },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 62 },
    rowText: { flex: 1, minWidth: 0, paddingVertical: 10 },
    rowLabel: { fontFamily: font.heavy, fontSize: 16.5, color: t.label },
    rowSub: { fontFamily: font.semibold, fontSize: 14, color: t.secondary, marginTop: 2 },
    rowValue: { fontFamily: font.bold, fontSize: 15.5, color: t.secondary },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.separator, marginLeft: 16 },
    pressed: { opacity: 0.6 },
    footnote: {
      fontFamily: font.semibold,
      fontSize: 13.5,
      lineHeight: 19,
      color: t.secondary,
      marginHorizontal: 6,
      marginTop: 8,
    },
    input: {
      fontFamily: font.bold,
      fontSize: 17,
      color: t.label,
      paddingHorizontal: 16,
      height: 56,
    },
    dot: { width: 14, height: 14, borderRadius: 7 },
    danger: { height: 56, alignItems: 'center', justifyContent: 'center' },
    dangerText: { fontFamily: font.heavy, fontSize: 17, color: t.danger },
    error: { fontFamily: font.bold, fontSize: 14.5, lineHeight: 20, color: t.danger, marginHorizontal: 6 },
  })
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
    gap: 12,
  },
  side: { width: 44 },
  title: { flex: 1, textAlign: 'center', fontFamily: font.heavy, fontSize: 17 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, padding: 14 },
  swatchHit: { width: '20%', alignItems: 'center' },
  swatchRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
})
