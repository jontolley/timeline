// Person color palette — mapped to concrete hex values now that we no longer
// rely on Tailwind utility classes.

export const PALETTE = [
  { key: 'blue',    label: 'Blue',    color: '#4b6cb7' },
  { key: 'rose',    label: 'Rose',    color: '#c64d6a' },
  { key: 'emerald', label: 'Emerald', color: '#3a8a6d' },
  { key: 'amber',   label: 'Amber',   color: '#d49a2a' },
  { key: 'violet',  label: 'Violet',  color: '#7a55c4' },
  { key: 'cyan',    label: 'Cyan',    color: '#2da3ad' },
  { key: 'orange',  label: 'Orange',  color: '#d0743a' },
  { key: 'lime',    label: 'Lime',    color: '#6ea03a' },
  { key: 'fuchsia', label: 'Fuchsia', color: '#b8479f' },
  { key: 'slate',   label: 'Slate',   color: '#6b7a8c' },
]

const BY_KEY = Object.fromEntries(PALETTE.map((p) => [p.key, p]))
const FALLBACK = { key: 'slate', label: 'Slate', color: '#6b7a8c' }

export function personColor(key) {
  return (BY_KEY[key] ?? FALLBACK).color
}

export function personInitials(name) {
  if (!name) return '??'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
