import { useEffect, useRef, useState } from 'react'
import { fmtP, priceSym, hostOf, srcOf, imgUrl, handleImgError, buyTax } from '../utils.js'
import { useI18n } from '../i18n.jsx'
import { DealChecks } from './DealsModal.jsx'
import { analyzeListing } from '../analyze.js'
import { CERCA_QUI_ENDPOINT } from '../config.js'

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

// Nearby essentials (beach / pub / shop) via Overpass, cached per listing.
const poiCache = (() => { try { return JSON.parse(localStorage.getItem('ct_poi')) || {} } catch { return {} } })()
const hav = (a, b, c, d) => {
  const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r
  const s = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(s))
}
const fmtM = (m) => (m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1)} km`)


// Minimal renderer for the agent's markdown report (bold, headings,
// bullets, links) — no markdown library needed.
function mdLite(text) {
  const linkify = (s, k) => s.split(/(https?:\/\/\S+)/g).map((seg, i) =>
    /^https?:\/\//.test(seg) ? <a key={k + '-' + i} href={seg} target="_blank" rel="noopener noreferrer">{new URL(seg).hostname.replace('www.', '')} ↗</a> : seg)
  const rich = (s, k) => s.split(/\*\*(.+?)\*\*/g).map((seg, i) => i % 2 ? <b key={k + 'b' + i}>{seg}</b> : linkify(seg, k + i))
  return text.split('\n').map((ln, i) => {
    if (ln.startsWith('## ') || ln.startsWith('---')) return null
    if (ln.startsWith('### ')) return <div className="lrh" key={i}>{rich(ln.slice(4), i)}</div>
    if (ln.startsWith('_')) return <div className="lrsm" key={i}>{ln.replace(/_/g, '')}</div>
    if (ln.startsWith('  - ')) return <div className="lrli sub" key={i}>{rich(ln.slice(4), i)}</div>
    if (ln.startsWith('- ')) return <div className="lrli" key={i}>{rich(ln.slice(2), i)}</div>
    if (!ln.trim()) return null
    return <div key={i}>{rich(ln, i)}</div>
  })
}

// On-demand live analysis: files an "Analizza:" request through the worker,
// a GitHub workflow runs scripts/analizza-live.mjs against the LIVE sources
// (~1 minute) and the report lands back here.
// Per-listing analysis state that OUTLIVES the component: closing the sheet
// mid-analysis must not lose the run, and a finished report must reappear
// instantly on reopen (id → {t0, report?, error?}).
const liveCache = new Map()

// The whole request+poll runs detached from React: it only writes liveCache
// and fires the completion notice, so unmounts can't kill it. A single
// failed poll (phone backgrounded, network blip) is retried, not fatal.
async function liveRun(l, doneMsg) {
  const entry = { t0: Date.now() }
  liveCache.set(l.id, entry)
  try {
    const r = await fetch(`${CERCA_QUI_ENDPOINT}/analizza`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: l.url, id: l.id, addr: l.addr }),
    })
    const j = await r.json()
    if (!j.issue) throw new Error(j.error || 'no issue')
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 5000))
      try {
        const s = await (await fetch(`${CERCA_QUI_ENDPOINT}/analisi?issue=${j.issue}`)).json()
        if (s.report) {
          entry.report = s.report
          if (document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const reg = await navigator.serviceWorker?.getRegistration()
            if (reg) reg.showNotification('CasaTrova', { body: `${doneMsg} — ${l.addr}`, tag: 'analisi', icon: 'icon-192.png' })
          }
          return
        }
      } catch { /* transient — keep polling */ }
    }
    throw new Error('timeout')
  } catch { entry.error = true }
}

function LiveAnalysis({ l, toast }) {
  const { t } = useI18n()
  const [st, setSt] = useState(null)
  const [sec, setSec] = useState(0)
  const notified = useRef(false)

  // Rehydrate from the cache on every listing change (or reopen).
  useEffect(() => {
    const c = liveCache.get(l.id)
    notified.current = !!c?.report
    setSt(c?.report ? { report: c.report } : c?.error ? 'err' : c ? 'run' : null)
    setSec(c && !c.report ? Math.round((Date.now() - c.t0) / 1000) : 0)
  }, [l.id])

  // While running: tick the elapsed counter and watch the cache for the
  // result — the fetch loop itself never touches component state.
  useEffect(() => {
    if (st !== 'run') return undefined
    const iv = setInterval(() => {
      const c = liveCache.get(l.id)
      if (c?.report) {
        setSt({ report: c.report })
        if (!notified.current) { notified.current = true; if (toast) toast(t('live_done')) }
      } else if (c?.error) setSt('err')
      else setSec((s) => s + 1)
    }, 1000)
    return () => clearInterval(iv)
  }, [st, l.id])

  const start = (e) => {
    e.stopPropagation()
    notified.current = false
    setSec(0)
    setSt('run')
    liveRun(l, t('live_done'))
  }
  if (st === null) return <button className="livebtn" onClick={start}>🤖 {t('live_btn')}</button>
  if (st === 'run') return (
    <div className="liverun">
      <div className="liveprog"><i /></div>
      <span>🤖 {t('live_running')} <b className="livesec">{sec}s</b></span>
    </div>
  )
  if (st === 'err') return <div className="liverun">⚠️ {t('live_err')} <button className="livebtn" onClick={start}>↻ {t('live_retry')}</button></div>
  return <div className="lreport">{mdLite(st.report)}</div>
}

export default function DetailModal({ l, deal, allListings = [], dealPages = {}, updated = '', fav, similar = [], onOpenListing, gbpEur, noteData = {}, myKey, vote = {}, profile, onVote, onSaveNote, onClose, onToggleFav, onShowOnMap, toast }) {
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

  // Nearest beach, pub and food shop within walking/short-drive range.
  const [poi, setPoi] = useState(null)
  useEffect(() => {
    setPoi(poiCache[l.url] || null)
    if (poiCache[l.url]) return
    let alive = true
    const q = `[out:json][timeout:10];(node(around:3000,${l.lat},${l.lng})["natural"="beach"];way(around:3000,${l.lat},${l.lng})["natural"="beach"];node(around:2500,${l.lat},${l.lng})["amenity"~"^(pub|bar|restaurant)$"];node(around:3000,${l.lat},${l.lng})["shop"~"^(supermarket|convenience|general)$"];);out center 60;`
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: q }) })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        const best = {}
        for (const el of j.elements || []) {
          const la = el.lat ?? el.center?.lat, ln = el.lon ?? el.center?.lon
          if (la == null) continue
          const cat = el.tags?.natural === 'beach' ? 'beach' : el.tags?.shop ? 'shop' : 'pub'
          const d = hav(l.lat, l.lng, la, ln)
          if (!best[cat] || d < best[cat]) best[cat] = d
        }
        const rec = { b: best.beach ? Math.round(best.beach) : null, p: best.pub ? Math.round(best.pub) : null, s: best.shop ? Math.round(best.shop) : null }
        poiCache[l.url] = rec
        try { localStorage.setItem('ct_poi', JSON.stringify(poiCache)) } catch { /* full */ }
        setPoi(rec)
      })
      .catch(() => { /* Overpass busy: hide the line */ })
    return () => { alive = false }
  }, [l.url, l.lat, l.lng])
  const poiLine = poi && [
    poi.b != null && `🏖 ${t('poi_beach')} ~${fmtM(poi.b)}`,
    poi.p != null && `🍺 ${t('poi_pub')} ~${fmtM(poi.p)}`,
    poi.s != null && `🛒 ${t('poi_shop')} ~${fmtM(poi.s)}`,
  ].filter(Boolean).join(' · ')

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

          <div className="mstats">
            {l.date ? <div className="stat"><b>{l.date.slice(8, 10)}/{l.date.slice(5, 7)}</b><span>{t('st_added')}</span></div> : null}
            {l.auction || l.feats.includes('Asta')
              ? <div className="stat"><b>🔨 {l.auction ? `${l.auction.slice(8, 10)}/${l.auction.slice(5, 7)}` : t('auction_badge')}</b><span>{l.auction ? t('st_auction') : t('st_auction_nd')}</span></div>
              : null}
            {l.size ? <div className="stat"><b>{l.size} m²</b><span>{t('st_area')}</span></div> : null}
            {l.rooms ? <div className="stat"><b>{l.rooms}</b><span>{t('st_rooms')}</span></div> : null}
            {l.baths ? <div className="stat"><b>{l.baths}</b><span>{t('st_baths')}</span></div> : null}
            {l.floor ? <div className="stat"><b>{l.floor}</b><span>{t('st_floor')}</span></div> : null}
            {l.year ? <div className="stat"><b>{l.year}</b><span>{t('st_year')}</span></div> : null}
            {l.energy ? <div className="stat"><b>{l.energy}</b><span>{t('st_epc')}</span></div> : null}
          </div>

          {(() => {
            const an = analyzeListing(l, allListings, gbpEur, dealPages, updated)
            // Auction lots get no score (guide prices are teasers), but the
            // live agent has auction-specific checks: keep the box for them.
            if (!an && l.feats.includes('Asta') && l.contract !== 'rent') return (
              <div className="dealbox neutral">
                <div className="dhead"><span className="dscore none">🔨</span><b>{t('auction_analysis')}</b></div>
                <div className="lrsm">{t('auction_note')}</div>
                <LiveAnalysis l={l} toast={toast} />
              </div>
            )
            if (!an) return null
            return (
              <div className={'dealbox' + (an.isDeal ? '' : ' neutral')}>
                <div className="dhead">
                  {an.isDeal
                    ? <span className={'dscore' + (an.tier === 'top' ? ' top' : '')}>{an.tier === 'top' ? '🔥' : '💎'} {an.score}/100</span>
                    : an.score > 0
                      ? <span className="dscore none">🔍 {an.score}/100</span>
                      : <span className="dscore none">🔍</span>}
                  <b>{an.isDeal ? t('deal_analysis') : t('market_analysis')}</b>
                </div>
                <div className="dbar"><i style={{ width: Math.max(an.score, 2) + '%' }} /></div>
                <DealChecks deal={an} />
                <LiveAnalysis l={l} toast={toast} />
              </div>
            )
          })()}

          {(() => {
            const tx = buyTax(l)
            if (!tx) return null
            const f = (n) => tx.sym + n.toLocaleString('it-IT')
            return (
              <div className="mtax">
                <div className="mtax-head">🏛 {t('tax_title')} <b>{f(tx.total)}</b></div>
                <small>{tx.ads ? t('tax_scot', { lbtt: f(tx.lbtt), ads: f(tx.ads) }) : t('tax_ie')}</small>
              </div>
            )
          })()}

          {l.url && (
            <div className="msource">
              {srcOf(l.url) && <span className={'srcb srcb-' + srcOf(l.url).key}>{srcOf(l.url).label}</span>}{' '}
              🔗 {t('src_label')}:{' '}
              <a href={l.url} target="_blank" rel="noopener noreferrer">{hostOf(l.url)}</a>
            </div>
          )}

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
            {poiLine && <div className="travel poi">{poiLine}</div>}
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

          <div className="votebox">
            <span className="voteq">{t('vote_q')}</span>
            <button className={'btn ghost vsel' + (vote[profile] === 1 ? ' yes' : '')} onClick={() => onVote(l.url, 1)}>👍 {t('vote_like')}</button>
            <button className={'btn ghost vsel' + (vote[profile] === -1 ? ' no' : '')} onClick={() => onVote(l.url, -1)}>👎 {t('vote_no')}</button>
            {Object.entries(vote).filter(([n]) => n !== profile).map(([n, v]) => (
              <span key={n} className={'voteb ' + (v === 1 ? 'yes' : 'no')}>{v === 1 ? '👍' : '👎'} {n}</span>
            ))}
          </div>

          <div className="notesbox">
            <h4>{t('notes_label')}</h4>
            <textarea
              value={noteData[myKey] ?? noteData._me ?? ''}
              placeholder={t('notes_ph')}
              onChange={(e) => onSaveNote(l.url, e.target.value)}
              rows={3}
            />
            {Object.entries(noteData).filter(([n]) => n !== myKey && n !== '_me').map(([n, txt]) => (
              <div className="partnernote" key={n}><b>{t('notes_of', { n })}:</b> {txt}</div>
            ))}
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
