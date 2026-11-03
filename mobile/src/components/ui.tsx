import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { SymbolView, type SFSymbol } from 'expo-symbols'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { useTheme } from '@/theme'

// Small shared building blocks for the Journal-cards design: SF Symbols,
// Liquid Glass buttons (with a translucent fallback before iOS 26), filled
// tint buttons, and the coloured icon tiles used in grouped rows.

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
// Account. 44pt is the iOS minimum touch target.
export function GlassButton({
  icon,
  label,
  onPress,
  accessibilityLabel,
  disabled,
  style,
}: {
  icon?: SFSymbol
  label?: string
  onPress: () => void
  accessibilityLabel?: string
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const shape = label ? styles.capsule : styles.circle
  const content = label ? (
    <Text style={[styles.label, { color: t.label }]}>{label}</Text>
  ) : icon ? (
    <Icon name={icon} color={t.label} />
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
        <View style={[shape, styles.center, { backgroundColor: t.glass }, styles.fallbackShadow]}>{content}</View>
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
      style={({ pressed }) => [styles.circle, styles.center, { backgroundColor: t.fill }, pressed && styles.pressed]}
    >
      <Icon name={icon} color={t.label} size={17} weight="bold" />
    </Pressable>
  )
}

export function IconTile({ icon, color, size = 30 }: { icon: SFSymbol; color: string; size?: number }) {
  return (
    <View style={[styles.center, { width: size, height: size, borderRadius: size * 0.27, backgroundColor: color }]}>
      <Icon name={icon} color="#FFFFFF" size={size * 0.56} />
    </View>
  )
}

const styles = StyleSheet.create({
  circle: { width: 44, height: 44, borderRadius: 22 },
  capsule: { height: 44, paddingHorizontal: 18, borderRadius: 22 },
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 17, fontWeight: '600' },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.4 },
  fallbackShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
})
