import { Link, NavLink } from 'react-router-dom'
import { useAuthStore } from '../store'

export default function Navbar() {
  const { email, signOut } = useAuthStore()

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-xl font-bold text-gray-900 tracking-tight">
            My Timeline
          </Link>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-900'}`
            }
          >
            Timeline
          </NavLink>
          <NavLink
            to="/chat"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-900'}`
            }
          >
            Chat
          </NavLink>
          <NavLink
            to="/people"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-900'}`
            }
          >
            People
          </NavLink>
          <NavLink
            to="/backup"
            className={({ isActive }) =>
              `text-sm ${isActive ? 'text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-900'}`
            }
          >
            Backup
          </NavLink>
        </div>
        <div className="flex items-center gap-3">
          {email && (
            <span className="text-xs text-gray-400 hidden sm:inline" title={email}>
              {email}
            </span>
          )}
          <button
            type="button"
            onClick={signOut}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Sign out
          </button>
          <Link
            to="/events/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            Add Event
          </Link>
        </div>
      </div>
    </nav>
  )
}
