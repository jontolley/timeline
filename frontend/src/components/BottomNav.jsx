import { NavLink } from 'react-router-dom'

function TimelineIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7 V12 L15 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 5 H19 A2 2 0 0 1 21 7 V15 A2 2 0 0 1 19 17 H13 L9 21 V17 H5 A2 2 0 0 1 3 15 V7 A2 2 0 0 1 5 5 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const TABS = [
  { to: '/', label: 'Timeline', icon: <TimelineIcon />, end: true },
  { to: '/chat', label: 'Chat', icon: <ChatIcon /> },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className="bottom-nav-item">
          {t.icon}
          <span className="bottom-nav-label">{t.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
