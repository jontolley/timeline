import { useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import PeopleView from './PeopleView'
import BackupView from './BackupView'
import CategoriesSettings from '../components/CategoriesSettings'

const TABS = [
  { value: 'people',     label: 'People' },
  { value: 'categories', label: 'Categories' },
  { value: 'backup',     label: 'Backup' },
]

export default function SettingsView() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const location = useLocation()
  const requested = params.get('tab')
  const active = useMemo(
    () => (TABS.some((t) => t.value === requested) ? requested : 'people'),
    [requested],
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
        {TABS.map((t) => (
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
        {active === 'backup' && <BackupView embedded key={location.search} />}
      </div>
    </div>
  )
}
