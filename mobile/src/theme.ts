import { useColorScheme } from 'react-native'

// iOS-native palettes for the "Journal cards" redesign. Light follows the
// system grouped-background look; dark is softened on purpose (charcoal, not
// pure black; off-white, not pure white) to cut glare — see the Hindsite iOS
// Redesign canvas. Screens read these via useTheme() and never hardcode hex.
//
// The `detail*` and `modal*` groups exist because iOS layers surfaces
// differently per mode: in light the detail sheet is white with grey groups,
// in dark the sheet is the page colour with raised groups; modals in dark are
// a step lighter than the page underneath.
export type Theme = {
  dark: boolean
  bg: string // page background
  card: string // cards / grouped sections on the page
  fill: string // neutral pill / chip / secondary-button fill
  label: string // primary text
  secondary: string // metadata, captions
  body: string // long-form copy
  placeholder: string
  separator: string
  chevron: string
  tint: string // filled buttons, bubbles, selected chips
  tintText: string // tint used as text/icon colour on the page
  onTint: string
  danger: string
  glass: string // fallback for glass controls when Liquid Glass is unavailable
  overlay: string // badges over photos
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
  bg: '#F2F2F7',
  card: '#FFFFFF',
  fill: 'rgba(118,118,128,0.12)',
  label: '#000000',
  secondary: '#6C6C70',
  body: '#1C1C1E',
  placeholder: '#8E8E93',
  separator: '#C6C6C8',
  chevron: '#C4C4C7',
  tint: '#2E5BB0',
  tintText: '#2E5BB0',
  onTint: '#FFFFFF',
  danger: '#E5484D',
  glass: 'rgba(255,255,255,0.8)',
  overlay: 'rgba(0,0,0,0.55)',
  detailBg: '#FFFFFF',
  detailGroup: '#F2F2F7',
  detailChip: '#FFFFFF',
  modalBg: '#F2F2F7',
  modalCard: '#FFFFFF',
  modalSeparator: '#C6C6C8',
  photoPlaceholder: '#E5E5EA',
}

export const dark: Theme = {
  dark: true,
  bg: '#14161A',
  card: '#1F2227',
  fill: 'rgba(118,118,128,0.24)',
  label: '#E4E7EE',
  secondary: '#9AA0AB',
  body: '#C5C9D2',
  placeholder: '#6E737D',
  separator: '#343841',
  chevron: '#5A5E66',
  tint: '#3F6FD0',
  tintText: '#7FA0E0',
  onTint: '#FFFFFF',
  danger: '#FF6B6B',
  glass: 'rgba(42,46,53,0.8)',
  overlay: 'rgba(0,0,0,0.55)',
  detailBg: '#14161A',
  detailGroup: '#1F2227',
  detailChip: '#2A2E35',
  modalBg: '#1F2227',
  modalCard: '#2A2E35',
  modalSeparator: '#3A3F48',
  photoPlaceholder: '#2A2E35',
}

// The effective scheme: the Appearance preference (store/appearance.ts) sets a
// native override, so useColorScheme() already reflects System/Light/Dark.
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light
}

// Thread/person colors are stored as palette keys ('rose', 'cyan', …), not CSS
// colors — mirror of frontend/src/utils/colors.js. Some keys happen to be valid
// RN named colors but 'rose' etc. aren't, so always resolve through here.
const PALETTE: Record<string, string> = {
  blue: '#4b6cb7',
  rose: '#c64d6a',
  emerald: '#3a8a6d',
  amber: '#d49a2a',
  violet: '#7a55c4',
  cyan: '#2da3ad',
  orange: '#d0743a',
  lime: '#6ea03a',
  fuchsia: '#b8479f',
  slate: '#6b7a8c',
}

// Lifted variants so small dots stay legible on the dark charcoal.
const PALETTE_DARK: Record<string, string> = {
  blue: '#7d98d8',
  rose: '#e0708b',
  emerald: '#5cb391',
  amber: '#e5b450',
  violet: '#9b7ae0',
  cyan: '#3fc1cb',
  orange: '#e8925a',
  lime: '#8fc25a',
  fuchsia: '#d46bbd',
  slate: '#8e9bab',
}

export function paletteColor(key: string | null | undefined, isDark = false): string {
  const p = isDark ? PALETTE_DARK : PALETTE
  return (key && p[key]) || p.slate
}

// Stable colour for a person avatar when we only know their name.
const AVATAR_KEYS = ['rose', 'cyan', 'orange', 'violet', 'emerald', 'amber', 'fuchsia', 'blue']
export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return PALETTE[AVATAR_KEYS[Math.abs(h) % AVATAR_KEYS.length]]
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
