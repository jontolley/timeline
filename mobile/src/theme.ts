import { useColorScheme } from 'react-native'

// Harbor palette for the Hindsite redesign (design-preview/01-design-direction.md):
// denim, steel blue and periwinkle on a cool paper white, with a dark variant.
// Screens read these via useTheme() and never hardcode hex.
//
// The older token names (card, fill, detail*, modal*) are kept so every screen
// keeps resolving; in Harbor the page, detail and modal backgrounds are all
// `bg`, and cards / grouped rows are all `card`.
export type Theme = {
  dark: boolean
  bg: string // page background
  card: string // cards / grouped sections on the page
  surface2: string // fields, chips, pills, placeholders
  fill: string // neutral pill / chip / secondary-button fill
  label: string // primary text
  secondary: string // metadata, captions
  body: string // long-form copy
  placeholder: string
  separator: string // hairlines inside cards
  chevron: string
  tint: string // filled buttons, bubbles, selected chips
  tintText: string // tint used as text/icon colour on the page
  onTint: string
  primarySoft: string // tinted backgrounds behind tint-coloured glyphs
  second: string // people, "shared", chat avatar
  secondSoft: string
  third: string // tags, notes, search highlights
  thirdSoft: string
  audio: string // audio player and waveform
  audioSoft: string
  waveOff: string
  danger: string
  dangerSoft: string
  glass: string // fallback for glass controls when Liquid Glass is unavailable
  overlay: string // badges over photos
  shadow: boolean // light mode lifts cards with a shadow; dark uses a hairline
  // Time-axis ribbon colours, one per season.
  spring: string
  summer: string
  autumn: string
  winter: string
  detailBg: string
  detailGroup: string
  detailChip: string
  modalBg: string
  modalCard: string
  modalSeparator: string
  photoPlaceholder: string
}

export const light: Theme = {
  dark: false,
  bg: '#EEF1F5',
  card: '#FBFCFD',
  surface2: '#DFE6EE',
  fill: '#DFE6EE',
  label: '#1F2A37',
  secondary: '#5D6A7A',
  body: '#2A3646',
  placeholder: '#8794A4',
  separator: '#D3DBE5',
  chevron: '#9AA6B5',
  tint: '#2C5A85',
  tintText: '#2C5A85',
  onTint: '#FFFFFF',
  primarySoft: '#DAE5F1',
  second: '#3F7FA0',
  secondSoft: '#D7E8F1',
  third: '#6C86B8',
  thirdSoft: '#E1E7F4',
  audio: '#4B5B9E',
  audioSoft: '#E1E4F3',
  waveOff: '#C5CBE6',
  danger: '#B8433A',
  dangerSoft: '#F4DEDB',
  glass: 'rgba(251,252,253,0.82)',
  overlay: 'rgba(255,255,255,0.94)',
  shadow: true,
  spring: '#6FB0B8',
  summer: '#3F86C9',
  autumn: '#2C5A85',
  winter: '#9CB3CC',
  detailBg: '#EEF1F5',
  detailGroup: '#FBFCFD',
  detailChip: '#DFE6EE',
  modalBg: '#EEF1F5',
  modalCard: '#FBFCFD',
  modalSeparator: '#D3DBE5',
  photoPlaceholder: '#DFE6EE',
}

export const dark: Theme = {
  dark: true,
  bg: '#121820',
  card: '#1B232D',
  surface2: '#26303C',
  fill: '#26303C',
  label: '#E6ECF3',
  secondary: '#9AA8B8',
  body: '#CBD5E1',
  placeholder: '#6B7889',
  separator: '#2F3A47',
  chevron: '#4F5B6A',
  tint: '#7FAEDB',
  tintText: '#7FAEDB',
  onTint: '#0D1B2A',
  primarySoft: '#22364B',
  second: '#7DB6D1',
  secondSoft: '#1F3540',
  third: '#A3B8E0',
  thirdSoft: '#26304A',
  audio: '#9AA6E6',
  audioSoft: '#272D4A',
  waveOff: '#343B5E',
  danger: '#F08A80',
  dangerSoft: '#3A2422',
  glass: 'rgba(27,35,45,0.82)',
  overlay: 'rgba(255,255,255,0.94)',
  shadow: false,
  spring: '#8CC8CF',
  summer: '#6FA8DE',
  autumn: '#4F7FB0',
  winter: '#B8C8DA',
  detailBg: '#121820',
  detailGroup: '#1B232D',
  detailChip: '#26303C',
  modalBg: '#121820',
  modalCard: '#1B232D',
  modalSeparator: '#2F3A47',
  photoPlaceholder: '#26303C',
}

