import { fmtP, imgUrl, handleImgError, hostOf, dist, fmtDist } from '../utils.js'
import { useI18n } from '../i18n.jsx'

export default function Card({ l, updated, fav, seen, highlighted, userPos, onOpen, onToggleFav, onSeen, onHover }) {
  const { t, typeLabel } = useI18n()
  const d = userPos ? dist(userPos[0], userPos[1], l.lat, l.lng) : null
  const hasImgs = Array.isArray(l.imgs) && l.imgs.length > 0
  const isNew = l.date === updated
  return (
    <div
      className={'card' + (highlighted ? ' hl' : '') + (seen ? ' seen' : '')}
      onClick={() => onOpen(l.id)}
      onMouseEnter={() => onHover(l.id, true)}
      onMouseLeave={() => onHover(l.id, false)}
    >
      <div className="cimg">
        {hasImgs
          ? <img loading="lazy" src={imgUrl(l.imgs[0])} onError={(e) => handleImgError(e)} alt="" />
          : <div className="cimg-ph">📷</div>}
        <span className={'tag' + (l.contract === 'rent' ? ' rent' : '')}>{l.contract === 'rent' ? t('tag_rent') : t('tag_sale')}</span>
        {seen && <span className="seenb">👁 {t('seen_badge')}</span>}
        <button className="fav" onClick={(e) => { e.stopPropagation(); onToggleFav(l.id) }}>{fav ? '❤️' : '🤍'}</button>
        <span className="price">{fmtP(l)}</span>
        {hasImgs && <span className="nimg">📷 {l.imgs.length}</span>}
      </div>
      <div className="cbody">
        <div className="ctitle">{isNew && <span className="newb">✨ {t('new_badge')}</span>}{l.title}</div>
        <div className="caddr">📍 {l.addr}</div>
        <div className="cstats">
          {l.size ? <span><b>{l.size}</b> m²</span> : null}
          {l.rooms ? <span dangerouslySetInnerHTML={{ __html: t(l.rooms === 1 ? 'bed_one' : 'bed_many', { n: `<b>${l.rooms}</b>` }) }} /> : null}
          {l.baths ? <span dangerouslySetInnerHTML={{ __html: t(l.baths === 1 ? 'bath_one' : 'bath_many', { n: `<b>${l.baths}</b>` }) }} /> : null}
          <span>{typeLabel(l.type)}</span>
        </div>
        {d != null && <div className="cdist">📏 {t('dist_from_you', { d: fmtDist(d) })}</div>}
        {l.url && (
          <a
            className="csrc"
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.stopPropagation(); if (onSeen) onSeen(l.id) }}
          >
            🔗 {t('view_on', { host: hostOf(l.url) })} →
          </a>
        )}
      </div>
    </div>
  )
}
