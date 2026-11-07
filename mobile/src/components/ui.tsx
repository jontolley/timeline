import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { avatarColor, font, initials, useTheme, type Theme } from '@/theme'

// Shared building blocks for the Hindsite redesign: SF Symbols, Liquid Glass
// buttons (with a translucent fallback before iOS 26), filled tint buttons,
// round tinted row icons, avatars, the decorative waveform and skeletons.

const GLASS = isLiquidGlassAvailable()

export function Icon({
  name,
  size = 20,
  color,
  weight = 'semibold',
}: {
  name: SFSymbol
  size?: number
  color: string
  weight?: 'regular' | 'medium' | 'semibold' | 'bold'
}) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} style={{ width: size, height: size }} />
}

// A round (or capsule, when `label` is set) glass control, e.g. Back / Share /
// Search. 44pt is the iOS minimum touch target. `onPhoto` keeps the glyph white
// over a photo hero.
export function GlassButton({
  icon,
  label,
  onPress,
  accessibilityLabel,
  disabled,
  size = 44,
  onPhoto,
  style,
}: {
  icon?: SFSymbol
  label?: string
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
  size?: number
  onPhoto?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  // Liquid Glass adapts to what's behind it, so its ink stays the label color;
  // only the fallback's dark scrim needs white.
  const ink = onPhoto && !GLASS ? '#FFFFFF' : t.label
  const shape = label
    ? { height: size, paddingHorizontal: 18, borderRadius: size / 2 }
    : { width: size, height: size, borderRadius: size / 2 }
  const content = label ? (
    <Text style={[styles.label, { color: ink }]}>{label}</Text>
  ) : icon ? (
    <Icon name={icon} color={ink} size={size * 0.43} />
  ) : null
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [pressed && !GLASS && styles.pressed, disabled && styles.disabled, style]}
    >
      {GLASS ? (
        <GlassView isInteractive style={[shape, styles.center]}>
          {content}
        </GlassView>
      ) : (
        <View
          style={[
            shape,
            styles.center,
            { backgroundColor: onPhoto ? 'rgba(0,0,0,0.28)' : t.glass },
            styles.fallbackShadow,
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  )
}

// The filled accent circle (＋ New, ✓ Save, ↑ Send).
export function TintButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled,
  size = 44,
  children,
}: {
  icon: SFSymbol
  onPress: () => void
  accessibilityLabel: string
  disabled?: boolean
  size?: number
  children?: ReactNode
}) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.center,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: t.tint },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {children ?? <Icon name={icon} color={t.onTint} size={size * 0.42} weight="bold" />}
    </Pressable>
  )
}

// Neutral filled circle (✕ Cancel in sheets, where glass would sit on a flat
// sheet background and read as nothing).
export function FillButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled,
}: {
  icon: SFSymbol
  onPress: () => void
  accessibilityLabel: string
  disabled?: boolean
}) {
  const t = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.circle, styles.center, { backgroundColor: t.surface2 }, pressed && styles.pressed]}
    >
      <Icon name={icon} color={t.label} size={17} weight="bold" />
    </Pressable>
  )
}

// Capsule text button: primary (filled tint), secondary (card), tonal (soft tint).
export function Button({
  label,
  icon,
  onPress,
  variant = 'primary',
  small,
  disabled,
  loading,
  style,
  children,
}: {
  label: string
  icon?: SFSymbol
  onPress: () => void
  variant?: 'primary' | 'secondary' | 'tonal'
  small?: boolean
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  children?: ReactNode
}) {
  const t = useTheme()
  const bg = variant === 'primary' ? t.tint : variant === 'tonal' ? t.primarySoft : t.card
  const ink = variant === 'primary' ? t.onTint : variant === 'tonal' ? t.tintText : t.label
  const h = small ? 44 : 54
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        { height: h, borderRadius: h / 2, backgroundColor: bg, paddingHorizontal: small ? 18 : 22 },
        variant === 'secondary' && t.shadow && styles.softShadow,
        variant === 'secondary' && !t.shadow && { borderWidth: 1, borderColor: t.separator },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {children ?? (icon ? <Icon name={icon} size={small ? 16 : 18} color={ink} weight="bold" /> : null)}
          <Text style={[styles.buttonText, { color: ink, fontSize: small ? 16 : 17 }]}>{label}</Text>
        </>
      )}
    </Pressable>
  )
}

export type Tone = 'primary' | 'second' | 'third' | 'audio' | 'neutral' | 'danger'

export function toneColors(t: Theme, tone: Tone): { bg: string; fg: string } {
  switch (tone) {
    case 'second':
      return { bg: t.secondSoft, fg: t.second }
    case 'third':
      return { bg: t.thirdSoft, fg: t.third }
    case 'audio':
      return { bg: t.audioSoft, fg: t.audio }
    case 'neutral':
      return { bg: t.surface2, fg: t.secondary }
    case 'danger':
      return { bg: t.dangerSoft, fg: t.danger }
    default:
      return { bg: t.primarySoft, fg: t.tintText }
  }
}