// The effective scheme: the Appearance preference (store/appearance.ts) sets a
// native override, so useColorScheme() already reflects System/Light/Dark.
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}

// Font families, loaded in app/_layout.tsx. One typeface, Lato, for
// everything; hierarchy comes from size, weight and colour. System UI (tab
// bar, alerts, action sheets) keeps SF Pro. Each weight is its own family, so
// never combine these with `fontWeight`. Lato has no 500/600/800, so the roles
// share two weights: Bold for headlines, labels and buttons (headlines stand
// out by size), Regular for body and secondary text. The role names (`serif`,
// `heavy`…) date from the old Fraunces + Nunito pairing; they're kept so a
// later change to the type only touches this map.
export const font = {
  serif: 'Lato_700Bold',
  serifMedium: 'Lato_700Bold',
  serifItalic: 'Lato_400Regular_Italic',
  body: 'Lato_400Regular',
  bodyItalic: 'Lato_400Regular_Italic',
  semibold: 'Lato_400Regular',
  bold: 'Lato_700Bold',
  heavy: 'Lato_700Bold',
}

// Cards lift off the page with a soft shadow in light mode; in dark mode a
// hairline border does that job instead.
export function cardShadow(t: Theme) {
  return t.shadow
    ? {
        shadowColor: '#1F2A37',
        shadowOpacity: 0.08,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 5 },
      }
    : { borderWidth: 1, borderColor: t.separator }
}

export type Season = 'winter' | 'spring' | 'summer' | 'autumn'
// Northern-hemisphere meteorological seasons, from a UTC ISO date.
export function seasonOf(iso: string): Season {
  const m = Number(iso.slice(5, 7))
  if (m === 12 || m <= 2) return 'winter'
  if (m <= 5) return 'spring'
  if (m <= 8) return 'summer'
  return 'autumn'
}
export const SEASON_LABEL: Record<Season, string> = {
  winter: 'Winter',
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn',
}

// Thread/person colors are stored as palette keys ('rose', 'cyan', …), not CSS
// colors — mirror of frontend/src/utils/colors.js. Some keys happen to be valid
// RN named colors but 'rose' etc. aren't, so always resolve through here. The
// web shows its own colours for these keys; the app maps each key to a Harbor
// shade so dots and avatars sit inside the palette.
const PALETTE: Record<string, string> = {
  blue: '#2C5A85',
  rose: '#7A5C9E',
  emerald: '#2F7F7A',
  amber: '#8A7A3E',
  violet: '#4B5B9E',
  cyan: '#3F7FA0',
  orange: '#9A6A55',
  lime: '#4F8A5E',
  fuchsia: '#8E5A88',
  slate: '#5D6A7A',
}

// Lifted variants so small dots stay legible on the dark page.
const PALETTE_DARK: Record<string, string> = {
  blue: '#7FAEDB',
  rose: '#B79ADB',
  emerald: '#6FC1B8',
  amber: '#D2C17E',
  violet: '#9AA6E6',
  cyan: '#7DB6D1',
  orange: '#D9A58E',
  lime: '#8CC79A',
  fuchsia: '#D49ACB',
  slate: '#9AA8B8',
}

export function paletteColor(key: string | null | undefined, isDark = false): string {
  const p = isDark ? PALETTE_DARK : PALETTE
  return (key && p[key]) || p.slate
}

// Stable colour for a person avatar when we only know their name.
const AVATAR_KEYS = ['rose', 'cyan', 'orange', 'violet', 'emerald', 'amber', 'fuchsia', 'blue']
export function avatarColor(name: string, isDark = false): string {
  return paletteColor(avatarKey(name), isDark)
}
// The palette key behind avatarColor: what a person added in the app is saved
// with (the backend requires a palette colour), so web and app agree.
export function avatarKey(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return AVATAR_KEYS[Math.abs(h) % AVATAR_KEYS.length]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
