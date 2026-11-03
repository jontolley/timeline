import { useCallback, useEffect, useState } from 'react'
import { listSessions, revokeSession } from '../api/auth'
import { useAuthStore } from '../store'
import { useConfirm } from '../lib/confirm'
import { LaptopIcon, PhoneIcon, TabletIcon } from './Icons'

// Mongo hands back naive UTC datetimes, so the JSON has no offset; without a
// `Z` the browser would read them as local time.
function parseUtc(s) {
  return new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`)
}

// Best-effort "what is this" from the user-agent string the session was
// created with. The iOS app's requests come from CFNetwork as `Hindsite/<build>`.
function describeDevice(ua = '') {
  if (/^Hindsite\//.test(ua)) return { name: 'Hindsite app', platform: 'iPhone', kind: 'phone' }

  let platform = null
  let kind = 'computer'
  if (/iPad/.test(ua)) { platform = 'iPad'; kind = 'tablet' }
  else if (/iPhone/.test(ua)) { platform = 'iPhone'; kind = 'phone' }
  else if (/Android/.test(ua)) { platform = 'Android'; kind = /Mobile/.test(ua) ? 'phone' : 'tablet' }
  else if (/CrOS/.test(ua)) platform = 'ChromeOS'
  else if (/Mac OS X|Macintosh/.test(ua)) platform = 'macOS'
  else if (/Windows/.test(ua)) platform = 'Windows'
  else if (/Linux/.test(ua)) platform = 'Linux'

  let browser = null
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge'
  else if (/OPR\//.test(ua)) browser = 'Opera'
  else if (/(Firefox|FxiOS)\//.test(ua)) browser = 'Firefox'
  else if (/(Chrome|CriOS)\//.test(ua)) browser = 'Chrome'
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'Safari'

  if (!browser && !platform) {
    return { name: ua.split(/[\s/]/)[0] || 'Unknown device', platform: null, kind: 'computer' }
  }
  return { name: browser || 'Browser', platform, kind }
}

// Sessions only record use about once a day (see backend auth.py), so the
// freshest honest answer for another device is "within the last day".
function activeLabel(session) {
  if (session.current) return 'Active now'
  const days = Math.floor((Date.now() - parseUtc(session.last_used_at)) / 86_400_000)
  if (days < 1) return 'Active in the last day'
  if (days === 1) return 'Active yesterday'
  return `Active ${days} days ago`
}

function signedInLabel(session) {
  const d = parseUtc(session.created_at)
  return `Signed in ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function DeviceIcon({ kind }) {
  if (kind === 'phone') return <PhoneIcon />
  if (kind === 'tablet') return <TabletIcon />
  return <LaptopIcon />
}

export default function DevicesSettings() {
  const signOut = useAuthStore((s) => s.signOut)
  const confirm = useConfirm()
  const [sessions, setSessions] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setSessions(await listSessions())
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const others = (sessions || []).filter((s) => !s.current)
  const hasCurrent = (sessions || []).some((s) => s.current)

  const signOutDevice = async (session) => {
    const { name, platform } = describeDevice(session.user_agent)
    if (session.current) {
      const ok = await confirm({
        title: 'Sign out of this browser?',
        body: "You'll go back to the sign-in screen.",
        confirmLabel: 'Sign out',
        danger: true,
      })
      if (ok) await signOut()
      return
    }
    const ok = await confirm({
      title: `Sign out ${platform ? `${name} on ${platform}` : name}?`,
      body: 'That device will need to sign in again the next time it opens Hindsite.',
      confirmLabel: 'Sign out',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await revokeSession(session.id)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const signOutOthers = async () => {
    const ok = await confirm({
      title: `Sign out ${others.length} other device${others.length === 1 ? '' : 's'}?`,
      body: 'Every device except this one will need to sign in again.',
      confirmLabel: 'Sign out',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await Promise.all(others.map((s) => revokeSession(s.id)))
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="hs-well-head">
        <div>
          <h1 className="hs-well-title">Devices.</h1>
          <p className="hs-well-count">
            <strong>{sessions ? sessions.length : '–'}</strong> signed in
          </p>
        </div>
        {others.length > 0 && (
          <div className="hs-well-right">
            <button type="button" className="btn" onClick={signOutOthers} disabled={busy}>
              Sign out other devices
            </button>
          </div>
        )}
      </header>

      <div className="hs-well-body">
        <p className="hs-well-intro">
          Everywhere you're signed in to Hindsite. A device stays signed in as long as it's used
          at least once every 90 days. Sign out any you don't recognise or no longer use.
        </p>

        {error && <p className="hs-modal-error" style={{ marginBottom: 14 }}>{error}</p>}

        {sessions && !hasCurrent && (
          <div className="hs-notice">
            <p className="hs-notice-title">
              This browser signed in before device tracking was added, so it isn't listed.
              Sign out and back in to add it.
            </p>
          </div>
        )}

        <div className="hs-rows">
          {!sessions && !error && <p className="muted small">Loading…</p>}
          {sessions && sessions.length === 0 && (
            <div className="hs-row-empty-state">No signed-in devices are listed yet.</div>
          )}
          {(sessions || []).map((s) => {
            const { name, platform, kind } = describeDevice(s.user_agent)
            return (
              <article key={s.id} className="hs-row">
                <div className="hs-row-head">
                  <span className="hs-device-icon"><DeviceIcon kind={kind} /></span>
                  <div className="hs-device-id">
                    <div className="hs-row-id">
                      <span className="hs-row-name">{platform ? `${name} · ${platform}` : name}</span>
                      {s.current && <span className="hs-row-slug">this device</span>}
                    </div>
                    <p className="hs-device-sub">{activeLabel(s)} · {signedInLabel(s)}</p>
                  </div>
                  <div className="hs-row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => signOutDevice(s)}
                      disabled={busy}
                    >
                      Sign out
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </>
  )
}
