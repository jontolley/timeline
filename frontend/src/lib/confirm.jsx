// Promise-based replacements for window.confirm() and window.alert(),
// rendered with the same `sheet-backdrop` / `sheet` styling as the existing
// user-delete modal. `useConfirm()` resolves to true/false; `useAlert()`
// resolves on dismiss (no rejection).
//
// Usage:
//   const confirm = useConfirm()
//   const ok = await confirm({ title: 'Delete?', body: '...', danger: true })
//   if (!ok) return
//
//   const alert = useAlert()
//   await alert({ title: 'Upload failed', body: err.message })

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

const DialogContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)
  const resolverRef = useRef(null)

  const open = useCallback((opts) => {
    return new Promise((resolve) => {
      // If an existing dialog is open, resolve it as cancelled before
      // showing the next one. Avoids dangling promises if a caller races.
      if (resolverRef.current) {
        resolverRef.current(false)
      }
      resolverRef.current = resolve
      setDialog({
        title: opts.title || 'Confirm',
        body: opts.body || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        danger: !!opts.danger,
        hideCancel: !!opts.hideCancel,
      })
    })
  }, [])

  const close = (result) => {
    setDialog(null)
    if (resolverRef.current) {
      resolverRef.current(result)
      resolverRef.current = null
    }
  }

  const api = {
    confirm: (opts) => open({ ...opts, hideCancel: false }),
    alert: (opts) => open({
      ...opts,
      hideCancel: true,
      confirmLabel: opts.confirmLabel || 'OK',
    }),
  }

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && <Dialog {...dialog} onCancel={() => close(false)} onConfirm={() => close(true)} />}
    </DialogContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}

export function useAlert() {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useAlert must be used within ConfirmProvider')
  return ctx.alert
}

function Dialog({ title, body, confirmLabel, cancelLabel, danger, hideCancel, onCancel, onConfirm }) {
  // Esc to cancel, Enter to confirm. Body scroll locked while open.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [onCancel, onConfirm])

  return (
    <div className="sheet-backdrop" onClick={hideCancel ? undefined : onCancel} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>{title}</h3>
        {body && <p className="muted small" style={{ marginBottom: 16 }}>{body}</p>}
        <div className="form-actions" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
          {!hideCancel && (
            <button type="button" className="btn" onClick={onCancel}>{cancelLabel}</button>
          )}
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
