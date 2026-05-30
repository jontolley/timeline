import { PALETTE } from '../utils/colors'
import Modal from './Modal'

/**
 * Create / edit dialog for a thread. Shared by Settings → Threads and the
 * event form's "New thread" pill.
 *
 * Controlled via `modalState` ({ mode: 'new'|'edit', id?, draft }) + `setDraft`
 * (an updater-taking setter), mirroring how ThreadsSettings drives it.
 */
export default function ThreadModal({ modalState, setDraft, onClose, onSubmit, busy, error }) {
  const { mode, draft } = modalState
  const isNew = mode === 'new'

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={isNew ? 'New · thread' : 'Edit · thread'}
      title={isNew ? 'A new' : 'Edit'}
      titleEm={isNew ? 'thread.' : draft.name || 'thread.'}
      sub={isNew
        ? 'Group events that belong together. You can share it later.'
        : 'Rename, recolor, or change visibility.'}
      primary={
        <button type="submit" form="hs-thread-form" className="btn btn-accent" disabled={busy || !draft.name.trim()}>
          {busy ? 'Saving…' : isNew ? 'Create thread' : 'Save'}
        </button>
      }
      secondary={
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      }
    >
      <form id="hs-thread-form" onSubmit={onSubmit}>
        {error && <p className="hs-modal-error">{error}</p>}

        <div className="field">
          <div className="field-label">
            <span>Name</span>
            <span className="hint">required</span>
          </div>
          <input
            className="field-input"
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="e.g. Travel & trips"
            autoFocus
            required
          />
        </div>

        <div className="field">
          <div className="field-label">
            <span>Color</span>
            <span className="hint">shown on the timeline</span>
          </div>
          <div className="hs-color-row">
            {PALETTE.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={draft.color === c.key}
                className={`sw${draft.color === c.key ? ' on' : ''}`}
                style={{ background: c.color }}
                onClick={() => setDraft((d) => ({ ...d, color: c.key }))}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <div className="field-label">
            <span>Visibility</span>
            <span className="hint">you can change this later</span>
          </div>
          <div className="hs-visibility">
            <button
              type="button"
              className={`hs-v-opt${draft.visibility === 'private' ? ' on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, visibility: 'private' }))}
            >
              <div className="t"><span className="dot" /> Private</div>
              <div className="d">Only you can see events in this thread.</div>
            </button>
            <button
              type="button"
              className={`hs-v-opt shared${draft.visibility === 'shared' ? ' on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, visibility: 'shared' }))}
            >
              <div className="t"><span className="dot" /> Shared</div>
              <div className="d">Invite people by email. Read-only.</div>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
