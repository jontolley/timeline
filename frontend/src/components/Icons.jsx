// Small lucide-style stroke icons (24×24, currentColor) used by the event form
// and its pickers. Kept inline rather than pulling in an icon dependency.

function Svg({ size = 18, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ArrowLeftIcon = (p) => (
  <Svg {...p}><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></Svg>
)
export const CalendarIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
    <path d="M16 2.5v4M8 2.5v4M3 9.5h18" />
  </Svg>
)
export const ChevronLeftIcon = (p) => (<Svg {...p}><path d="M15 18l-6-6 6-6" /></Svg>)
export const ChevronRightIcon = (p) => (<Svg {...p}><path d="M9 18l6-6-6-6" /></Svg>)
export const ChevronDownIcon = (p) => (<Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>)
export const PlusIcon = (p) => (<Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>)
export const XIcon = (p) => (<Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>)
export const CheckIcon = (p) => (<Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>)
export const MapPinIcon = (p) => (
  <Svg {...p}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </Svg>
)
export const MapIcon = (p) => (
  <Svg {...p}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
)
