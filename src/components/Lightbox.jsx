import { useEffect } from 'react'
import Gallery from './Gallery.jsx'
import { useI18n } from '../i18n.jsx'

// Fullscreen photo viewer: the same swipe strip, whole photos on black.
// Esc / ✕ / tap outside closes; ← → step (captured before the sheet's own
// keyboard handler, so Esc closes only the viewer).
export default function Lightbox({ imgs, index, onIndex, onClose }) {
  const { t } = useI18n()
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose() }
      else if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); onIndex(Math.min(imgs.length - 1, index + 1)) }
      else if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); onIndex(Math.max(0, index - 1)) }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [index, imgs.length, onIndex, onClose])
  return (
    <div id="lightbox" onClick={onClose}>
      <div className="lbgal" onClick={(e) => e.stopPropagation()}>
        <Gallery imgs={imgs} index={index} onIndex={onIndex} fit="contain" />
      </div>
      <button className="lbx" onClick={onClose} aria-label="close">✕</button>
      <div className="lbhint">{t('lb_hint')}</div>
    </div>
  )
}
