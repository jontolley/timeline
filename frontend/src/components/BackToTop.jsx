import { useEffect, useState } from 'react'

/**
 * Floating "back to top" pill. Appears after the user scrolls past `threshold`
 * px and scrolls the window back to the top on click.
 */
export default function BackToTop({ threshold = 600 }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let rafId = null
    const update = () => {
      rafId = null
      setVisible(window.scrollY > threshold)
    }
    const onScroll = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [threshold])

  const onClick = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  return (
    <button
      type="button"
      className={`back-to-top${visible ? ' on' : ''}`}
      aria-label="Back to top"
      tabIndex={visible ? 0 : -1}
      onClick={onClick}
    >
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 13 V3 M3 8 L8 3 L13 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
