import { useEffect, useState } from 'react'
import { fmtP, priceSym, hostOf, imgUrl, handleImgError } from '../utils.js'
import { useI18n } from '../i18n.jsx'

// Airports relevant to the portal's coasts; the modal shows driving time
// from the closest one (OSRM demo server, cached per listing).
const GATES = [
  ['Edimburgo', 55.9508, -3.3615],
  ['Glasgow', 55.8642, -4.4331],
  ['Inverness', 57.5425, -4.0475],
  ['Aberdeen', 57.2019, -2.1978],
  ['Dublino', 53.4264, -6.2499],
  ['Donegal', 55.0442, -8.3410],
]
const travelCache = (() => { try { return JSON.parse(localStorage.getItem('ct_travel')) || {} } catch { return {} } })()
const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`)

export default function DetailModal({ l, fav, similar = [], onOpenListing, gbpEur, note, onSaveNote, onClose, onToggleFav, onShowOnMap, toast }) {
  const { t, featLabel, listingDesc } = useI18n()

  const eur = l.currency === 'GBP' && gbpEur ? '≈ €' + Math.round(l.price * gbpEur).toLocaleString('it-IT') : null

  // Street View often has no imagery at the exact property point in rural
  // areas: snap to the nearest road first (OSRM), where coverage lives.
  const openStreetView = async (e) => {
    e.preventDefault()
    const w = window.open('about:blank', '_blank')
    let la = l.lat, ln = l.lng
    try {
      const j = await (await fetch(`https://router.project-osrm.org/nearest/v1/driving/${l.lng},${l.lat}`)).json()
      const loc = j?.waypoints?.[0]?.location
      if (loc) { ln = loc[0]; la = loc[1] }
    } catch { /* fall back to the raw point */ }
    const url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${la},${ln}`
    if (w) w.location = url
    else window.open(url, '_blank')
  }

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

  // Driving time from the nearest airport (one OSRM table request, cached).
  const [travel, setTravel] = useState(null)
  useEffect(() => {
    setTravel(travelCache[l.url] || null)
    if (travelCache[l.url]) return
    let alive = true
    const coords = [...GATES.map((g) => `${g[2]},${g[1]}`), `${l.lng},${l.lat}`].join(';')
    fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=${GATES.map((_, i) => i).join(';')}&destinations=${GATES.length}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive || j.code !== 'Ok') return
        let best = null
        j.durations.forEach((row, i) => {
          const s = row && row[0]
          if (s != null && (best == null || s < best.s)) best = { s, g: GATES[i][0] }
        })
        if (!best) return
        const rec = { g: best.g, min: Math.round(best.s / 60) }
        travelCache[l.url] = rec
        try { localStorage.setItem('ct_travel', JSON.stringify(travelCache)) } catch { /* full */ }
        setTravel(rec)
      })
      .catch(() => { /* offline or OSRM busy: just hide the line */ })
    return () => { alive = false }
  }, [l.url, l.lat, l.lng])

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
            {travel && <div className="travel">🚗 {t('travel_from', { t: fmtDur(travel.min), g: travel.g })}</div>}
            <div className="loclinks">
              <a href={`https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`} target="_blank" rel="noopener noreferrer">{t('loc_gmaps')}</a>
              <a href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${l.lat},${l.lng}`} onClick={openStreetView} target="_blank" rel="noopener noreferrer">{t('loc_street')}</a>
              <a href={`https://www.google.com/maps/@${l.lat},${l.lng},400m/data=!3m1!1e3`} target="_blank" rel="noopener noreferrer">{t('loc_sat')}</a>
              <a onClick={() => { onClose(); onShowOnMap(l.id) }}>{t('loc_show_map')}</a>
            </div>
          </div>

          {similar.length > 0 && (
            <div className="simbox">
              <h4>{t('sim_title')}</h4>
              <div className="simrow">
                {similar.map((s) => (
                  <div key={s.id} className="simcard" onClick={() => onOpenListing(s.id)}>
                    {s.imgs?.length
                      ? <img src={imgUrl(s.imgs[0])} onError={(e) => handleImgError(e)} alt="" />
                      : <div className="simph">🏠</div>}
                    <div className="simp">{fmtP(s)}</div>
                    <div className="sima">{(s.addr || '').split(',')[0]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
