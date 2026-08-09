import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { LISTINGS, LAST_UPDATED } from './data.js'
import { dist } from './utils.js'
import Header from './components/Header.jsx'
import ListPanel from './components/ListPanel.jsx'
import MapPanel from './components/MapPanel.jsx'
import DetailModal from './components/DetailModal.jsx'

const initialFilters = {
  zone: '', contract: '', type: '', pmin: null, pmax: null, smin: null, smax: null,
  rooms: '', baths: '', feats: [],
}

// Load favourites from localStorage once.
function loadFavs() {
  try {
    const s = localStorage.getItem('ct_favs')
    if (s) return new Set(JSON.parse(s))
  } catch { /* ignore */ }
  return new Set()
}

export default function App() {
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState('rel')
  const [favOnly, setFavOnly] = useState(false)
  const [favs, setFavs] = useState(loadFavs)
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
      else { next.add(id); toast('Aggiunto ai preferiti ❤️') }
      try { localStorage.setItem('ct_favs', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [toast])

  // ---- Derived list ----
  const items = useMemo(() => {
    let out = LISTINGS.filter((l) => {
      if (favOnly && !favs.has(l.id)) return false
      if (filters.zone && l.zone !== filters.zone) return false
      if (filters.contract && l.contract !== filters.contract) return false
      if (filters.type && l.type !== filters.type) return false
      if (filters.pmin != null && l.price < filters.pmin) return false
      if (filters.pmax != null && l.price > filters.pmax) return false
      if (filters.smin != null && l.size < filters.smin) return false
      if (filters.smax != null && l.size > filters.smax) return false
      if (filters.rooms && l.rooms < +filters.rooms) return false
      if (filters.baths && l.baths < +filters.baths) return false
      for (const f of filters.feats) if (!l.feats.includes(f)) return false
      return true
    })

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
  }, [filters, areaSync, bounds, mapZoom, sort, favOnly, favs, userPos])

  // ---- Map lifecycle ----
  const onMapReady = useCallback((map) => {
    mapRef.current = map
    const b = L.latLngBounds(LISTINGS.map((l) => [l.lat, l.lng])).pad(0.1)
    map.fitBounds(b)
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
    if (!navigator.geolocation) { toast('Geolocalizzazione non supportata'); return }
    toast('Rilevo la tua posizione…')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = [p.coords.latitude, p.coords.longitude]
        setUserPos(pos)
        if (window.innerWidth <= 840) setMobileView('map')
        mapRef.current?.flyTo(pos, 12, { duration: 1.2 })
        setSort('dist')
        toast('Ordinati per distanza da te')
      },
      () => toast('Impossibile rilevare la posizione'),
      { enableHighAccuracy: true, timeout: 9000 }
    )
  }, [toast])

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
    if (v === 'dist' && !userPos) toast('Prima attiva "Vicino a me" 📍')
    setSort(v)
  }, [userPos, toast])

  const setView = (v) => setMobileView(v)
  const selected = selectedId != null ? LISTINGS.find((l) => l.id === selectedId) : null

  return (
    <div className={'app' + (mobileView === 'map' ? ' mapview' : '')}>
      <Header onFlyTo={flyTo} onNearMe={onNearMe} toast={toast} />

      <div id="demobanner">
        🌊 Annunci reali dai portali (Daft.ie · Rightmove) sulle coste di Donegal e Scozia — Burtonport · North Berwick · Rosemarkie · East Neuk.
        Apri una scheda per l'annuncio originale · aggiornato {LAST_UPDATED}
      </div>

      <div id="main">
        <ListPanel
          items={items}
          filters={filters}
          favOnly={favOnly}
          favs={favs}
          userPos={userPos}
          sort={sort}
          highlightId={highlightId}
          onImmediate={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
          onApplyAdvanced={(adv) => setFilters((f) => ({ ...f, ...adv }))}
          onToggleFavOnly={() => setFavOnly((v) => !v)}
          onSortChange={onSortChange}
          onOpen={setSelectedId}
          onToggleFav={toggleFav}
          onHover={onHover}
          cardRefs={cardRefs}
        />

        <MapPanel
          items={items}
          highlightId={highlightId}
          userPos={userPos}
          areaSync={areaSync}
          onToggleAreaSync={() => setAreaSync((v) => !v)}
          onFitAll={onFitAll}
          onMarkerClick={onMarkerClick}
          onOpen={setSelectedId}
          onMapReady={onMapReady}
          onBoundsChange={onBoundsChange}
        />
      </div>

      <div id="viewtoggle">
        <button className={mobileView === 'list' ? 'on' : ''} onClick={() => setView('list')}>☰ Lista</button>
        <button className={mobileView === 'map' ? 'on' : ''} onClick={() => setView('map')}>🗺️ Mappa</button>
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