// The round tinted badge that leads a grouped row (Place, People, Tags…).
export function RowIcon({ icon, tone = 'primary', size = 38 }: { icon: SFSymbol; tone?: Tone; size?: number }) {
  const t = useTheme()
  const c = toneColors(t, tone)
  return (
    <View style={[styles.center, { width: size, height: size, borderRadius: size / 2, backgroundColor: c.bg }]}>
      <Icon name={icon} color={c.fg} size={size * 0.47} />
    </View>
  )
}

// A person's initial in their colour. `ring` matches the surface behind a stack.
export function Avatar({
  name,
  color,
  size = 28,
  ring,
  style,
}: {
  name: string
  color?: string
  size?: number
  ring?: string
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color ?? avatarColor(name, t.dark),
        },
        ring ? { borderWidth: 2, borderColor: ring } : null,
        style,
      ]}
    >
      <Text style={{ fontFamily: font.heavy, fontSize: Math.round(size * 0.4), color: t.dark ? '#0D1B2A' : '#FFFFFF' }}>
        {initials(name).slice(0, size < 30 ? 1 : 2)}
      </Text>
    </View>
  )
}

export function AvatarStack({ names, size = 26, ring, max = 3 }: { names: string[]; size?: number; ring: string; max?: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {names.slice(0, max).map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size={size} ring={ring} style={i > 0 ? { marginLeft: -8 } : null} />
      ))}
    </View>
  )
}

// Decorative waveform bars. Deterministic per `seed`, so a card always draws the
// same shape; `progress` (0–1) colours the bars already played.
export function Waveform({
  seed = 7,
  bars = 30,
  progress = 0,
  height = 34,
  on,
  off,
  levels,
}: {
  seed?: number
  bars?: number
  progress?: number
  height?: number
  on: string
  off: string
  // Live meter levels (0–1), newest last; overrides the seeded shape.
  levels?: number[]
}) {
  const heights: number[] = []
  if (levels) {
    for (let i = 0; i < bars; i++) heights.push(Math.max(0.12, levels[levels.length - bars + i] ?? 0.12))
  } else {
    let s = seed
    for (let i = 0; i < bars; i++) {
      s = (s * 9301 + 49297) % 233280
      const env = Math.sin((Math.PI * (i + 0.5)) / bars) * 0.55 + 0.45
      heights.push(Math.max(0.14, (0.2 + (s / 233280) * 0.8) * env))
    }
  }
  return (
    <View style={[styles.wave, { height }]}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: `${Math.round(h * 100)}%` as DimensionValue,
            borderRadius: 3,
            backgroundColor: levels ? on : i < progress * bars ? on : off,
          }}
        />
      ))}
    </View>
  )
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce)
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => sub.remove()
  }, [])
  return reduce
}

// A placeholder block that gently pulses while content loads (static under
// Reduce Motion).
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme()
  const reduce = useReduceMotion()
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduce) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, reduce])
  return <Animated.View style={[{ backgroundColor: t.surface2, borderRadius: 10, opacity: pulse }, style]} />
}

// Centered icon + serif title + text (+ an optional action), for empty, error
// and no-results states.
export function EmptyState({
  icon,
  title,
  text,
  tone = 'primary',
  children,
  style,
}: {
  icon: SFSymbol
  title: string
  text?: string
  tone?: Tone
  children?: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = toneColors(t, tone)
  return (
    <View style={[styles.empty, style]}>
      <View style={[styles.center, styles.emptyIcon, { backgroundColor: c.bg }]}>
        <Icon name={icon} size={36} color={c.fg} weight="regular" />
      </View>
      <Text style={[styles.emptyTitle, { color: t.label }]}>{title}</Text>
      {text ? <Text style={[styles.emptyText, { color: t.secondary }]}>{text}</Text> : null}
      {children}
    </View>
  )
}

export function SectionLabel({ children }: { children: string }) {
  const t = useTheme()
  return <Text style={[styles.section, { color: t.secondary }]}>{children.toUpperCase()}</Text>
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22 },
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontFamily: font.heavy },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  fallbackShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  softShadow: {
    shadowColor: '#1F2A37',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontFamily: font.heavy },
  wave: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 2.5 },
  empty: { alignItems: 'center', paddingHorizontal: 34, gap: 10 },
  emptyIcon: { width: 84, height: 84, borderRadius: 42, marginBottom: 6 },
  emptyTitle: { fontFamily: font.serif, fontSize: 25, lineHeight: 30, textAlign: 'center' },
  emptyText: { fontFamily: font.semibold, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  section: { fontFamily: font.heavy, fontSize: 12, letterSpacing: 1, paddingHorizontal: 6, marginBottom: 8 },
})
