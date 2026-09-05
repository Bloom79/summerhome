import { useEffect, useRef, useState } from 'react'
import { imgUrl, handleImgError } from '../utils.js'

// Finger-swipeable photo strip (CSS scroll-snap — no JS gestures, no
// arrows) with a position counter and dots. The parent element provides the
// positioning context and size (.cimg on cards, .popimg in map popups, …).
//
// `index`/`onIndex` make it controllable: thumbnails or keyboard arrows set
// the index and the strip scrolls there; a swipe reports the new index back.
// `onTap` fires on a plain tap/click with the current index (lightbox).
// `fit="contain"` shows whole photos on a dark ground (fullscreen viewer).
export default function Gallery({ imgs, index, onIndex, onTap, fit }) {
  const [inner, setInner] = useState(0)
  // Only the first photo is in the DOM until the strip is touched, hovered
  // or driven (thumbnail/keyboard): a page of cards stays a few hundred
  // <img>s instead of thousands.
  const [armed, setArmed] = useState(!!(index != null && index > 0) || fit === 'contain')
  const arm = () => { if (!armed) setArmed(true) }
  const idx = index ?? inner
  const ref = useRef(null)
  const report = (i) => { setInner(i); if (onIndex) onIndex(i) }
  const onScroll = () => {
    const el = ref.current
    if (!el || !el.clientWidth) return
    const i = Math.min(imgs.length - 1, Math.round(el.scrollLeft / el.clientWidth))
    if (i !== idx) report(i)
  }
  // External index change (thumbnail, keyboard): bring the strip there.
  useEffect(() => {
    if (index != null && index > 0) setArmed(true)
    const el = ref.current
    if (!el || index == null || !el.clientWidth) return
    const cur = Math.round(el.scrollLeft / el.clientWidth)
    // Instant: a smooth scroll can be cut short by the mandatory snap and
    // stop between two photos; the snap makes the jump land exactly.
    if (cur !== index) el.scrollTo({ left: index * el.clientWidth, behavior: 'auto' })
  }, [index, armed])
  // A different photo set (another listing in the same sheet): back to the
  // start — but not on mount, where the controlled `index` (lightbox opened
  // on photo 5) must win over a reset to 0.
  const firstRef = useRef(true)
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return }
    const el = ref.current
    const i = index ?? 0
    if (el) el.scrollTo({ left: i * el.clientWidth })
    setInner(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgs])
  return (
    <>
      <div className={'sgal' + (fit === 'contain' ? ' contain' : '')} ref={ref} onScroll={onScroll} onClick={onTap ? () => onTap(idx) : undefined}
        onPointerEnter={arm} onTouchStart={arm} onFocus={arm}>
        {(armed ? imgs : imgs.slice(0, 1)).map((src, i) => (
          <img key={i} loading={i === 0 ? 'eager' : 'lazy'} src={imgUrl(src)} onError={(e) => handleImgError(e)} alt="" draggable={false} />
        ))}
      </div>
      {imgs.length > 1 && <span className="sgaln">📷 {idx + 1}/{imgs.length}</span>}
      {imgs.length > 1 && imgs.length <= 12 && (
        <div className="sgaldots">
          {imgs.map((_, i) => <i key={i} className={i === idx ? 'on' : ''} />)}
        </div>
      )}
    </>
  )
}
