import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store'

const LINKS = [
  { to: '/',        label: 'Timeline', end: true },
  { to: '/chat',    label: 'Chat' },
  { to: '/people',  label: 'People' },
  { to: '/backup',  label: 'Backup' },
]

function Brandmark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <circle cx="11" cy="11" r="9.5" stroke="currentColor" strokeWidth="1.4" />
        <line x1="11" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="11" y1="11" x2="16" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function isActive(pathname, to, end) {
  if (end) return pathname === to
  return pathname === to || pathname.startsWith(to + '/')
}

export default function Topbar() {
  const { email, signOut } = useAuthStore()
  const { pathname } = useLocation()

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <Brandmark />
        <span>Timeline</span>
      </Link>
      <nav className="nav">
        {LINKS.map((l) => {
          const active = isActive(pathname, l.to, l.end)
          return (
            <Link
              key={l.to}
              to={l.to}
              className="nav-item"
              aria-current={active ? 'page' : undefined}
            >
              {l.label}
            </Link>
          )
        })}
      </nav>
      <div className="topbar-spacer" />
      {email && <span className="topbar-user">{email}</span>}
      <button type="button" className="signout" onClick={signOut}>
        Sign out
      </button>
    </header>
  )
}
