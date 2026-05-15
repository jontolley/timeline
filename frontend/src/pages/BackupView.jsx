import { Link } from 'react-router-dom'

export default function BackupView() {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="max-w-2xl">
      <Link to="/" className="text-blue-600 hover:underline text-sm mb-4 block">
        &larr; Back to Timeline
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Backup</h1>
      <p className="text-sm text-gray-600 mb-6">
        Download a copy of every event and person in your timeline. Keep this
        somewhere safe — it's your data.
      </p>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-100">
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
