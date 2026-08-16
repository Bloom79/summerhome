import { useEffect, useState } from 'react'
import { fmtP, priceSym, hostOf, imgUrl, handleImgError } from '../utils.js'
import { useI18n } from '../i18n.jsx'

export default function DetailModal({ l, fav, gbpEur, note, onSaveNote, onClose, onToggleFav, onShowOnMap, toast }) {
  const { t, featLabel, listingDesc } = useI18n()

  const eur = l.currency === 'GBP' && gbpEur ? '≈ €' + Math.round(l.price * gbpEur).toLocaleString('it-IT') : null

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?casa=${l.id}`
    if (navigator.share) {
      try { await navigator.share({ title: l.title, url }) } catch { /* user dismissed */ }
      return
    }
    try { await navigator.clipboard.writeText(url); toast(t('t_link_copied')) } catch { /* clipboard denied */ }
  }
  const [idx, setIdx] = useState(0)
  const hasImgs = Array.isArray(l.imgs) && l.imgs.length > 0
  const move = (d) => { if (hasImgs) setIdx((i) => (i + d + l.imgs.length) % l.imgs.length) }

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

  const ppm = l.contract === 'sale' && l.size
    ? priceSym(l) + ' ' + Math.round(l.price / l.size).toLocaleString('en-GB') + '/m²'
    : ''

  return (
    <div id="modal" onClick={(e) => { if (e.target.id === 'modal') onClose() }}>
      <div className="mcard">
        <button className="mclose" onClick={onClose}>✕</button>

        <div className="gal">
          {hasImgs ? (
            <>
              <img className="gmain" src={imgUrl(l.imgs[idx])} onError={(e) => handleImgError(e, l.imgs[idx])} alt="" />
              {l.imgs.length > 1 && (
                <>
                  <button className="gnav prev" onClick={() => move(-1)}>‹</button>
                  <button className="gnav next" onClick={() => move(1)}>›</button>
                </>
              )}
            </>
          ) : (
            <div className="gmain gph">
              <div className="gph-ico">🏠</div>
              <div className="gph-txt">{t('gal_ph')}</div>
              {l.url && (
                <a className="gph-link" href={l.url} target="_blank" rel="noopener noreferrer">{t('gal_open')}</a>
              )}
            </div>
          )}
        </div>

        {hasImgs && l.imgs.length > 1 && (
          <div className="thumbs">
            {l.imgs.map((k, i) => (
              <img key={i} src={imgUrl(k)} onError={(e) => handleImgError(e, k)} className={i === idx ? 'on' : ''} onClick={() => setIdx(i)} alt="" />
            ))}
          </div>
        )}

        <div className="mbody">
          <div className="mhead">
            <div><div className="mtitle">{l.title}</div></div>
            <div className="mprice">{fmtP(l)}<br /><small>{[eur, ppm].filter(Boolean).join(' · ')}</small></div>
          </div>
          <div className="maddr">📍 {l.addr}{l.town ? ` — ${l.town}` : ''}</div>
          {l.url && (
            <div className="msource">
              🔗 {t('src_label')}:{' '}
              <a href={l.url} target="_blank" rel="noopener noreferrer">{hostOf(l.url)}</a>
            </div>
          )}

          <div className="mstats">
            {l.date ? <div className="stat"><b>{l.date.slice(8, 10)}/{l.date.slice(5, 7)}</b><span>{t('st_added')}</span></div> : null}
            {l.size ? <div className="stat"><b>{l.size} m²</b><span>{t('st_area')}</span></div> : null}
            {l.rooms ? <div className="stat"><b>{l.rooms}</b><span>{t('st_rooms')}</span></div> : null}
            {l.baths ? <div className="stat"><b>{l.baths}</b><span>{t('st_baths')}</span></div> : null}
            {l.floor ? <div className="stat"><b>{l.floor}</b><span>{t('st_floor')}</span></div> : null}
            {l.year ? <div className="stat"><b>{l.year}</b><span>{t('st_year')}</span></div> : null}
            {l.energy ? <div className="stat"><b>{l.energy}</b><span>{t('st_epc')}</span></div> : null}
          </div>

          {Array.isArray(l.hist) && l.hist.length > 1 && (
            <div className="mhist">
              📉 {t('st_hist')}: {l.hist.map((h) => `${priceSym(l)}${h.p.toLocaleString('en-GB')} (${h.d.slice(8, 10)}/${h.d.slice(5, 7)})`).join(' → ')}
            </div>
          )}

          <p className="mdesc">{listingDesc(l)}</p>
          <div className="mfeats">{l.feats.map((f) => <span key={f}>✓ {featLabel(f)}</span>)}</div>

          <div className="locbox">
            <h4>{t('loc_title')}</h4>
            <div className="coords">{l.lat.toFixed(6)}, {l.lng.toFixed(6)}</div>
            <div className="loclinks">
              <a href={`https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`} target="_blank" rel="noopener noreferrer">{t('loc_gmaps')}</a>
              <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${l.lat},${l.lng}`} target="_blank" rel="noopener noreferrer">{t('loc_street')}</a>
              <a onClick={() => { onClose(); onShowOnMap(l.id) }}>{t('loc_show_map')}</a>
            </div>
          </div>

          <div className="notesbox">
            <h4>{t('notes_label')}</h4>
            <textarea
              value={note || ''}
              placeholder={t('notes_ph')}
              onChange={(e) => onSaveNote(l.url, e.target.value)}
              rows={3}
            />
          </div>

          <div className="mcta">
            {l.url && (
              <a className="btn primary" href={l.url} target="_blank" rel="noopener noreferrer" style={{ textAlign: 'center', textDecoration: 'none' }}>{t('view_original')}</a>
            )}
            <button className="btn ghost" onClick={() => onToggleFav(l.id)}>{fav ? t('saved') : t('save')}</button>
            <button className="btn ghost" onClick={share}>🔗 {t('share')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
