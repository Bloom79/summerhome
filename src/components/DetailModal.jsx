import { useEffect, useState } from 'react'
import { fmtP, imgUrl, handleImgError } from '../utils.js'

export default function DetailModal({ l, fav, onClose, onToggleFav, onShowOnMap, toast }) {
  const [idx, setIdx] = useState(0)
  const move = (d) => setIdx((i) => (i + d + l.imgs.length) % l.imgs.length)

  // Reset gallery when a different listing opens.
  useEffect(() => { setIdx(0) }, [l.id])

  // Keyboard: Esc closes, arrows navigate the gallery.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') move(1)
      else if (e.key === 'ArrowLeft') move(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l])

  const ppm = l.contract === 'sale' ? '€ ' + Math.round(l.price / l.size).toLocaleString('it-IT') + '/m²' : ''

  return (
    <div id="modal" onClick={(e) => { if (e.target.id === 'modal') onClose() }}>
      <div className="mcard">
        <button className="mclose" onClick={onClose}>✕</button>

        <div className="gal">
          <img className="gmain" src={imgUrl(l.imgs[idx])} onError={(e) => handleImgError(e, l.imgs[idx])} alt="" />
          {l.imgs.length > 1 && (
            <>
              <button className="gnav prev" onClick={() => move(-1)}>‹</button>
              <button className="gnav next" onClick={() => move(1)}>›</button>
            </>
          )}
        </div>

        {l.imgs.length > 1 && (
          <div className="thumbs">
            {l.imgs.map((k, i) => (
              <img key={i} src={imgUrl(k)} onError={(e) => handleImgError(e, k)} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} alt="" />
            ))}
          </div>
        )}

        <div className="mbody">
          <div className="mhead">
            <div><div className="mtitle">{l.title}</div></div>
            <div className="mprice">{fmtP(l)}<br /><small>{ppm}</small></div>
          </div>
          <div className="maddr">📍 {l.addr} — {l.city}</div>

          <div className="mstats">
            <div className="stat"><b>{l.size} m²</b><span>Superficie</span></div>
            <div className="stat"><b>{l.rooms}</b><span>Locali</span></div>
            <div className="stat"><b>{l.baths}</b><span>Bagni</span></div>
            <div className="stat"><b>{l.floor}</b><span>Piano</span></div>
            <div className="stat"><b>{l.year}</b><span>Anno</span></div>
            <div className="stat"><b>{l.energy}</b><span>Classe energ.</span></div>
          </div>

          <p className="mdesc">{l.desc}</p>
          <div className="mfeats">{l.feats.map((f) => <span key={f}>✓ {f}</span>)}</div>

          <div className="locbox">
            <h4>📌 Localizzazione precisa</h4>
            <div className="coords">{l.lat.toFixed(6)}, {l.lng.toFixed(6)}</div>
            <div className="loclinks">
              <a href={`https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`} target="_blank" rel="noopener noreferrer">Apri in Google Maps</a>
              <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${l.lat},${l.lng}`} target="_blank" rel="noopener noreferrer">Street View</a>
              <a onClick={() => { onClose(); onShowOnMap(l.id) }}>Mostra sulla mappa</a>
            </div>
          </div>

          <div className="mcta">
            <button className="btn primary" onClick={() => toast("Richiesta inviata! Un agente ti contatterà (demo)")}>✉️ Contatta l'agenzia</button>
            <button className="btn accent" onClick={() => toast('Visita richiesta! Ti proporremo 3 orari (demo)')}>📅 Prenota visita</button>
            <button className="btn ghost" onClick={() => onToggleFav(l.id)}>{fav ? '❤️ Salvato' : '🤍 Salva'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
