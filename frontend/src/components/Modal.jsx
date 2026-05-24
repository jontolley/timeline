import { useEffect, useRef } from 'react'

/**
 * Reusable settings/add-item dialog matching the Hindsite design.
 *
 * Children form the body. The footer is a separate slot (Cancel + primary action).
 * Submitting with Enter inside a <form> child works as expected; we also wire
 * Escape to close.
 */
export default function Modal({
  open,
  onClose,
  eyebrow,
  title,
  titleEm,
  sub,
  width = 520,
  primary,
  secondary,
  children,
}) {
  const cardRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  const onBackdrop = (e) => {
    if (cardRef.current && !cardRef.current.contains(e.target)) onClose?.()
  }

  return (
    <div className="hs-modal-scrim" role="dialog" aria-modal="true" onMouseDown={onBackdrop}>
      <div
        ref={cardRef}
        className="hs-modal"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="hs-modal-head">
          <div>
            {eyebrow && (
              <p className="well-eyebrow" style={{ margin: 0 }}>
                <span className="pip" /> {eyebrow}
              </p>
            )}
            <h3>
              {title}
              {titleEm && <> <em>{titleEm}</em></>}
            </h3>
            {sub && <p className="sub">{sub}</p>}
          </div>
          <button type="button" className="hs-modal-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="hs-modal-body">{children}</div>

        <footer className="hs-modal-foot">
          <div className="actions">
            {secondary}
            {primary}
          </div>
        </footer>
      </div>
    </div>
  )
}
