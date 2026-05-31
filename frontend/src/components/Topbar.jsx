import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore, useThemeStore } from '../store'
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

function UserMenu({ email, name, pictureUrl, onSignOut }) {
  const [open, setOpen] = useState(false)
  // If the Google avatar URL 404s/fails to load, fall back to the initial pill.
  const [imgFailed, setImgFailed] = useState(false)
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
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
  const goToAbout = () => {
    setOpen(false)
    navigate('/about')
  }
  const handleSignOut = () => {
    setOpen(false)
    onSignOut()
  }

  const initial = personInitials(email || '?').charAt(0)
  const showPicture = !!pictureUrl && !imgFailed

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className="hs-account-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={name || email || 'Account'}
      >
        {showPicture ? (
          <img
            src={pictureUrl}
            alt=""
            className="hs-account-avatar hs-account-avatar-img"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="hs-account-avatar" aria-hidden="true">{initial}</span>
        )}
      </button>
      {open && (
        <div className="user-menu-dropdown" role="menu">
          <div className="user-menu-header">
            {name && <span className="user-menu-header-name">{name}</span>}
            <span className="user-menu-header-email">{email}</span>
          </div>
          <div className="user-menu-divider" />
          <button type="button" className="user-menu-item" onClick={goToSettings} role="menuitem">
            Settings
          </button>
          <label className="user-menu-toggle">
            <span>Dark mode</span>
            <span className="hs-switch">
              <input
                type="checkbox"
                checked={theme === 'dark'}
                onChange={toggleTheme}
                aria-label="Toggle dark mode"
              />
              <span className="hs-switch-track"><span className="hs-switch-thumb" /></span>
            </span>
          </label>
          <button type="button" className="user-menu-item" onClick={goToAbout} role="menuitem">
            About
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
  const { email, name, pictureUrl, signOut } = useAuthStore()
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
      {email && <UserMenu email={email} name={name} pictureUrl={pictureUrl} onSignOut={signOut} />}
    </header>
  )
}
