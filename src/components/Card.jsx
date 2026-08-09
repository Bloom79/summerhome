import { fmtP, imgUrl, handleImgError, dist, fmtDist } from '../utils.js'

export default function Card({ l, fav, highlighted, userPos, onOpen, onToggleFav, onHover }) {
  const d = userPos ? dist(userPos[0], userPos[1], l.lat, l.lng) : null
  return (
    <div
      className={'card' + (highlighted ? ' hl' : '')}
      onClick={() => onOpen(l.id)}
      onMouseEnter={() => onHover(l.id, true)}
      onMouseLeave={() => onHover(l.id, false)}
    >
      <div className="cimg">
        <img loading="lazy" src={imgUrl(l.imgs[0])} onError={(e) => handleImgError(e, l.imgs[0])} alt="" />
        <span className={'tag' + (l.contract === 'rent' ? ' rent' : '')}>{l.contract === 'rent' ? 'Affitto' : 'Vendita'}</span>
        <button className="fav" onClick={(e) => { e.stopPropagation(); onToggleFav(l.id) }}>{fav ? '❤️' : '🤍'}</button>
        <span className="price">{fmtP(l)}</span>
        <span className="nimg">📷 {l.imgs.length}</span>
      </div>
      <div className="cbody">
        <div className="ctitle">{l.title}</div>
        <div className="caddr">📍 {l.addr}</div>
        <div className="cstats">
          {l.size ? <span><b>{l.size}</b> m²</span> : null}
          {l.rooms ? <span><b>{l.rooms}</b> camer{l.rooms === 1 ? 'a' : 'e'}</span> : null}
          {l.baths ? <span><b>{l.baths}</b> bagn{l.baths === 1 ? 'o' : 'i'}</span> : null}
          <span>{l.type}</span>
        </div>
        {d != null && <div className="cdist">📏 a {fmtDist(d)} da te</div>}
      </div>
    </div>
  )
}
