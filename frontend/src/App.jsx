import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import TimelineView from './pages/TimelineView'
import EventDetail from './pages/EventDetail'
import EventForm from './pages/EventForm'
import ChatView from './pages/ChatView'

export default function App() {
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
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
