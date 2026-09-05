import { useEffect, useRef, useState } from 'react'
import Gallery from './Gallery.jsx'
import { imgUrl } from '../utils.js'
import { useI18n } from '../i18n.jsx'

// Fullscreen photo viewer: the same swipe strip, whole photos on black.
// Esc / ✕ / tap outside closes; ← → step (captured before the sheet's own
// keyboard handler, so Esc closes only the viewer). Double-tap (or
// double-click) zooms the current photo 2.5× in an overlay you can pan by
// dragging; double-tap again to leave.
export default function Lightbox({ imgs, index, onIndex, onClose }) {
  const { t } = useI18n()
  const [zoom, setZoom] = useState(null) // null | {x, y} pan offset in px
  const drag = useRef(null)
  const lastTap = useRef(0)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); if (zoom) setZoom(null); else onClose() }
      else if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); setZoom(null); onIndex(Math.min(imgs.length - 1, index + 1)) }
      else if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); setZoom(null); onIndex(Math.max(0, index - 1)) }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [index, imgs.length, onIndex, onClose, zoom])
  // Double-tap detection on the strip (touch) and dblclick (mouse).
  const onStripClick = () => {
    const now = Date.now()
    if (now - lastTap.current < 320) { setZoom({ x: 0, y: 0 }); lastTap.current = 0 } else lastTap.current = now
  }
  const onZoomPointerDown = (e) => { drag.current = { x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y, moved: false }; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const onZoomPointerMove = (e) => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true
    setZoom({ x: drag.current.ox + dx, y: drag.current.oy + dy })
  }
  const onZoomPointerUp = () => {
    const moved = drag.current?.moved
    drag.current = null
    if (moved) return
    const now = Date.now()
    if (now - lastTap.current < 320) { setZoom(null); lastTap.current = 0 } else lastTap.current = now
  }
  return (
    <div id="lightbox" onClick={onClose}>
      <div className="lbgal" onClick={(e) => { e.stopPropagation(); onStripClick() }}>
        <Gallery imgs={imgs} index={index} onIndex={onIndex} fit="contain" />
      </div>
      {zoom && (
        <div className="lbzoom" onClick={(e) => e.stopPropagation()} onPointerDown={onZoomPointerDown} onPointerMove={onZoomPointerMove} onPointerUp={onZoomPointerUp} onPointerCancel={() => { drag.current = null }}>
          <img src={imgUrl(imgs[index])} alt="" draggable={false} style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(2.5)` }} />
        </div>
      )}
      <button className="lbx" onClick={onClose} aria-label="close">✕</button>
      <div className="lbhint">{t('lb_hint')}</div>
    </div>
  )
}
