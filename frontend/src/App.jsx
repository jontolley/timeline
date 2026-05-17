import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import TimelineView from './pages/TimelineView'
import EventDetail from './pages/EventDetail'
import EventForm from './pages/EventForm'
import ChatView from './pages/ChatView'
import PeopleView from './pages/PeopleView'
import BackupView from './pages/BackupView'
import LoginView from './pages/LoginView'
import { useAuthStore } from './store'

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <LoginView />
  }

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-4xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<TimelineView />} />
            <Route path="/events/new" element={<EventForm />} />
            <Route path="/events/:id" element={<EventDetail />} />
            <Route path="/events/:id/edit" element={<EventForm />} />
            <Route path="/chat" element={<ChatView />} />
            <Route path="/people" element={<PeopleView />} />
            <Route path="/backup" element={<BackupView />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
