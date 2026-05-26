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
import { useAuthStore, useCategoryStore, useThreadStore } from './store'
import { ConfirmProvider } from './lib/confirm'

function UnauthedShell() {
  const [showLogin, setShowLogin] = useState(false)
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
    check()
  }, [check])

  // Categories drive event colors + the type dropdown, so load them as soon
  // as the user is authenticated. Pages read from the store synchronously.
  // Threads drive the timeline chip + filter and the EventForm thread picker.
  useEffect(() => {
    if (status === 'authenticated') {
      loadCategories().catch(() => {})
      loadThreads().catch(() => {})
    }
  }, [status, loadCategories, loadThreads])

  useEffect(() => {
    const handler = () => markUnauthorized()
    window.addEventListener('auth:unauthorized', handler)
    return () => window.removeEventListener('auth:unauthorized', handler)
  }, [markUnauthorized])

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
        <Route path="/backup" element={<Navigate to="/settings?tab=backup" replace />} />
      </Routes>
      <BottomNav />
      </BrowserRouter>
    </ConfirmProvider>
  )
}
