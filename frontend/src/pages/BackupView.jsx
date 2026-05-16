import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePeopleStore } from '../store'

export default function BackupView() {
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
      const res = await fetch('/api/backup/restore', { method: 'POST', body: fd })
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

  return (
    <div className="max-w-2xl">
      <Link to="/" className="text-blue-600 hover:underline text-sm mb-4 block">
        &larr; Back to Timeline
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Backup &amp; restore</h1>
      <p className="text-sm text-gray-600 mb-6">
        Download a copy of every event and person, or replace your timeline
        from a previous backup file.
      </p>

      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Download</h2>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100 mb-8">
        <BackupOption
          title="JSON"
          description="Single file with the full structure preserved (best for re-importing later)."
          filename={`timeline-backup-${today}.json`}
          href="/api/backup/json"
        />
        <BackupOption
          title="CSV"
          description="Zip containing events.csv and people.csv (easy to open in a spreadsheet)."
          filename={`timeline-backup-${today}.zip`}
          href="/api/backup/csv"
        />
      </div>

      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Restore</h2>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-4">
        <p className="text-xs text-gray-500 mb-3">
          Upload a JSON backup or a zip from a CSV download. The restore will
          <span className="font-semibold text-red-600"> replace </span>
          all current events and people.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip,application/json,application/zip"
            onChange={handleFile}
            className="text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-gray-300 file:text-sm file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100"
          />
          <button
            onClick={startRestore}
            disabled={!file || restoring}
            className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            Restore
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}
        {result && !error && (
          <p className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            Restored {result.events_restored} events and {result.people_restored} people
            {typeof result.events_indexed === 'number' && result.events_indexed !== result.events_restored
              ? ` (${result.events_indexed} re-indexed for search)`
              : ''}
            .
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

function BackupOption({ title, description, filename, href }) {
  return (
    <div className="px-5 py-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{description}</p>
        <p className="text-xs text-gray-400 mt-1 font-mono truncate">{filename}</p>
      </div>
      <a
        href={href}
        download
        className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors shrink-0"
      >
        Download
      </a>
    </div>
  )
}

function ConfirmRestoreModal({ file, busy, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 max-w-md w-full p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Replace all data?</h2>
        <p className="text-sm text-gray-600 mb-3">
          This will delete every event and person currently in your timeline
          and replace them with the contents of:
        </p>
        <p className="text-sm font-mono text-gray-800 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mb-4 break-all">
          {file.name}
        </p>
        <p className="text-xs text-gray-500 mb-5">
          Search re-indexing happens automatically and may take a minute for
          larger backups. This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Restoring…' : 'Replace data'}
          </button>
        </div>
      </div>
    </div>
  )
}
