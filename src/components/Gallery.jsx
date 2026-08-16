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
  return (
    <>
      <div className="sgal" ref={ref} onScroll={onScroll}>
        {imgs.map((src, i) => (
          <img key={src} loading={i === 0 ? 'eager' : 'lazy'} src={imgUrl(src)} onError={(e) => handleImgError(e)} alt="" />
        ))}
      </div>
      {imgs.length > 1 && <span className="sgaln">📷 {idx + 1}/{imgs.length}</span>}
      {imgs.length > 1 && (
        <div className="sgaldots">
          {imgs.map((_, i) => <i key={i} className={i === idx ? 'on' : ''} />)}
        </div>
      )}
    </>
  )
}
