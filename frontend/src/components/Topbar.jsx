import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'

const LINKS = [
  { to: '/',     label: 'Timeline', end: true },
  { to: '/chat', label: 'Chat' },
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

function UserMenu({ email, onSignOut }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)
  const navigate = useNavigate()

  // Close on outside-click and on Escape.
  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const goToSettings = () => {
    setOpen(false)
    navigate('/settings')
  }
  const handleSignOut = () => {
    setOpen(false)
    onSignOut()
  }

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="user-menu-email">{email}</span>
        <span className="user-menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          <button type="button" className="user-menu-item" onClick={goToSettings} role="menuitem">
            Settings
          </button>
          <div className="user-menu-divider" />
          <button type="button" className="user-menu-item danger" onClick={handleSignOut} role="menuitem">
            Sign out
          </button>
        </div>
      )}
    </div>
  )
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
      {email && <UserMenu email={email} onSignOut={signOut} />}
    </header>
  )
}
