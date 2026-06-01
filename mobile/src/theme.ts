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

export const fonts = {
  // Instrument Serif / Geist aren't bundled yet — system fonts stand in until
  // expo-font is wired up. Kept here so screens reference one source.
  serif: undefined as string | undefined,
  sans: undefined as string | undefined,
}
