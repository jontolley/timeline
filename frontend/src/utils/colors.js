// Predefined palette for person color coding. Tailwind JIT requires the full
// class names to appear literally in source, so each variant is spelled out.

export const PALETTE = [
  { key: 'blue',    label: 'Blue',    dot: 'bg-blue-500',    chip: 'bg-blue-100 text-blue-800',       ring: 'ring-blue-500' },
  { key: 'emerald', label: 'Emerald', dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800', ring: 'ring-emerald-500' },
  { key: 'violet',  label: 'Violet',  dot: 'bg-violet-500',  chip: 'bg-violet-100 text-violet-800',   ring: 'ring-violet-500' },
  { key: 'amber',   label: 'Amber',   dot: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-800',     ring: 'ring-amber-500' },
  { key: 'rose',    label: 'Rose',    dot: 'bg-rose-500',    chip: 'bg-rose-100 text-rose-800',       ring: 'ring-rose-500' },
  { key: 'cyan',    label: 'Cyan',    dot: 'bg-cyan-500',    chip: 'bg-cyan-100 text-cyan-800',       ring: 'ring-cyan-500' },
  { key: 'fuchsia', label: 'Fuchsia', dot: 'bg-fuchsia-500', chip: 'bg-fuchsia-100 text-fuchsia-800', ring: 'ring-fuchsia-500' },
  { key: 'lime',    label: 'Lime',    dot: 'bg-lime-500',    chip: 'bg-lime-100 text-lime-800',       ring: 'ring-lime-500' },
  { key: 'orange',  label: 'Orange',  dot: 'bg-orange-500',  chip: 'bg-orange-100 text-orange-800',   ring: 'ring-orange-500' },
  { key: 'slate',   label: 'Slate',   dot: 'bg-slate-500',   chip: 'bg-slate-100 text-slate-800',     ring: 'ring-slate-500' },
]

const FALLBACK = { key: 'slate', label: 'Slate', dot: 'bg-slate-500', chip: 'bg-slate-100 text-slate-800', ring: 'ring-slate-500' }

export function colorClasses(key) {
  return PALETTE.find((c) => c.key === key) ?? FALLBACK
}
