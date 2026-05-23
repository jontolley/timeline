import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePeopleStore } from '../store'

export default function BackupView({ embedded = false }) {
  const today = new Date().toISOString().slice(0, 10)
  const [file, setFile] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const reloadPeople = usePeopleStore((s) => s.load)

  const handleFile = (e) => {
    setError(null)
    setResult(null)
    setFile(e.target.files?.[0] ?? null)
  }

  const startRestore = () => {
    if (!file) return
    setError(null)
    setResult(null)
    setShowConfirm(true)
  }

  const doRestore = async () => {
    if (!file) return
    setRestoring(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      })
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'))
        throw new Error('Unauthorized')
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Restore failed (${res.status})`)
      }
      const data = await res.json()
      setResult(data)
      await reloadPeople(true).catch(() => {})
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setShowConfirm(false)
    } catch (err) {
      setError(err.message)
      setShowConfirm(false)
    } finally {
      setRestoring(false)
    }
  }

  const wrapperClass = embedded ? 'settings-section' : 'page-narrow'
  return (
    <div className={wrapperClass}>
      {!embedded && <Link to="/" className="back-link">← Back to timeline</Link>}
      {embedded ? (
        <h2 className="section-title">Backup &amp; restore</h2>
      ) : (
        <h1 className="page-title" style={{ fontSize: 44, marginBottom: 10 }}>Backup &amp; restore</h1>
      )}
      <p className="muted" style={{ marginBottom: 32, fontSize: 14 }}>
        Download a copy of every event and person, or replace your timeline from a previous
        backup file.
      </p>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Download</div>
      <div className="card" style={{ padding: '18px 22px', marginBottom: 32 }}>
        <div className="row between" style={{ gap: 18 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 className="section-title" style={{ fontSize: 16, margin: '0 0 4px' }}>JSON</h2>
            <p className="muted small" style={{ margin: '0 0 6px' }}>
              Single file with the full structure preserved.
            </p>
            <p className="mono muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              timeline-backup-{today}.json
            </p>
          </div>
          <a href="/api/backup/json" download className="btn btn-primary">Download</a>
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Restore</div>
      <div className="card" style={{ padding: '18px 22px' }}>
        <p className="muted small" style={{ marginTop: 0, marginBottom: 14 }}>
          Upload a JSON backup. The restore will <b style={{ color: 'var(--danger)' }}>replace</b>{' '}
          all current events and people.
        </p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleFile}
            style={{
              fontSize: 13,
              color: 'var(--ink-soft)',
            }}
          />
          <button
            type="button"
            className="btn btn-accent"
            onClick={startRestore}
            disabled={!file || restoring}
          >
            Restore
          </button>
        </div>
        {error && <p className="form-error" style={{ marginTop: 16 }}>{error}</p>}
        {result && !error && (
          <p style={{
            marginTop: 16,
            fontSize: 13,
            color: 'var(--success)',
            background: color8(),
            border: '1px solid var(--line)',
            borderRadius: 10,
            padding: '10px 14px',
          }}>
            Restored {result.events_restored} events and {result.people_restored} people
            {typeof result.events_indexed === 'number' && result.events_indexed !== result.events_restored
              ? ` (${result.events_indexed} re-indexed for search)`
              : ''}.
          </p>
        )}
      </div>

      {showConfirm && file && (
        <ConfirmRestoreModal
          file={file}
          busy={restoring}
          onConfirm={doRestore}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}

function color8() {
  return 'color-mix(in oklab, var(--success) 8%, var(--surface))'
}

function ConfirmRestoreModal({ file, busy, onConfirm, onCancel }) {
  return (
    <div className="sheet-backdrop" onClick={onCancel} style={{ alignItems: 'center' }}>
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460, width: '100%', padding: 24, animation: 'slideUp .25s cubic-bezier(.2,.7,.2,1)' }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 20, fontWeight: 500 }}>Replace all data?</h3>
        <p className="muted small" style={{ marginBottom: 12 }}>
          This will delete every event and person currently in your timeline and replace them
          with the contents of:
        </p>
        <p className="mono" style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: '8px 12px',
          marginBottom: 16,
          wordBreak: 'break-all',
          fontSize: 12,
        }}>
          {file.name}
        </p>
        <p className="muted small" style={{ marginBottom: 20 }}>
          Search re-indexing happens automatically and may take a minute for larger backups. This
          cannot be undone.
        </p>
        <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-accent" onClick={onConfirm} disabled={busy}>
            {busy ? 'Restoring…' : 'Replace data'}
          </button>
        </div>
      </div>
    </div>
  )
}
