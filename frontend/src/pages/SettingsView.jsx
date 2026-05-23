import { useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import PeopleView from './PeopleView'
import BackupView from './BackupView'
import CategoriesSettings from '../components/CategoriesSettings'
import ThreadsSettings from '../components/ThreadsSettings'
import UsersSettings from '../components/UsersSettings'
import { useAuthStore } from '../store'

const BASE_TABS = [
  { value: 'people',     label: 'People' },
  { value: 'categories', label: 'Categories' },
  { value: 'threads',    label: 'Threads' },
  { value: 'backup',     label: 'Backup' },
]
const ADMIN_TABS = [
  { value: 'users',      label: 'Users' },
]

export default function SettingsView() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const location = useLocation()
  const role = useAuthStore((s) => s.role)
  const tabs = useMemo(
    () => (role === 'admin' ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS),
    [role],
  )
  const requested = params.get('tab')
  const active = useMemo(
    () => (tabs.some((t) => t.value === requested) ? requested : 'people'),
    [requested, tabs],
  )

  const setTab = (value) => {
    navigate(`/settings?tab=${value}`, { replace: true })
    // Reset scroll when switching tabs so the user lands at the top of each section.
    window.scrollTo(0, 0)
  }

  return (
    <div className="page-narrow">
      <h1 className="page-title" style={{ fontSize: 44, marginBottom: 18 }}>Settings</h1>
      <div className="settings-tabs">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            className="settings-tab"
            aria-pressed={active === t.value}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-panel">
        {active === 'people' && <PeopleView embedded key={location.search} />}
        {active === 'categories' && <CategoriesSettings />}
        {active === 'threads' && <ThreadsSettings />}
        {active === 'backup' && <BackupView embedded key={location.search} />}
        {active === 'users' && role === 'admin' && <UsersSettings />}
      </div>
    </div>
  )
}
