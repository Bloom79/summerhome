import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { LISTINGS, SOLD, LAST_UPDATED } from './data.js'
import { dist } from './utils.js'
import Header from './components/Header.jsx'
import ListPanel from './components/ListPanel.jsx'
import MapPanel from './components/MapPanel.jsx'
import DetailModal from './components/DetailModal.jsx'
import { useI18n, PRICE_RANGES } from './i18n.jsx'

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


export default function App() {
  const { t } = useI18n()
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
  }), [filters, favOnly, seaOnly, gardenOnly, favs])

  // Sold/removed archive view: entries verified gone on the source portal.
  // Only the zone filter applies; each gets a stable pseudo-id for map keys.
  const soldItems = useMemo(() =>
    SOLD.map((s, i) => ({ ...s, id: 'sold-' + i }))
      .filter((s) => !filters.zone || s.zone === filters.zone),
    [filters.zone])

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
  }, [])

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
  }, [])

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

      <div id="toast" className={toastOn ? 'show' : ''}>{toastMsg}</div>
    </div>
  )
}
