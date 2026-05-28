import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import BottomNav from './components/BottomNav'
import Topbar from './components/Topbar'
import TimelineView from './pages/TimelineView'
import EventDetail from './pages/EventDetail'
import EventForm from './pages/EventForm'
import AboutView from './pages/AboutView'
import ChatView from './pages/ChatView'
import SettingsView from './pages/SettingsView'
import LoginView from './pages/LoginView'
import LandingPage from './pages/LandingPage'
import UnauthorizedView from './pages/UnauthorizedView'
import { useAuthStore, useCategoryStore, useThreadStore } from './store'
import { ConfirmProvider } from './lib/confirm'

function UnauthedShell() {
  const isUnauthorized =
    typeof window !== 'undefined' && window.location.pathname === '/unauthorized'
  const unauthorizedEmail = isUnauthorized
    ? new URLSearchParams(window.location.search).get('email') || ''
    : ''

  // If the user arrives on /unauthorized (after a Google sign-in by an
  // address that isn't allowlisted), show the friendly screen first. The
  // "use different email" button clears the URL and drops them into the
  // normal sign-in form.
  const [showLogin, setShowLogin] = useState(false)
  const [showUnauthorized, setShowUnauthorized] = useState(isUnauthorized)

  const clearUnauthorizedUrl = () => {
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState({}, '', '/')
    }
  }

  if (showUnauthorized) {
    return (
      <UnauthorizedView
        email={unauthorizedEmail}
        onTryAnother={() => {
          clearUnauthorizedUrl()
          setShowUnauthorized(false)
          setShowLogin(true)
        }}
        onBack={() => {
          clearUnauthorizedUrl()
          setShowUnauthorized(false)
          setShowLogin(false)
        }}
      />
    )
  }

  if (showLogin) {
    return <LoginView onBack={() => setShowLogin(false)} />
  }
  return <LandingPage onEnter={() => setShowLogin(true)} />
}

export default function App() {
  const { status, check, markUnauthorized } = useAuthStore()
  const loadCategories = useCategoryStore((s) => s.load)
  const loadThreads = useThreadStore((s) => s.load)

  useEffect(() => {
    console.log('[boot] App mounted, triggering auth check')
    check()
  }, [check])

  // Categories drive event colors + the type dropdown, so load them as soon
  // as the user is authenticated. Pages read from the store synchronously.
  // Threads drive the timeline chip + filter and the EventForm thread picker.
  useEffect(() => {
    if (status === 'authenticated') {
      const tCat = performance.now()
      console.log('[boot] loadCategories() start')
      loadCategories()
        .then(() => console.log(`[boot] loadCategories() done in ${Math.round(performance.now() - tCat)}ms`))
        .catch((err) => console.log('[boot] loadCategories() failed', err))
      const tThr = performance.now()
      console.log('[boot] loadThreads() start')
      loadThreads()
        .then(() => console.log(`[boot] loadThreads() done in ${Math.round(performance.now() - tThr)}ms`))
        .catch((err) => console.log('[boot] loadThreads() failed', err))
    }
  }, [status, loadCategories, loadThreads])

  useEffect(() => {
    const handler = () => markUnauthorized()
    window.addEventListener('auth:unauthorized', handler)
    return () => window.removeEventListener('auth:unauthorized', handler)
  }, [markUnauthorized])

  console.log(`[boot] App render: status=${status}`)

  if (status === 'loading') {
    return (
      <div className="login">
        <p className="muted small">Loading…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <UnauthedShell />
  }

  return (
    <ConfirmProvider>
      <BrowserRouter>
        <Topbar />
        <Routes>
        <Route path="/" element={<TimelineView />} />
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/events/:id/edit" element={<EventForm />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/about" element={<AboutView />} />
        {/* Old pre-Settings paths redirect to the matching tab. */}
        <Route path="/people" element={<Navigate to="/settings?tab=people" replace />} />
        <Route path="/backup" element={<Navigate to="/settings?tab=threads" replace />} />
      </Routes>
      <BottomNav />
      </BrowserRouter>
    </ConfirmProvider>
  )
}
