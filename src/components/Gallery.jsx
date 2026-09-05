import { useRef, useState } from 'react'
import { imgUrl, handleImgError } from '../utils.js'

// Finger-swipeable photo strip (CSS scroll-snap — no JS gestures) with a
// position counter and dots. The parent element provides the positioning
// context and size (.cimg on cards, .popimg in map popups).
export default function Gallery({ imgs }) {
  const [idx, setIdx] = useState(0)
  const ref = useRef(null)
  const onScroll = () => {
    const el = ref.current
    if (el && el.clientWidth) setIdx(Math.min(imgs.length - 1, Math.round(el.scrollLeft / el.clientWidth)))
  }
  // Mouse users have no swipe: arrows (shown on hover, pointer devices only)
  // step the strip one photo at a time. They must not open the card.
  const step = (e, d) => {
    e.stopPropagation(); e.preventDefault()
    const el = ref.current
    if (!el) return
    const n = Math.max(0, Math.min(imgs.length - 1, idx + d))
    // Instant jump: a smooth scroll gets cancelled midway by the strip's
    // mandatory scroll-snap in Chrome and lands between two photos.
    el.scrollTo({ left: n * el.clientWidth, behavior: 'auto' })
  }
  return (
    <>
      <div className="sgal" ref={ref} onScroll={onScroll}>
        {imgs.map((src, i) => (
          <img key={src} loading={i === 0 ? 'eager' : 'lazy'} src={imgUrl(src)} onError={(e) => handleImgError(e)} alt="" />
        ))}
      </div>
      {imgs.length > 1 && <span className="sgaln">📷 {idx + 1}/{imgs.length}</span>}
      {imgs.length > 1 && idx > 0 && <button className="sgalarr prev" aria-label="prev" onClick={(e) => step(e, -1)}>‹</button>}
      {imgs.length > 1 && idx < imgs.length - 1 && <button className="sgalarr next" aria-label="next" onClick={(e) => step(e, 1)}>›</button>}
      {imgs.length > 1 && (
        <div className="sgaldots">
          {imgs.map((_, i) => <i key={i} className={i === idx ? 'on' : ''} />)}
        </div>
      )}
    </>
  )
}
