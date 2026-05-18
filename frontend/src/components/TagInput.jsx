import { useState } from 'react'

export default function TagInput({ tags, onChange }) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const trimmed = input.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInput('')
  }

  const removeTag = (tag) => onChange(tags.filter((t) => t !== tag))

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-surface text-ink-soft ring-1 ring-ink-line px-2 py-0.5 rounded-full text-[11px]"
          >
            #{tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-ink-faint hover:text-ink leading-none"
            >
              &times;
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          placeholder="Add tag and press Enter"
          className="border border-ink-line rounded-md px-3 py-1.5 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
        <button
          type="button"
          onClick={addTag}
          className="px-3 py-1.5 bg-surface hover:bg-ink-line/40 ring-1 ring-ink-line rounded-md text-sm text-ink-soft"
        >
          Add
        </button>
      </div>
    </div>
  )
}
