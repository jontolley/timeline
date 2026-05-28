import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PeopleView from './PeopleView'
import ThreadsSettings from '../components/ThreadsSettings'
import UsersSettings from '../components/UsersSettings'
import {
  useAuthStore,
  usePeopleStore,
  useThreadStore,
  useUserStore,
} from '../store'

const BASE_TABS = [
  { value: 'people',     label: 'People' },
  { value: 'threads',    label: 'Threads' },
]
const ADMIN_TABS = [
  { value: 'users',      label: 'Users' },
]

export default function SettingsView() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const role = useAuthStore((s) => s.role)

  const peopleCount = usePeopleStore((s) => s.people.length)
  const threadCount = useThreadStore((s) => s.threads.filter((t) => t.is_owner).length)
  const userCount = useUserStore((s) => s.users.length)

  // Pre-fetch the stores backing the rail counts so the numbers are correct
  // on first paint, not just after the matching tab is opened. `load()` is
  // idempotent — it bails when the store is already loaded.
  const loadPeople = usePeopleStore((s) => s.load)
  const loadUsers = useUserStore((s) => s.load)
  useEffect(() => {
    loadPeople().catch(() => {})
    if (role === 'admin') loadUsers().catch(() => {})
  }, [role, loadPeople, loadUsers])

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
    window.scrollTo(0, 0)
  }

  const countFor = (value) => {
    switch (value) {
      case 'people':     return peopleCount
      case 'threads':    return threadCount
      case 'users':      return userCount
      default:           return null
    }
  }

  return (
    <div className="hs-settings-page">
      <section className="hs-settings-console">
        <aside className="hs-rail">
          <div className="hs-rail-brand">
            <span className="hs-rail-crumb">Settings</span>
          </div>

          <div>
            <p className="hs-rail-eyebrow">Account</p>
            <nav className="hs-rail-nav">
              {tabs.map((t) => {
                const isActive = active === t.value
                const count = countFor(t.value)
                return (
                  <button
                    key={t.value}
                    type="button"
                    className={`hs-rail-item${isActive ? ' active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setTab(t.value)}
                  >
                    <span>{t.label}</span>
                    {count != null ? (
                      <span className="hs-rail-count">{count}</span>
                    ) : (
                      <span className="hs-rail-arr" aria-hidden="true">↗</span>
                    )}
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="hs-rail-spacer" />
        </aside>

        <main className="hs-well">
          {active === 'people'     && <PeopleView embedded />}
          {active === 'threads'    && <ThreadsSettings />}
          {active === 'users'      && role === 'admin' && <UsersSettings />}
        </main>
      </section>
    </div>
  )
}
