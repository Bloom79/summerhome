import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { LISTINGS, LAST_UPDATED } from './data.js'
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

// Bounds covering every listing — the map's initial view, so it opens on the
// houses' area instead of a whole-continent default.
const ALL_BOUNDS = L.latLngBounds(LISTINGS.map((l) => [l.lat, l.lng])).pad(0.1)

export default function App() {
  const { t } = useI18n()
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState('rel')
  const [favOnly, setFavOnly] = useState(false)
  const [seaOnly, setSeaOnly] = useState(false)
  const [gardenOnly, setGardenOnly] = useState(false)
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

  // Opening a listing's detail marks it as seen.
  const openDetail = useCallback((id) => {
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

  // Fit the map to the filtered houses whenever the filter criteria change, so
  // the view always covers exactly the current results (and no more). Keyed on
  // the criteria only — not on favouriting or on map movement.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !criteriaItems.length) return
    const b = L.latLngBounds(criteriaItems.map((l) => [l.lat, l.lng])).pad(0.12)
    map.flyToBounds(b, { duration: 0.7, maxZoom: 13 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, seaOnly, gardenOnly, favOnly])

  // ---- Map lifecycle ----
  const onMapReady = useCallback((map) => {
    mapRef.current = map
    map.fitBounds(ALL_BOUNDS)
    // Re-fit after layout settles: if the container was still sizing itself on
    // first paint, the initial fit computes a wrong (world-level) zoom.
    setTimeout(() => { map.invalidateSize(); map.fitBounds(ALL_BOUNDS) }, 150)
  }, [])

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
    if (!mapRef.current || !items.length) return
    const b = L.latLngBounds(items.map((l) => [l.lat, l.lng])).pad(0.15)
    mapRef.current.flyToBounds(b, { duration: 1 })
  }, [items])

  const onSortChange = useCallback((v) => {
    if (v === 'dist' && !userPos) toast(t('t_dist_hint'))
    setSort(v)
  }, [userPos, toast, t])

  const setView = (v) => setMobileView(v)
  const selected = selectedId != null ? LISTINGS.find((l) => l.id === selectedId) : null

  return (
    <div className={'app' + (mobileView === 'map' ? ' mapview' : '')}>
      <Header onFlyTo={flyTo} onNearMe={onNearMe} toast={toast} />

      <div id="demobanner">{t('banner', { date: LAST_UPDATED })}</div>

      <div id="main">
        <ListPanel
          items={items}
          filters={filters}
          favOnly={favOnly}
          seaOnly={seaOnly}
          gardenOnly={gardenOnly}
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
          onSortChange={onSortChange}
          onOpen={openDetail}
          onToggleFav={toggleFav}
          onSeen={markSeen}
          onHover={onHover}
          cardRefs={cardRefs}
        />

        <MapPanel
          items={items}
          highlightId={highlightId}
          userPos={userPos}
          areaSync={areaSync}
          seen={seen}
          initialBounds={ALL_BOUNDS}
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
