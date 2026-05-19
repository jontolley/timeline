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
      {tags.length > 0 && (
        <div className="tag-list">
          {tags.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
              <button
                type="button"
                className="tag-remove"
                onClick={() => removeTag(tag)}
                aria-label={`Remove ${tag}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="tag-input">
        <input
          type="text"
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          placeholder="Add tag and press Enter"
        />
        <button type="button" className="btn" onClick={addTag}>Add</button>
      </div>
    </div>
  )
}
