import { fmtP, ppm, hostOf, srcOf, dist, fmtDist } from '../utils.js'
import { useI18n } from '../i18n.jsx'
import Gallery from './Gallery.jsx'

export default function Card({ l, deal, updated, gbpEur, hasNote, vote = {}, profile, onVote, onToggleSeen, fav, seen, highlighted, userPos, onOpen, onToggleFav, onSeen, onHover }) {
  const { t, typeLabel, eur: eurMode } = useI18n()
  const fx = eurMode ? gbpEur : null
  const d = userPos ? dist(userPos[0], userPos[1], l.lat, l.lng) : null
  const hasImgs = Array.isArray(l.imgs) && l.imgs.length > 0
  const isNew = l.date === updated
  const reduced = Array.isArray(l.hist) && l.hist.length > 1 && l.hist[l.hist.length - 1].p < l.hist[l.hist.length - 2].p
  // Size of the latest cut, from the first tracked price (what a buyer asks).
  const drop = reduced ? Math.round((1 - l.price / l.hist[0].p) * 100) : 0
  const sea = !!l.seaView || l.feats.includes('Spiaggia')
  const garden = l.feats.includes('Giardino')
  // Tooltip carries the other currency: the € conversion normally, the
  // original £ asking price when the global € display is on.
  const eur = l.currency === 'GBP' && gbpEur ? (fx ? fmtP(l) : '≈ €' + Math.round(l.price * gbpEur).toLocaleString('it-IT')) : null
  const perSqm = ppm(l, fx)
  return (
    <div
      className={'card' + (highlighted ? ' hl' : '') + (seen ? ' seen' : '')}
      onClick={() => onOpen(l.id)}
      onMouseEnter={() => onHover(l.id, true)}
      onMouseLeave={() => onHover(l.id, false)}
    >
      <div className="cimg">
        {hasImgs
          ? <Gallery imgs={l.imgs} />
          : <div className="cimg-ph">📷</div>}
        <div className="ctags">
          <span className={'tag' + (l.contract === 'rent' ? ' rent' : '')}>{l.contract === 'rent' ? t('tag_rent') : t('tag_sale')}</span>
          {sea && <span className="fb" title={t('sea_view')}>🌊</span>}
          {garden && <span className="fb" title={t('garden')}>🌳</span>}
        </div>
        {seen && <span className="seenb">👁 {t('seen_badge')}</span>}
        <button className="fav" onClick={(e) => { e.stopPropagation(); onToggleFav(l.id) }}>{fav ? '❤️' : '🤍'}</button>
        <div className="votebtns">
          <button className={'vbtn' + (vote[profile] === 1 ? ' yes' : '')} onClick={(e) => { e.stopPropagation(); onVote(l.url, 1) }}>👍</button>
          <button className={'vbtn' + (vote[profile] === -1 ? ' no' : '')} onClick={(e) => { e.stopPropagation(); onVote(l.url, -1) }}>👎</button>
          <button className={'vbtn' + (seen ? ' seendone' : '')} title={t(seen ? 'seen_unmark' : 'seen_mark')} onClick={(e) => { e.stopPropagation(); onToggleSeen(l.id) }}>👁</button>
        </div>
        <span className="price" title={eur || undefined}>{fmtP(l, fx)}</span>
      </div>
      <div className="cbody">
        <div className="ctitle">
          {isNew && <span className="newb">✨ {t('new_badge')}</span>}
          {reduced && <span className="newb redb">📉 {t('reduced_badge')}{drop > 0 ? ` −${drop}%` : ''}</span>}
          {(l.auction || l.feats.includes('Asta')) && <span className="newb aucb">🔨 {t('auction_badge')}{l.auction ? ` ${l.auction.slice(8, 10)}/${l.auction.slice(5, 7)}` : ''}</span>}
          {deal && <span className={'newb dealb' + (deal.tier === 'top' ? ' top' : '')}>{deal.tier === 'top' ? '🔥' : '💎'} {t('deal_badge')} {deal.score}</span>}
          {hasNote && <span className="noteb" title={t('notes_label')}>📝</span>}
          {Object.entries(vote).filter(([n]) => n !== profile).map(([n, v]) => (
            <span key={n} className={'voteb ' + (v === 1 ? 'yes' : 'no')}>{v === 1 ? '👍' : '👎'} {n}</span>
          ))}
          {l.title}
        </div>
        <div className="caddr">📍 {l.addr}</div>
        <div className="cstats">
          {l.size ? <span><b>{l.size}</b> m²</span> : null}
          {perSqm ? <span className="ppm" title={t('ppm_title')}>{perSqm}</span> : null}
          {l.rooms ? <span dangerouslySetInnerHTML={{ __html: t(l.rooms === 1 ? 'bed_one' : 'bed_many', { n: `<b>${l.rooms}</b>` }) }} /> : null}
          {l.baths ? <span dangerouslySetInnerHTML={{ __html: t(l.baths === 1 ? 'bath_one' : 'bath_many', { n: `<b>${l.baths}</b>` }) }} /> : null}
          <span>{typeLabel(l.type)}</span>
          {l.date && <span className="cdate" title={t('added_title')}>📅 {l.date.slice(8, 10)}/{l.date.slice(5, 7)}</span>}
          {srcOf(l.url) && <span className={'srcb srcb-' + srcOf(l.url).key}>{srcOf(l.url).label}</span>}
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
