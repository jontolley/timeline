// A small slice of the Hindsite design tokens (see frontend/src/index.css
// :root) so the native UI reads as the same product.
export const colors = {
  bg: '#eef1f8',
  surface: '#ffffff',
  rule: '#d9dff0',
  ink: '#1b2333',
  inkSoft: '#5a6480',
  accent: '#2e5bb0',
  accentDark: '#244a92',
  gold: '#c9a14a',
  danger: '#b0432e',
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

export function paletteColor(key: string | null | undefined): string {
  return (key && PALETTE[key]) || PALETTE.slate
}

export const fonts = {
  // Instrument Serif / Geist aren't bundled yet — system fonts stand in until
  // expo-font is wired up. Kept here so screens reference one source.
  serif: undefined as string | undefined,
  sans: undefined as string | undefined,
}
