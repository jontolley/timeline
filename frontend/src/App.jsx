import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Topbar from './components/Topbar'
import TimelineView from './pages/TimelineView'
import EventDetail from './pages/EventDetail'
import EventForm from './pages/EventForm'
import ChatView from './pages/ChatView'
import PeopleView from './pages/PeopleView'
import BackupView from './pages/BackupView'
import LoginView from './pages/LoginView'
import LandingPage from './pages/LandingPage'
import { useAuthStore } from './store'

function UnauthedShell() {
  const [showLogin, setShowLogin] = useState(false)
  if (showLogin) {
    return <LoginView onBack={() => setShowLogin(false)} />
  }
  return <LandingPage onEnter={() => setShowLogin(true)} />
}

export default function App() {
  const { status, check, markUnauthorized } = useAuthStore()

  useEffect(() => {
    check()
  }, [check])

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
    <BrowserRouter>
      <Topbar />
      <Routes>
        <Route path="/" element={<TimelineView />} />
        <Route path="/events/new" element={<EventForm />} />
        <Route path="/events/:id" element={<EventDetail />} />
        <Route path="/events/:id/edit" element={<EventForm />} />
        <Route path="/chat" element={<ChatView />} />
        <Route path="/people" element={<PeopleView />} />
        <Route path="/backup" element={<BackupView />} />
      </Routes>
    </BrowserRouter>
  )
}
