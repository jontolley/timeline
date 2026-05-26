import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'
import { personInitials } from '../utils/colors'

const LINKS = [
  { to: '/',     label: 'Timeline', end: true },
  { to: '/chat', label: 'Chat' },
]

function Brandmark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
        <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="2" fill="currentColor" />
        <path d="M16 6 V 13 M22 24 L 17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

  const name = email?.split('@')[0] ?? ''
  const initial = personInitials(email || '?').charAt(0)

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="hs-account-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="hs-account-avatar" aria-hidden="true">{initial}</span>
        <span className="hs-account-who">
          <span className="hs-account-name">{name}</span>
          <span className="hs-account-email">{email}</span>
        </span>
        <span className="hs-account-caret" aria-hidden="true">▾</span>
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
  const ref = useRef(null)

  // Publish the topbar's rendered height as --topbar-h so every sticky offset,
  // scroll-margin, and 100vh-minus-topbar height stays in sync across breakpoints.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = () => {
      const h = Math.round(el.getBoundingClientRect().height)
      if (h > 0) document.documentElement.style.setProperty('--topbar-h', `${h}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <header className="topbar" ref={ref}>
      <Link to="/" className="brand">
        <Brandmark />
        <span className="brand-word">Hindsite</span>
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
      <div className="topbar-actions" id="topbar-actions" />
      {email && <UserMenu email={email} onSignOut={signOut} />}
    </header>
  )
}
