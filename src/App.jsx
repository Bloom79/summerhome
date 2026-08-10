import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { dist } from './utils.js'
import Header from './components/Header.jsx'
import ListPanel from './components/ListPanel.jsx'
import MapPanel from './components/MapPanel.jsx'
import DetailModal from './components/DetailModal.jsx'
import { useI18n, PRICE_RANGES } from './i18n.jsx'
import { CERCA_QUI_ENDPOINT } from './config.js'

const initialFilters = {
  zone: '', contract: '', type: '', priceRanges: [], smin: null, smax: null,
  rooms: '', baths: '', feats: [],
}

// A listing matches the price filter if no band is selected, or its price
// falls inside any selected band (min inclusive, max exclusive).
const inPriceBands = (price, ids) => {
  if (!ids || !ids.length) return true
  return ids.some((id) => {
    const r = PRICE_RANGES.find((x) => x.id === id)
    return r && (r.min == null || price >= r.min) && (r.max == null || price < r.max)
  })
}

// Load a Set of listing ids from localStorage once.
function loadIdSet(key) {
  try {
    const s = localStorage.getItem(key)
    if (s) return new Set(JSON.parse(s))
  } catch { /* ignore */ }
  return new Set()
}


export default function App({ initialDb }) {
  const { t } = useI18n()
  // Portal data (listings/zones/sold/updated) — hot-swappable: a handled
  // 'Cerca qui' request refreshes it in place, no page reload.
  const [db, setDb] = useState(initialDb)
  const { listings: LISTINGS, sold: SOLD, updated: LAST_UPDATED } = db
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState('rel')
  const [favOnly, setFavOnly] = useState(false)
  const [seaOnly, setSeaOnly] = useState(false)
  const [gardenOnly, setGardenOnly] = useState(false)
  const [soldView, setSoldView] = useState(false)
  const [favs, setFavs] = useState(() => loadIdSet('ct_favs'))
  const [seen, setSeen] = useState(() => loadIdSet('ct_seen'))
  const [userPos, setUserPos] = useState(null)
  const [areaSync, setAreaSync] = useState(true)
  const [bounds, setBounds] = useState(null)
  const [mapZoom, setMapZoom] = useState(6)
  const [highlightId, setHighlightId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [mobileView, setMobileView] = useState('list')
  const [toastMsg, setToastMsg] = useState('')
  const [toastOn, setToastOn] = useState(false)
  // "Trova nuove case qui" panel: null | {loading} | {place, coords, url}
  const [agentReq, setAgentReq] = useState(null)
  // Live status of a sent request: null | {phase, zone, added, t0}
  // phase: working | publishing | ready | none | deferred
  const [agentStatus, setAgentStatus] = useState(null)
  const watchRef = useRef(null)
  const [, setStatusTick] = useState(0)

  const mapRef = useRef(null)
  const cardRefs = useRef({})
  const toastTimer = useRef(null)
  const hlTimer = useRef(null)
  // Latest filter-matching listings, readable from stable callbacks.
  const criteriaRef = useRef(LISTINGS)
  // True while the map still needs its first real fit. A map mounted inside a
  // hidden container (mobile starts in list view) has size 0x0: Leaflet then
  // resolves any fit to zoom 0 — the whole world. So fits only "count" when
  // the container has a real size; until then this stays true and the
  // ResizeObserver below retries as soon as the map becomes visible.
  const needsFitRef = useRef(true)

  const toast = useCallback((m) => {
    setToastMsg(m)
    setToastOn(true)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastOn(false), 2600)
  }, [])

  // ---- Favourites ----
  const toggleFav = useCallback((id) => {
    setFavs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else { next.add(id); toast(t('t_fav_added')) }
      try { localStorage.setItem('ct_favs', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [toast])

  // ---- Seen listings (viewed detail/photos/source) — persisted ----
  const markSeen = useCallback((id) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem('ct_seen', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  // Opening a listing's detail marks it as seen. Sold-archive entries have
  // pseudo-ids and no detail modal.
  const openDetail = useCallback((id) => {
    if (typeof id !== 'number') return
    markSeen(id)
    setSelectedId(id)
  }, [markSeen])

  // ---- Derived list ----
  // Listings matching the filter criteria (zone/price/type/…) but NOT the map
  // viewport. The map fits itself to THIS set, so panning the map never fights
  // the auto-fit (that would loop). `items` then also applies the viewport.
  const criteriaItems = useMemo(() => LISTINGS.filter((l) => {
    if (favOnly && !favs.has(l.id)) return false
    if (seaOnly && !l.seaView) return false
    if (gardenOnly && !l.feats.includes('Giardino')) return false
    if (filters.zone && l.zone !== filters.zone) return false
    if (filters.contract && l.contract !== filters.contract) return false
    if (filters.type && l.type !== filters.type) return false
    if (!inPriceBands(l.price, filters.priceRanges)) return false
    if (filters.smin != null && l.size < filters.smin) return false
    if (filters.smax != null && l.size > filters.smax) return false
    if (filters.rooms && l.rooms < +filters.rooms) return false
    if (filters.baths && l.baths < +filters.baths) return false
    for (const f of filters.feats) if (!l.feats.includes(f)) return false
    return true
  }), [LISTINGS, filters, favOnly, seaOnly, gardenOnly, favs])

  // Sold/removed archive view: entries verified gone on the source portal.
  // Only the zone filter applies; each gets a stable pseudo-id for map keys.
  const soldItems = useMemo(() =>
    SOLD.map((s, i) => ({ ...s, id: 'sold-' + i }))
      .filter((s) => !filters.zone || s.zone === filters.zone),
    [SOLD, filters.zone])

  useEffect(() => { criteriaRef.current = soldView ? soldItems : criteriaItems }, [criteriaItems, soldItems, soldView])

  const items = useMemo(() => {
    let out = criteriaItems
    if (areaSync && bounds && mapZoom > 6) {
      out = out.filter((l) => bounds.contains([l.lat, l.lng]))
    }

    const arr = [...out]
    if (sort === 'pasc') arr.sort((a, b) => a.price - b.price)
    else if (sort === 'pdesc') arr.sort((a, b) => b.price - a.price)
    else if (sort === 'sdesc') arr.sort((a, b) => b.size - a.size)
    else if (sort === 'new') arr.sort((a, b) => b.date.localeCompare(a.date))
    else if (sort === 'dist' && userPos)
      arr.sort((a, b) =>
        dist(userPos[0], userPos[1], a.lat, a.lng) - dist(userPos[0], userPos[1], b.lat, b.lng))
    return arr
  }, [criteriaItems, areaSync, bounds, mapZoom, sort, userPos])

  // Fit the map to the current filter-matching houses. Only counts as done
  // when the container has a real size; otherwise it is deferred (needsFit)
  // until the ResizeObserver sees the map become visible.
  const fitToCriteria = useCallback((map, animate) => {
    const s = map.getSize()
    if (!s.x || !s.y) { needsFitRef.current = true; return }
    const src = criteriaRef.current.length ? criteriaRef.current : LISTINGS
    const b = L.latLngBounds(src.map((l) => [l.lat, l.lng])).pad(0.12)
    if (animate) map.flyToBounds(b, { duration: 0.7, maxZoom: 13 })
    else map.fitBounds(b, { maxZoom: 13 })
    needsFitRef.current = false
  }, [LISTINGS])

  // Re-fit when the filter criteria change — not on favouriting or map pans.
  const firstFit = useRef(true)
  useEffect(() => {
    if (firstFit.current) { firstFit.current = false; return }
    const map = mapRef.current
    if (!map) { needsFitRef.current = true; return }
    fitToCriteria(map, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, seaOnly, gardenOnly, favOnly, soldView])

  // ---- Map lifecycle ----
  const onMapReady = useCallback((map) => {
    mapRef.current = map
    window.ctMap = map
    fitToCriteria(map, false)
    // Whenever the container gains or changes size (first layout, mobile
    // list->map switch, rotation), refresh Leaflet's size and run any fit
    // that had to be deferred while the map was hidden.
    const ro = new ResizeObserver(() => {
      map.invalidateSize()
      if (needsFitRef.current) fitToCriteria(map, false)
    })
    ro.observe(map.getContainer())
  }, [fitToCriteria])

  const onBoundsChange = useCallback((b, z) => {
    setBounds(b)
    setMapZoom(z)
  }, [])

  // Invalidate map size when it becomes visible on mobile.
  useEffect(() => {
    if (mobileView === 'map' && mapRef.current) {
      const t = setTimeout(() => mapRef.current.invalidateSize(), 80)
      return () => clearTimeout(t)
    }
  }, [mobileView])

  // ---- Interactions ----
  const flyTo = useCallback((lat, lng, zoom) => {
    if (window.innerWidth <= 840) setMobileView('map')
    mapRef.current?.flyTo([lat, lng], zoom, { duration: 1.3 })
  }, [])

  const onNearMe = useCallback(() => {
    if (!navigator.geolocation) { toast(t('t_geo_no')); return }
    toast(t('t_geo_locating'))
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = [p.coords.latitude, p.coords.longitude]
        setUserPos(pos)
        if (window.innerWidth <= 840) setMobileView('map')
        mapRef.current?.flyTo(pos, 12, { duration: 1.2 })
        setSort('dist')
        toast(t('t_geo_sorted'))
      },
      () => toast(t('t_geo_fail')),
      { enableHighAccuracy: true, timeout: 9000 }
    )
  }, [toast, t])

  const onMarkerClick = useCallback((id) => {
    setHighlightId(id)
    const el = cardRefs.current[id]
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    clearTimeout(hlTimer.current)
    hlTimer.current = setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2200)
  }, [])

  const onHover = useCallback((id, on) => setHighlightId(on ? id : null), [])

  const onShowOnMap = useCallback((id) => {
    const l = LISTINGS.find((x) => x.id === id)
    if (!l) return
    if (window.innerWidth <= 840) setMobileView('map')
    setHighlightId(id)
    mapRef.current?.flyTo([l.lat, l.lng], 16, { duration: 1.2 })
  }, [LISTINGS])

  // "Trova nuove case qui": ask the daily agent for NEW listings in the area
  // the user is looking at (different from areaSync, which only filters the
  // houses already on the portal). Opens an in-app panel right away — spinner
  // while the map centre is reverse-geocoded, then the detected place and an
  // explicit send link. The queue is a prefilled GitHub issue that the daily
  // agent reads on its next run (see docs/daily-agent.md); the send is a real
  // <a> click, so no popup blocker is involved.
  const onAgentSearchHere = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    const z = map.getZoom()
    if (z < 9) { toast(t('t_agent_zoom')); return }
    const c = map.getCenter()
    const b = map.getBounds()
    setAgentReq({ loading: true })
    let place = ''
    try {
      const ctl = new AbortController()
      const kill = setTimeout(() => ctl.abort(), 4000)
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${c.lat}&lon=${c.lng}&zoom=12&accept-language=it,en`,
        { signal: ctl.signal }
      )
      clearTimeout(kill)
      const j = await r.json()
      place = j.name || (j.display_name || '').split(',').slice(0, 2).join(',').trim()
    } catch { /* coords-only request */ }
    const req = {
      place: place || null,
      lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5), zoom: z,
      bounds: {
        north: +b.getNorth().toFixed(5), south: +b.getSouth().toFixed(5),
        east: +b.getEast().toFixed(5), west: +b.getWest().toFixed(5),
      },
    }
    const title = `Cerca qui: ${place || `${req.lat}, ${req.lng}`}`
    const body = [
      'Richiesta **"Cerca qui"** inviata dal portale CasaTrova: aggiungere annunci in quest\'area della mappa.',
      '',
      '```json',
      JSON.stringify(req, null, 2),
      '```',
      '',
      '_Gestita dall\'agente giornaliero: definisce la zona, cerca gli annunci sui portali del paese giusto, li aggiunge al portale e chiude questa issue._',
    ].join('\n')
    const url = `https://github.com/bloom79/summerhome/issues/new?labels=cerca-qui&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
    // Keep null if the user closed the panel while the geocode was running.
    setAgentReq((prev) => (prev ? { place: place || null, coords: `${req.lat}, ${req.lng}`, url, req } : prev))
  }, [toast, t])

  // Ticker so the elapsed time in the status widget re-renders each second.
  useEffect(() => {
    const active = agentStatus && (agentStatus.phase === 'working' || agentStatus.phase === 'publishing')
    if (!active) return
    const iv = setInterval(() => setStatusTick((x) => x + 1), 1000)
    return () => clearInterval(iv)
  }, [agentStatus])

  // After a send, follow the request live: the worker's /status route (which
  // reads the GitHub issue with its own token) says whether the agent is
  // still searching or done. Once done, the fresh data.json is pulled from
  // the repo's raw endpoint (available seconds after the agent pushes, before
  // the Pages deploy even finishes) and hot-swapped in — the new houses
  // appear on the map with no reload, with their zone filter selected.
  const watchAgentRequest = useCallback((issueUrl) => {
    const m = /\/issues\/(\d+)/.exec(issueUrl || '')
    if (!m) return
    clearInterval(watchRef.current)
    const t0 = Date.now()
    let mode = 'status'
    let found = { zone: null, added: null }
    setAgentStatus({ phase: 'working', t0 })
    watchRef.current = setInterval(async () => {
      if (Date.now() - t0 > 15 * 60000) { clearInterval(watchRef.current); return }
      try {
        if (mode === 'status') {
          const j = await (await fetch(`${CERCA_QUI_ENDPOINT}/status?issue=${m[1]}`)).json()
          if (j.outcome === 'none' || j.outcome === 'deferred') {
            clearInterval(watchRef.current)
            setAgentStatus({ phase: j.outcome, t0 })
          } else if (j.outcome === 'ok' && j.state === 'closed') {
            mode = 'raw'
            found = { zone: j.zone, added: j.added }
            setAgentStatus({ phase: 'publishing', ...found, t0 })
          }
        } else {
          const fresh = await (await fetch(
            `https://raw.githubusercontent.com/bloom79/summerhome/main/public/data.json?t=${Date.now()}`,
            { cache: 'no-store' }
          )).json()
          if (!found.zone || fresh.zones.includes(found.zone)) {
            clearInterval(watchRef.current)
            setDb(fresh)
            if (found.zone) setFilters((f) => ({ ...f, zone: found.zone }))
            setAgentStatus({ phase: 'ready', ...found, t0 })
          }
        }
      } catch { /* transient; keep polling */ }
    }, 8000)
  }, [])

  // Direct one-tap send through the Cloudflare Worker (docs/cerca-qui-worker.md).
  // On failure the panel keeps the prefilled GitHub issue as a fallback link.
  const sendAgentReq = useCallback(async () => {
    const cur = agentReq
    if (!cur || cur.loading || cur.sending) return
    setAgentReq({ ...cur, sending: true, failed: false })
    try {
      const r = await fetch(CERCA_QUI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cur.req),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || !j.ok) throw new Error('send failed')
      setAgentReq(null)
      toast(t(j.duplicate ? 't_agent_dup' : 't_agent_ok'))
      watchAgentRequest(j.issueUrl)
    } catch {
      setAgentReq({ ...cur, sending: false, failed: true })
    }
  }, [agentReq, toast, t, watchAgentRequest])

  const onFitAll = useCallback(() => {
    const src = soldView ? soldItems : items
    if (!mapRef.current || !src.length) return
    const b = L.latLngBounds(src.map((l) => [l.lat, l.lng])).pad(0.15)
    mapRef.current.flyToBounds(b, { duration: 1 })
  }, [items, soldItems, soldView])

  const onSortChange = useCallback((v) => {
    if (v === 'dist' && !userPos) toast(t('t_dist_hint'))
    setSort(v)
  }, [userPos, toast, t])

  const setView = (v) => setMobileView(v)
  const selected = selectedId != null ? LISTINGS.find((l) => l.id === selectedId) : null
  const displayItems = soldView ? soldItems : items

  return (
    <div className={'app' + (mobileView === 'map' ? ' mapview' : '')}>
      <Header onFlyTo={flyTo} onNearMe={onNearMe} toast={toast} />

      <div id="demobanner">{t('banner', { date: LAST_UPDATED })}</div>

      <div id="main">
        <ListPanel
          items={displayItems}
          zones={db.zones}
          features={db.features}
          updated={LAST_UPDATED}
          filters={filters}
          favOnly={favOnly}
          seaOnly={seaOnly}
          gardenOnly={gardenOnly}
          soldView={soldView}
          soldCount={SOLD.length}
          favs={favs}
          seen={seen}
          userPos={userPos}
          sort={sort}
          highlightId={highlightId}
          onImmediate={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
          onApplyAdvanced={(adv) => setFilters((f) => ({ ...f, ...adv }))}
          onToggleFavOnly={() => setFavOnly((v) => !v)}
          onToggleSea={() => setSeaOnly((v) => !v)}
          onToggleGarden={() => setGardenOnly((v) => !v)}
          onToggleSold={() => setSoldView((v) => !v)}
          onSortChange={onSortChange}
          onOpen={openDetail}
          onToggleFav={toggleFav}
          onSeen={markSeen}
          onHover={onHover}
          cardRefs={cardRefs}
        />

        <MapPanel
          items={displayItems}
          highlightId={highlightId}
          userPos={userPos}
          areaSync={areaSync}
          seen={seen}
          soldView={soldView}
          onToggleAreaSync={() => setAreaSync((v) => !v)}
          onFitAll={onFitAll}
          onAgentSearchHere={onAgentSearchHere}
          onMarkerClick={onMarkerClick}
          onOpen={openDetail}
          onSeen={markSeen}
          onMapReady={onMapReady}
          onBoundsChange={onBoundsChange}
        />
      </div>

      <div id="viewtoggle">
        <button className={mobileView === 'list' ? 'on' : ''} onClick={() => setView('list')}>{t('vt_list')}</button>
        <button className={mobileView === 'map' ? 'on' : ''} onClick={() => setView('map')}>{t('vt_map')}</button>
      </div>

      {selected && (
        <DetailModal
          l={selected}
          fav={favs.has(selected.id)}
          onClose={() => setSelectedId(null)}
          onToggleFav={toggleFav}
          onShowOnMap={onShowOnMap}
          toast={toast}
        />
      )}

      {agentReq && (
        <div id="agentmodal" onClick={() => setAgentReq(null)}>
          <div className="agentbox" onClick={(e) => e.stopPropagation()}>
            <h3>{t('agent_title')}</h3>
            {agentReq.loading ? (
              <div className="agentload"><span className="spin" />{t('agent_locating')}</div>
            ) : (
              <>
                <div className="agentzone">📍 {agentReq.place || agentReq.coords}</div>
                <p className="agentexpl">{t('agent_explain')}</p>
                <p className="agentexpl">{t(CERCA_QUI_ENDPOINT ? 'agent_howto_direct' : 'agent_howto')}</p>
                {CERCA_QUI_ENDPOINT ? (
                  <button className="agentsend" disabled={agentReq.sending} onClick={sendAgentReq}>
                    {agentReq.sending ? t('agent_sending') : t('agent_send')}
                  </button>
                ) : (
                  <a
                    className="agentsend"
                    href={agentReq.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => { setAgentReq(null); toast(t('t_agent_sent')) }}
                  >{t('agent_send')}</a>
                )}
                {agentReq.failed && (
                  <a
                    className="agentfallback"
                    href={agentReq.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => { setAgentReq(null); toast(t('t_agent_sent')) }}
                  >{t('agent_fallback')}</a>
                )}
                <button className="agentcancel" onClick={() => setAgentReq(null)}>{t('agent_cancel')}</button>
              </>
            )}
          </div>
        </div>
      )}

      {agentStatus && (() => {
        const busy = agentStatus.phase === 'working' || agentStatus.phase === 'publishing'
        const el = Math.floor((Date.now() - agentStatus.t0) / 1000)
        const elapsed = `${Math.floor(el / 60)}:${String(el % 60).padStart(2, '0')}`
        return (
          <div id="agentdone">
            {busy && <span className="spin" />}
            <span>
              {agentStatus.phase === 'working' && t('agst_working')}
              {agentStatus.phase === 'publishing' && t('agst_publishing', { n: agentStatus.added ?? '…' })}
              {agentStatus.phase === 'ready' && t('agst_ready', { n: agentStatus.added ?? '', zone: agentStatus.zone || '' })}
              {agentStatus.phase === 'none' && t('agst_none')}
              {agentStatus.phase === 'deferred' && t('agst_deferred')}
              {busy && ` · ${elapsed}`}
            </span>
            <button className="dismiss" onClick={() => { clearInterval(watchRef.current); setAgentStatus(null) }}>✕</button>
          </div>
        )
      })()}

      <div id="toast" className={toastOn ? 'show' : ''}>{toastMsg}</div>
    </div>
  )
}
