export default function FilterBar({ filters, tags, onChange }) {
  return (
    <div className="flex flex-wrap gap-3 mb-6">
      <select
        value={filters.event_type || ''}
        onChange={(e) => onChange({ event_type: e.target.value })}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white text-gray-700"
      >
        <option value="">All Types</option>
        <option value="career">Career</option>
        <option value="travel">Travel</option>
        <option value="milestone">Milestone</option>
        <option value="family">Family</option>
      </select>
      <select
        value={filters.tag || ''}
        onChange={(e) => onChange({ tag: e.target.value })}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white text-gray-700"
      >
        <option value="">All Tags</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            #{tag}
          </option>
        ))}
      </select>
    </div>
  )
}
