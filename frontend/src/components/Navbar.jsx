import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store'

const LINKS = [
  { to: '/',        label: 'Timeline', end: true },
  { to: '/chat',    label: 'Chat'  },
  { to: '/people',  label: 'People' },
  { to: '/backup',  label: 'Backup' },
]

function MenuIcon({ open }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      {open ? (
        <path d="M6 6l12 12M6 18L18 6" />
      ) : (
        <path d="M3 6h18M3 12h18M3 18h18" />
      )}
    </svg>
  )
}

export default function Navbar() {
  const { email, signOut } = useAuthStore()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Close the mobile sheet on route change.
  const close = () => setOpen(false)

  return (
    <header className="sticky top-0 z-20 bg-paper/85 backdrop-blur border-b border-ink-line">
      <div className="max-w-3xl mx-auto px-5 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="font-semibold tracking-tighter2 text-[15px]" onClick={close}>
          Timeline
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1 text-sm text-ink-mute">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `px-2.5 py-1.5 rounded-md transition-colors ${
                  isActive ? 'text-ink font-medium' : 'hover:text-ink'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>

        {/* Desktop right cluster */}
        <div className="hidden sm:flex items-center gap-3">
          {email && (
            <span className="text-xs text-ink-faint" title={email}>
              {email}
            </span>
          )}
          <button
            type="button"
            onClick={signOut}
            className="text-sm text-ink-mute hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="sm:hidden flex items-center justify-center w-9 h-9 rounded-md hover:bg-surface"
          aria-label="Toggle menu"
        >
          <MenuIcon open={open} />
        </button>
      </div>

      {/* Mobile sheet */}
      {open && (
        <div className="sm:hidden border-t border-ink-line bg-paper">
          <nav className="max-w-3xl mx-auto px-5 py-3 grid gap-1 text-sm">
            {LINKS.map((l) => {
              const active = l.end ? location.pathname === l.to : location.pathname.startsWith(l.to)
              return (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  onClick={close}
                  className={`px-2 py-2 rounded-md ${
                    active ? 'bg-surface text-ink font-medium' : 'text-ink-mute hover:text-ink'
                  }`}
                >
                  {l.label}
                </NavLink>
              )
            })}
            <div className="my-2 border-t border-ink-line" />
            {email && (
              <div className="px-2 text-xs text-ink-faint truncate">{email}</div>
            )}
            <button
              type="button"
              onClick={() => { close(); signOut() }}
              className="text-left px-2 py-2 text-ink-mute hover:text-ink"
            >
              Sign out
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}
