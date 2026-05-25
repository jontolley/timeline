import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePeopleStore } from '../store'
import Modal from '../components/Modal'

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

  const body = (
    <>
      <header className="hs-well-head">
        <div>
          <h1 className="hs-well-title">Backup <em>&amp; restore.</em></h1>
        </div>
        <div className="hs-well-right">
          <a href="/api/backup/json" download className="btn btn-primary">
            Download JSON
          </a>
        </div>
      </header>

      <div className="hs-well-body">
      <p className="hs-well-intro">
        Download a copy of every event and person, or replace your timeline from a previous backup
        file. Restore is destructive — it replaces all current data.
      </p>

      <div className="hs-rows">
        <article className="hs-row">
          <div className="hs-row-head">
            <span className="hs-swatch" style={{ background: 'var(--accent)' }} />
            <div className="hs-row-id">
              <span className="hs-row-name">Download</span>
              <span className="hs-row-slug">timeline-backup-{today}.json</span>
            </div>
            <div className="hs-row-meta" />
            <div className="hs-row-actions">
              <a href="/api/backup/json" download className="btn">Download</a>
            </div>
          </div>
        </article>

        <article className="hs-row">
          <div className="hs-row-head" style={{ alignItems: 'flex-start' }}>
            <span className="hs-swatch" style={{ background: 'var(--danger)' }} />
            <div className="hs-row-id" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <span className="hs-row-name">Restore</span>
              <span className="hs-row-slug" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-soft)', fontFamily: 'var(--font-sans)', fontSize: 13.5 }}>
                Upload a JSON backup — replaces all current events and people.
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'center' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFile}
                  style={{ fontSize: 13, color: 'var(--ink-soft)' }}
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
              {error && <p className="hs-modal-error" style={{ marginTop: 14, marginBottom: 0 }}>{error}</p>}
              {result && !error && (
                <p style={{
                  marginTop: 14, marginBottom: 0,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: 'var(--success)',
                  background: color8(),
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                }}>
                  Restored {result.events_restored} events and {result.people_restored} people
                  {typeof result.events_indexed === 'number' && result.events_indexed !== result.events_restored
                    ? ` (${result.events_indexed} re-indexed for search)`
                    : ''}.
                </p>
              )}
            </div>
            <div className="hs-row-meta" />
            <div className="hs-row-actions" />
          </div>
        </article>
      </div>
      </div>

      {showConfirm && file && (
        <ConfirmRestoreModal
          file={file}
          busy={restoring}
          onConfirm={doRestore}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  )

  if (embedded) return body

  return (
    <div className="page-narrow">
      <Link to="/" className="back-link">← Back to timeline</Link>
      {body}
    </div>
  )
}

function color8() {
  return 'color-mix(in oklab, var(--success) 8%, var(--surface))'
}

function ConfirmRestoreModal({ file, busy, onConfirm, onCancel }) {
  return (
    <Modal
      open
      onClose={onCancel}
      eyebrow="Danger · restore"
      title="Replace"
      titleEm="all data?"
      sub="This will delete every event and person currently in your timeline and replace them with the contents of:"
      primary={
        <button type="button" className="btn btn-accent" onClick={onConfirm} disabled={busy}>
          {busy ? 'Restoring…' : 'Replace data'}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
      }
    >
      <p className="mono" style={{
        background: 'var(--feature-bg)',
        border: '1px solid var(--rule)',
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 14,
        wordBreak: 'break-all',
        fontSize: 12,
        color: 'var(--ink)',
      }}>
        {file.name}
      </p>
      <p className="muted small" style={{ marginBottom: 4 }}>
        Search re-indexing happens automatically and may take a minute for larger backups. This
        cannot be undone.
      </p>
    </Modal>
  )
}
