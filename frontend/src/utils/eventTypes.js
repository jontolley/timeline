// Per-event-type styling. Spelled out as literal class names so Tailwind JIT
// keeps them in the bundle.

const STYLES = {
  career:    { label: 'text-indigo-700',  ring: 'ring-indigo-500'  },
  travel:    { label: 'text-emerald-700', ring: 'ring-emerald-500' },
  milestone: { label: 'text-violet-700',  ring: 'ring-violet-500'  },
  family:    { label: 'text-amber-700',   ring: 'ring-amber-500'   },
}

const FALLBACK = { label: 'text-ink-mute', ring: 'ring-ink-line' }

export function eventTypeStyles(type) {
  return STYLES[type] ?? FALLBACK
}
