import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { dist } from './utils.js'
import Header from './components/Header.jsx'
import ListPanel from './components/ListPanel.jsx'
import Filters from './components/Filters.jsx'
import MapPanel from './components/MapPanel.jsx'
import DetailModal from './components/DetailModal.jsx'
import AlertsPanel from './components/AlertsPanel.jsx'
import CompareModal from './components/CompareModal.jsx'
import StatsModal from './components/StatsModal.jsx'
import DealsModal from './components/DealsModal.jsx'
import SyncModal from './components/SyncModal.jsx'
import ProfileModal from './components/ProfileModal.jsx'
import { useI18n, PRICE_RANGES } from './i18n.jsx'
import { CERCA_QUI_ENDPOINT, VAPID_PUBLIC_KEY } from './config.js'

const initialFilters = {
  zone: '', contract: '', type: '', priceRanges: [], smin: null, smax: null,
  rooms: '', baths: '', feats: [], freshness: '',
}

// Previous-visit date (YYYY-MM-DD) for the "since my last visit" filter.
// Reloads within 6 hours count as the same visit, so the reference doesn't
// collapse to "a minute ago" on every refresh.
function trackVisit() {
  const now = Date.now()
  const rec = loadJSON('ct_visit', null)
  if (!rec) { saveJSON('ct_visit', { last: now, prev: null }); return null }
  if (now - rec.last > 6 * 3600e3) { saveJSON('ct_visit', { last: now, prev: rec.last }); return new Date(rec.last).toISOString().slice(0, 10) }
  saveJSON('ct_visit', { ...rec, last: rec.last })
  return rec.prev ? new Date(rec.prev).toISOString().slice(0, 10) : null
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

// True when the latest tracked price change was a reduction.
const isReduced = (l) => Array.isArray(l.hist) && l.hist.length > 1 &&
  l.hist[l.hist.length - 1].p < l.hist[l.hist.length - 2].p

// A listing matches the price filter if no band is selected, or its price
// falls inside any selected band (min inclusive, max exclusive).
const inPriceBands = (price, ids) => {
  if (!ids || !ids.length) return true
  return ids.some((id) => {
    const r = PRICE_RANGES.find((x) => x.id === id)
    return r && (r.min == null || price >= r.min) && (r.max == null || price < r.max)
  })
}

// ---- Saved alerts (zone + filters + event types) ----
// Matching mirrors the worker's — keep the two in sync.
const matchAlert = (l, a) =>
  (!a.zone || l.zone === a.zone) &&
  (a.priceMax == null || l.price <= a.priceMax) &&
  (a.priceMin == null || l.price >= a.priceMin) &&
  (!a.rooms || (l.rooms || 0) >= a.rooms) &&
  (!a.seaView || !!l.seaView) &&
  (!a.garden || (l.feats || []).includes('Giardino'))

const EV_KEY = { nuova: 'nuove', ribasso: 'ribassi', venduta: 'vendute' }

const loadJSON = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
const saveJSON = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* full */ } }

const b64ToU8 = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
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
  const { t, typeLabel } = useI18n()
  // Portal data (listings/zones/sold/updated) — hot-swappable: a handled
  // 'Cerca qui' request refreshes it in place, no page reload.
  const [db, setDb] = useState(initialDb)
  const { listings: LISTINGS, sold: SOLD, updated: LAST_UPDATED } = db
  // Filters and toggles survive a page refresh.
  const [ui] = useState(() => loadJSON('ct_ui', null))
  const [lastVisit] = useState(() => trackVisit())
  const [filters, setFilters] = useState(() => (ui?.filters ? { ...initialFilters, ...ui.filters } : initialFilters))
  const [sort, setSort] = useState(ui?.sort || 'rel')
  const [favOnly, setFavOnly] = useState(!!ui?.favOnly)
  const [seaOnly, setSeaOnly] = useState(!!ui?.seaOnly)
  const [gardenOnly, setGardenOnly] = useState(!!ui?.gardenOnly)
  const [beachOnly, setBeachOnly] = useState(!!ui?.beachOnly)
  const [reducedOnly, setReducedOnly] = useState(!!ui?.reducedOnly)
  const [bothOnly, setBothOnly] = useState(!!ui?.bothOnly)
  // Triage: '' = all, 'unseen' = still to review, 'seen' = already reviewed.
  const [seenFilter, setSeenFilter] = useState(ui?.seenFilter || '')
  // Desktop layout: list-only / split / map-only.
  const [deskView, setDeskView] = useState(ui?.deskView || 'split')
  // Notes per listing, per person: { url: { name: text } } (legacy: plain string).
  const [notes, setNotes] = useState(() => loadJSON('ct_notes', {}))
  // Couple mode: who is using this device, and everyone's 👍/👎 per listing.
  const [profile, setProfileState] = useState(() => { try { return localStorage.getItem('ct_profile') || '' } catch { return '' } })
  const [profileOpen, setProfileOpen] = useState(false)
  const [votes, setVotes] = useState(() => loadJSON('ct_votes', {}))
  const pendingVote = useRef(null)
  const myKey = profile || '_me'
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
  // Mobile filter bottom-sheet: filters must be reachable from the map view
  // too, with touch-sized controls.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [toastOn, setToastOn] = useState(false)
  // "Trova nuove case qui" panel: null | {loading} | {place, coords, url}
  const [agentReq, setAgentReq] = useState(null)
  // Live status of a sent request: null | {phase, zone, added, t0}
  // phase: working | publishing | ready | none | deferred
  const [agentStatus, setAgentStatus] = useState(null)
  const watchRef = useRef(null)
  const [, setStatusTick] = useState(0)
  // Saved alerts + their recent matches ("novità") + push subscription state.
  const [alerts, setAlerts] = useState(() => loadJSON('ct_alerts', []))
  const [news, setNews] = useState(() => loadJSON('ct_news', []))
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [dealsOpen, setDealsOpen] = useState(false)
  // Daily bargain analysis (scripts/analyze-deals.mjs -> public/deals.json).
  const [deals, setDeals] = useState([])
  const [dealPages, setDealPages] = useState({})
  const [dealsOnly, setDealsOnly] = useState(false)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}deals.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.deals) setDeals(j.deals); if (j?.pages) setDealPages(j.pages) })
      .catch(() => { /* deals are optional */ })
  }, [db.updated])
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals])
  const [syncOpen, setSyncOpen] = useState(false)
  const [pushState, setPushState] = useState('off')
  const [pushErr, setPushErr] = useState('')

  // Persist filters/toggles so a refresh keeps the search as it was.
  useEffect(() => {
    saveJSON('ct_ui', { filters, sort, favOnly, seaOnly, gardenOnly, beachOnly, reducedOnly, bothOnly, seenFilter, deskView })
  }, [filters, sort, favOnly, seaOnly, gardenOnly, beachOnly, reducedOnly, bothOnly, seenFilter, deskView])

  const saveNote = useCallback((url, text) => {
    setNotes((prev) => {
      const cur = typeof prev[url] === 'string' ? { _me: prev[url] } : { ...(prev[url] || {}) }
      if (myKey !== '_me' && cur._me != null) { if (cur[myKey] == null) cur[myKey] = cur._me; delete cur._me }
      if (text && text.trim()) cur[myKey] = text
      else delete cur[myKey]
      const next = { ...prev }
      if (Object.keys(cur).length) next[url] = cur; else delete next[url]
      saveJSON('ct_notes', next)
      return next
    })
  }, [myKey])

  // Everyone's notes for a listing, normalised to the object shape.
  const notesFor = useCallback((url) => {
    const v = notes[url]
    return typeof v === 'string' ? { _me: v } : (v || {})
  }, [notes])
  const noteText = useCallback((url) => {
    return Object.entries(notesFor(url))
      .map(([n, t2]) => `${n === myKey || n === '_me' ? t('you') : n}: ${t2}`).join(' · ')
  }, [notesFor, myKey, t])

  const setProfile = useCallback((name) => {
    const n = (name || '').trim().slice(0, 12)
    if (!n) return
    try { localStorage.setItem('ct_profile', n) } catch { /* ignore */ }
    setProfileState(n)
    setProfileOpen(false)
    if (pendingVote.current) { const f = pendingVote.current; pendingVote.current = null; f(n) }
  }, [])

  // 👍/👎 per listing, keyed by person: first vote asks who you are.
  const castVote = useCallback((url, v) => {
    const apply = (name) => setVotes((prev) => {
      const cur = { ...(prev[url] || {}) }
      if (cur[name] === v) delete cur[name]
      else cur[name] = v
      const next = { ...prev }
      if (Object.keys(cur).length) next[url] = cur; else delete next[url]
      saveJSON('ct_votes', next)
      return next
    })
    if (!profile) { pendingVote.current = apply; setProfileOpen(true); return }
    apply(profile)
  }, [profile])

  // A listing "both like": at least two people voted 👍.
  const bothLike = useCallback((l) =>
    Object.values(votes[l.url] || {}).filter((x) => x === 1).length >= 2, [votes])

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
    if (beachOnly && !l.feats.includes('Spiaggia')) return false
    if (dealsOnly && !dealById.has(l.id)) return false
    if (reducedOnly && !isReduced(l)) return false
    if (bothOnly && !bothLike(l)) return false
    if (filters.freshness) {
      // 'visit' with no previous visit falls back to today's additions.
      const cutoff = filters.freshness === 'visit' ? (lastVisit || LAST_UPDATED) : daysAgo(+filters.freshness)
      if (!l.date || l.date < cutoff) return false
    }
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
  }), [LISTINGS, LAST_UPDATED, lastVisit, filters, favOnly, seaOnly, gardenOnly, beachOnly, dealsOnly, dealById, reducedOnly, bothOnly, bothLike, favs])

  // Sold/removed archive view: entries verified gone on the source portal.
  // Only the zone filter applies; each gets a stable pseudo-id for map keys.
  const soldItems = useMemo(() =>
    SOLD.map((s, i) => ({ ...s, id: 'sold-' + i }))
      .filter((s) => !filters.zone || s.zone === filters.zone),
    [SOLD, filters.zone])

  useEffect(() => { criteriaRef.current = soldView ? soldItems : criteriaItems }, [criteriaItems, soldItems, soldView])

  // Criteria + viewport, before the seen-triage split. With the map hidden
  // — desktop list-only view, or the phone's Lista tab — the viewport filter
  // is meaningless (and confusing: the list would stay clipped to wherever
  // the map was last panned), so it is skipped there.
  const viewItems = useMemo(() => {
    const phoneList = mobileView === 'list' && typeof window !== 'undefined' && window.matchMedia('(max-width:840px)').matches
    let out = criteriaItems
    if (deskView !== 'list' && !phoneList && areaSync && bounds && mapZoom > 6) {
      out = out.filter((l) => bounds.contains([l.lat, l.lng]))
    }
    return out
  }, [criteriaItems, areaSync, bounds, mapZoom, deskView, mobileView])

  // How many of the current results are still to review vs already seen.
  const seenCounts = useMemo(() => {
    let u = 0
    for (const l of viewItems) if (!seen.has(l.id)) u++
    return { all: viewItems.length, unseen: u, seen: viewItems.length - u }
  }, [viewItems, seen])

  const items = useMemo(() => {
    let out = viewItems
    if (seenFilter === 'unseen') out = out.filter((l) => !seen.has(l.id))
    else if (seenFilter === 'seen') out = out.filter((l) => seen.has(l.id))
    const arr = [...out]
    if (sort === 'pasc') arr.sort((a, b) => a.price - b.price)
    else if (sort === 'pdesc') arr.sort((a, b) => b.price - a.price)
    else if (sort === 'sdesc') arr.sort((a, b) => b.size - a.size)
    else if (sort === 'new') arr.sort((a, b) => b.date.localeCompare(a.date))
    else if (sort === 'deal') arr.sort((a, b) => (dealById.get(b.id)?.score || 0) - (dealById.get(a.id)?.score || 0))
    else if (sort === 'dist' && userPos)
      arr.sort((a, b) =>
        dist(userPos[0], userPos[1], a.lat, a.lng) - dist(userPos[0], userPos[1], b.lat, b.lng))
    return arr
  }, [viewItems, seenFilter, seen, sort, userPos, dealById])

  // Manual seen toggling + bulk triage of the current results.
  const toggleSeen = useCallback((id) => {
    setSeen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem('ct_seen', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])
  const markAllSeen = () => {
    if (!items.length) return
    const n = items.length
    setSeen((prev) => {
      const next = new Set(prev)
      items.forEach((l) => next.add(l.id))
      try { localStorage.setItem('ct_seen', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
    toast(t('t_marked_seen', { n }))
  }

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
  }, [filters, seaOnly, gardenOnly, beachOnly, favOnly, soldView])

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

  // ---- Alerts: push subscription, data diff, periodic refresh ----
  // Register/refresh the push subscription for the saved alerts. Only asks
  // for notification permission from a user gesture (saving an alert).
  const syncPush = useCallback(async (alertList, askPermission) => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return }
    try {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
      // Wait for an ACTIVE worker: subscribing against one that is still
      // installing rejects — this is why first-visit activations failed.
      const reg = await navigator.serviceWorker.ready
      if (!alertList.length) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) await fetch(`${CERCA_QUI_ENDPOINT}/unsubscribe`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        setPushState('off')
        return
      }
      let perm = Notification.permission
      if (perm === 'default' && askPermission) perm = await Notification.requestPermission()
      if (perm !== 'granted') { setPushState(perm === 'denied' ? 'denied' : 'off'); return }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY) })
      const r = await fetch(`${CERCA_QUI_ENDPOINT}/subscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), alerts: alertList }),
      })
      if (!r.ok) throw new Error('server ' + r.status)
      setPushState('on')
      setPushErr('')
    } catch (e) {
      setPushState('error')
      setPushErr(String((e && e.message) || e))
    }
  }, [])

  // Verify delivery end-to-end: the worker pushes a test notification back
  // to this device's subscription.
  const testPush = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) { toast(t('t_push_nosub')); return }
      const r = await fetch(`${CERCA_QUI_ENDPOINT}/test-push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })
      const j = await r.json().catch(() => null)
      toast(j?.ok ? t('t_push_sent') : t('t_push_fail'))
    } catch { toast(t('t_push_fail')) }
  }, [toast, t])

  // Keep the remote subscription aligned on load (no permission prompt).
  useEffect(() => { syncPush(alerts, false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const saveAlert = useCallback((draft) => {
    const a = {
      id: Date.now().toString(36),
      zone: draft.zone, priceMax: draft.priceMax ? +draft.priceMax : null, priceMin: null,
      rooms: draft.rooms ? +draft.rooms : null, seaView: !!draft.seaView, garden: !!draft.garden,
      ev: { ...draft.ev },
    }
    setAlerts((prev) => { const next = [...prev, a]; saveJSON('ct_alerts', next); syncPush(next, true); return next })
    toast(t('t_al_saved'))
  }, [syncPush, toast, t])

  const deleteAlert = useCallback((id) => {
    setAlerts((prev) => { const next = prev.filter((x) => x.id !== id); saveJSON('ct_alerts', next); syncPush(next, false); return next })
  }, [syncPush])

  const markNewsRead = useCallback(() => {
    setNews((prev) => { const next = prev.map((n) => ({ ...n, seen: true })); saveJSON('ct_news', next); return next })
  }, [])

  // Diff each data refresh against the last snapshot: matches for the saved
  // alerts land in the in-app "novità" list (the push channel covers the
  // portale-chiuso case server-side with the same logic).
  useEffect(() => {
    const cur = {}
    for (const l of db.listings) cur[l.url] = { price: l.price, zone: l.zone, rooms: l.rooms, seaView: !!l.seaView, feats: l.feats || [], addr: l.addr, currency: l.currency }
    const soldUrls = (db.sold || []).map((s) => s.url).filter(Boolean)
    const snap = loadJSON('ct_snap', null)
    saveJSON('ct_snap', { listings: cur, soldUrls })
    if (!snap || !alerts.length) return
    const events = []
    for (const [url, l] of Object.entries(cur)) {
      const old = snap.listings[url]
      if (!old) events.push({ type: 'nuova', l: { ...l, url } })
      else if (l.price < old.price) events.push({ type: 'ribasso', l: { ...l, url }, oldPrice: old.price })
    }
    const oldSold = new Set(snap.soldUrls || [])
    for (const u of soldUrls)
      if (!oldSold.has(u) && snap.listings[u]) events.push({ type: 'venduta', l: { ...snap.listings[u], url: u } })
    const hits = events.filter((ev) => alerts.some((a) => a.ev?.[EV_KEY[ev.type]] && matchAlert(ev.l, a)))
    if (!hits.length) return
    setNews((prev) => {
      const next = [
        ...hits.map((h) => ({ type: h.type, addr: h.l.addr, price: h.l.price, oldPrice: h.oldPrice, currency: h.l.currency, url: h.l.url, ts: Date.now(), seen: false })),
        ...prev,
      ].slice(0, 50)
      saveJSON('ct_news', next)
      return next
    })
    toast(t('t_al_news', { n: hits.length }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db])

  // While the portal stays open, refresh the data every 10 minutes so the
  // diff above (and the map/list) pick up agent updates by themselves.
  const dbTextRef = useRef(JSON.stringify(initialDb))
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const txt = await (await fetch(`${import.meta.env.BASE_URL}data.json?t=${Date.now()}`, { cache: 'no-store' })).text()
        if (txt !== dbTextRef.current) { dbTextRef.current = txt; setDb(JSON.parse(txt)) }
      } catch { /* offline: retry next tick */ }
    }, 10 * 60000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Listings per zone, shown in the zone dropdown labels.
  const zoneCounts = useMemo(() => {
    const m = {}
    for (const l of LISTINGS) m[l.zone] = (m[l.zone] || 0) + 1
    return m
  }, [LISTINGS])

  // Active-filter chips shown under the result count: with persistence, a
  // filter left on days ago must be visible, not a silent mystery.
  const activeFilters = []
  const af = (label, clear) => activeFilters.push({ label, clear })
  if (filters.zone) af(filters.zone, () => setFilters((f) => ({ ...f, zone: '' })))
  if (filters.freshness) af(t('fresh_' + filters.freshness).replace(/^📅 /, ''), () => setFilters((f) => ({ ...f, freshness: '' })))
  if (filters.priceRanges.length) af(`${t('price_label')} (${filters.priceRanges.length})`, () => setFilters((f) => ({ ...f, priceRanges: [] })))
  if (filters.type) af(typeLabel(filters.type), () => setFilters((f) => ({ ...f, type: '' })))
  if (filters.contract) af(t(filters.contract === 'sale' ? 'for_sale' : 'for_rent'), () => setFilters((f) => ({ ...f, contract: '' })))
  if (seaOnly) af(t('sea_view'), () => setSeaOnly(false))
  if (gardenOnly) af(t('garden'), () => setGardenOnly(false))
  if (beachOnly) af(t('beach'), () => setBeachOnly(false))
  if (dealsOnly) af(t('deals_chip'), () => setDealsOnly(false))
  if (reducedOnly) af(t('reduced'), () => setReducedOnly(false))
  if (bothOnly) af(t('both_chip'), () => setBothOnly(false))
  if (seenFilter) af(t(seenFilter === 'unseen' ? 'seen_unseen' : 'seen_seen'), () => setSeenFilter(''))
  if (favOnly) af(t('favourites'), () => setFavOnly(false))
  const advCount = (filters.smin != null ? 1 : 0) + (filters.smax != null ? 1 : 0) + (filters.rooms ? 1 : 0) + (filters.baths ? 1 : 0) + filters.feats.length
  if (advCount) af(`${t('adv_filters')} (${advCount})`, () => setFilters((f) => ({ ...f, smin: null, smax: null, rooms: '', baths: '', feats: [] })))
  const clearAllFilters = () => {
    setFilters(initialFilters)
    setSeaOnly(false); setGardenOnly(false); setFavOnly(false); setReducedOnly(false); setBothOnly(false); setSeenFilter('')
  }

  // Device sync via the worker. With the same code saved on both devices it
  // runs by itself: merge-download on load and every 5 minutes, debounced
  // upload after every change. Per-person keys (votes, notes) merge with
  // "their entries win, mine stay mine".
  const syncUpload = useCallback(async (code, silent) => {
    try {
      const r = await fetch(`${CERCA_QUI_ENDPOINT}/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, data: { favs: [...favs], notes, votes, alerts } }),
      })
      if (!r.ok) throw new Error()
      if (!silent) toast(t('t_sync_sent'))
      return true
    } catch { if (!silent) toast(t('t_sync_fail')); return false }
  }, [favs, notes, votes, alerts, toast, t])

  const mergePersonMap = useCallback((local, incoming) => {
    const next = { ...local }
    for (const [url, inObjRaw] of Object.entries(incoming || {})) {
      const inObj = typeof inObjRaw === 'string' ? { _imported: inObjRaw } : inObjRaw
      const curRaw = next[url]
      const cur = typeof curRaw === 'string' ? { _me: curRaw } : { ...(curRaw || {}) }
      for (const [n, v] of Object.entries(inObj)) {
        if (n === myKey || n === '_me') { if (cur[myKey] == null && cur._me == null) cur[myKey === '_me' ? '_me' : myKey] = v }
        else cur[n] = v
      }
      next[url] = cur
    }
    return next
  }, [myKey])

  const syncDownload = useCallback(async (code, silent) => {
    try {
      const r = await fetch(`${CERCA_QUI_ENDPOINT}/sync?code=${encodeURIComponent(code)}`)
      const j = await r.json()
      if (!r.ok || !j?.ok) throw new Error()
      const d = j.data || {}
      if (Array.isArray(d.favs)) setFavs((prev) => {
        const next = new Set([...prev, ...d.favs.filter((x) => typeof x === 'number')])
        saveJSON('ct_favs', [...next]); return next
      })
      if (d.notes && typeof d.notes === 'object') setNotes((prev) => {
        const next = mergePersonMap(prev, d.notes); saveJSON('ct_notes', next); return next
      })
      if (d.votes && typeof d.votes === 'object') setVotes((prev) => {
        const next = mergePersonMap(prev, d.votes); saveJSON('ct_votes', next); return next
      })
      if (Array.isArray(d.alerts) && d.alerts.length) setAlerts((prev) => {
        const seenIds = new Set(prev.map((a) => a.id))
        const next = [...prev, ...d.alerts.filter((a) => a?.id && !seenIds.has(a.id))]
        saveJSON('ct_alerts', next); syncPush(next, false); return next
      })
      if (!silent) toast(t('t_sync_got'))
      return true
    } catch { if (!silent) toast(t('t_sync_fail')); return false }
  }, [toast, t, syncPush, mergePersonMap])

  const savedSyncCode = () => { try { return localStorage.getItem('ct_synccode') || '' } catch { return '' } }
  // On load: pull the partner's latest, then push the merged state back.
  useEffect(() => {
    const c = savedSyncCode()
    if (c) syncDownload(c, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // After any change: debounced silent upload.
  const syncTimerRef = useRef(null)
  const firstSyncRef = useRef(true)
  useEffect(() => {
    if (firstSyncRef.current) { firstSyncRef.current = false; return }
    const c = savedSyncCode()
    if (!c) return
    clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => syncUpload(c, true), 4000)
    return () => clearTimeout(syncTimerRef.current)
  }, [favs, notes, votes, alerts, syncUpload])
  // Periodic pull while the portal stays open.
  useEffect(() => {
    const iv = setInterval(() => { const c = savedSyncCode(); if (c) syncDownload(c, true) }, 5 * 60000)
    return () => clearInterval(iv)
  }, [syncDownload])

  // Shareable deep link: ?casa=<id> opens the listing's detail once, then
  // the param is stripped from the address bar — otherwise a restored tab
  // or a home-screen icon saved with that URL reopens the same house on
  // every launch. The Share button builds its own URL, so nothing else
  // needs ?casa to persist.
  useEffect(() => {
    const u = new URL(window.location.href)
    if (!u.searchParams.has('casa')) return
    const id = +u.searchParams.get('casa')
    u.searchParams.delete('casa')
    window.history.replaceState(null, '', u)
    if (id && LISTINGS.some((l) => l.id === id)) openDetail(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setView = (v) => setMobileView(v)
  const selected = selectedId != null ? LISTINGS.find((l) => l.id === selectedId) : null

  // Same-zone alternatives within ±30% of the open listing's price.
  const similar = useMemo(() => {
    if (!selected) return []
    return LISTINGS
      .filter((l) => l.id !== selected.id && l.zone === selected.zone &&
        l.price >= selected.price * 0.7 && l.price <= selected.price * 1.3)
      .sort((a, b) => Math.abs(a.price - selected.price) - Math.abs(b.price - selected.price))
      .slice(0, 3)
  }, [selected, LISTINGS])
  const displayItems = soldView ? soldItems : items

  return (
    <div className={'app' + (mobileView === 'map' ? ' mapview' : '') + ' desk-' + deskView}>
      <Header
        listings={LISTINGS}
        onOpenListing={openDetail}
        onFlyTo={flyTo}
        onNearMe={onNearMe}
        onOpenStats={() => setStatsOpen(true)}
        onOpenDeals={() => setDealsOpen(true)}
        dealsCount={deals.length}
        onOpenSync={() => setSyncOpen(true)}
        deskView={deskView}
        onDeskView={setDeskView}
        toast={toast}
      />

      <div id="demobanner">
        <span className="bfull">{t('banner', { date: LAST_UPDATED })}</span>
        <span className="bshort">{t('banner_short', { n: LISTINGS.length, date: `${LAST_UPDATED.slice(8, 10)}/${LAST_UPDATED.slice(5, 7)}` })}</span>
      </div>

      <div id="main">
        <ListPanel
          items={displayItems}
          dealById={dealById}
          activeFilters={activeFilters}
          onClearFilters={clearAllFilters}
          zones={db.zones}
          zoneCounts={zoneCounts}
          features={db.features}
          updated={LAST_UPDATED}
          gbpEur={db.gbpEur}
          notes={notes}
          votes={votes}
          profile={profile}
          onVote={castVote}
          reducedOnly={reducedOnly}
          onToggleReduced={() => setReducedOnly((v) => !v)}
          bothOnly={bothOnly}
          onToggleBoth={() => setBothOnly((v) => !v)}
          filters={filters}
          favOnly={favOnly}
          seaOnly={seaOnly}
          gardenOnly={gardenOnly}
          beachOnly={beachOnly}
          dealsOnly={dealsOnly}
          dealsCount={deals.length}
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
          onToggleBeach={() => setBeachOnly((v) => !v)}
          onToggleDeals={() => setDealsOnly((v) => !v)}
          onToggleSold={() => setSoldView((v) => !v)}
          favCount={favs.size}
          onOpenCompare={() => setCompareOpen(true)}
          seenFilter={seenFilter}
          seenCounts={seenCounts}
          onSeenFilter={setSeenFilter}
          onMarkAllSeen={markAllSeen}
          onToggleSeen={toggleSeen}
          onOpenAlerts={() => setAlertsOpen(true)}
          alertsUnseen={news.filter((n) => !n.seen).length}
          hasAlerts={alerts.length > 0}
          onSortChange={onSortChange}
          onOpen={openDetail}
          onToggleFav={toggleFav}
          onSeen={markSeen}
          onHover={onHover}
          cardRefs={cardRefs}
        />

        <MapPanel
          items={displayItems}
          zoom={mapZoom}
          highlightId={highlightId}
          userPos={userPos}
          areaSync={areaSync}
          seen={seen}
          soldView={soldView}
          onToggleAreaSync={() => setAreaSync((v) => !v)}
          onFitAll={onFitAll}
          onAgentSearchHere={onAgentSearchHere}
          onMarkerClick={onMarkerClick}
          onClusterClick={(lat, lng) => mapRef.current?.flyTo([lat, lng], Math.min(mapZoom + 3, 14), { duration: 0.8 })}
          onOpen={openDetail}
          onSeen={markSeen}
          onMapReady={onMapReady}
          onBoundsChange={onBoundsChange}
        />
      </div>

      <div id="viewtoggle">
        <button className={mobileView === 'list' ? 'on' : ''} onClick={() => setView('list')}>{t('vt_list')}</button>
        <button className={mobileView === 'map' ? 'on' : ''} onClick={() => setView('map')}>{t('vt_map')}</button>
        <button onClick={() => setSheetOpen(true)}>
          🎛 {t('vt_filters')}{activeFilters.length > 0 && <span className="badge">{activeFilters.length}</span>}
        </button>
      </div>

      {sheetOpen && (
        <div id="fsheetwrap" onClick={() => setSheetOpen(false)}>
          <div id="fsheet" onClick={(e) => e.stopPropagation()}>
            <div id="fsheethead">
              <b>🎛 {t('vt_filters')}</b>
              <button id="fsheetx" onClick={() => setSheetOpen(false)}>✕</button>
            </div>
            <Filters
              zones={db.zones}
              zoneCounts={zoneCounts}
              features={db.features}
              filters={filters}
              onImmediate={(k, v) => setFilters((f) => ({ ...f, [k]: v }))}
              onApplyAdvanced={(adv) => setFilters((f) => ({ ...f, ...adv }))}
              favOnly={favOnly} onToggleFavOnly={() => setFavOnly((v) => !v)}
              seaOnly={seaOnly} onToggleSea={() => setSeaOnly((v) => !v)}
              gardenOnly={gardenOnly} onToggleGarden={() => setGardenOnly((v) => !v)}
              beachOnly={beachOnly} onToggleBeach={() => setBeachOnly((v) => !v)}
              dealsOnly={dealsOnly} onToggleDeals={() => setDealsOnly((v) => !v)} dealsCount={deals.length}
              reducedOnly={reducedOnly} onToggleReduced={() => setReducedOnly((v) => !v)}
              bothOnly={bothOnly} onToggleBoth={() => setBothOnly((v) => !v)}
              soldView={soldView} soldCount={SOLD.length} onToggleSold={() => setSoldView((v) => !v)}
              favCount={favs.size}
              onOpenCompare={() => { setSheetOpen(false); setCompareOpen(true) }}
              onOpenAlerts={() => { setSheetOpen(false); setAlertsOpen(true) }}
              alertsUnseen={news.filter((n) => !n.seen).length}
              hasAlerts={alerts.length > 0}
            />
            {!soldView && criteriaItems.length > displayItems.length && (
              <div className="fsheetnote">
                <span>🔗 {t('sheet_area_note', { n: displayItems.length, tot: criteriaItems.length })}</span>
                <button onClick={onFitAll}>{t('map_see_all')}</button>
              </div>
            )}
            <div id="fsheetfoot">
              <button className="btn ghost" onClick={clearAllFilters}>{t('af_clear_all')}</button>
              <button className="btn primary" onClick={() => setSheetOpen(false)}>{t('show_n', { n: displayItems.length })}</button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <DetailModal
          deal={dealById.get(selected.id)}
          allListings={LISTINGS}
          dealPages={dealPages}
          updated={LAST_UPDATED}
          l={selected}
          fav={favs.has(selected.id)}
          similar={similar}
          onOpenListing={openDetail}
          gbpEur={db.gbpEur}
          noteData={notesFor(selected.url)}
          myKey={myKey}
          vote={votes[selected.url] || {}}
          profile={profile}
          onVote={castVote}
          onSaveNote={saveNote}
          onClose={() => setSelectedId(null)}
          onToggleFav={toggleFav}
          onShowOnMap={onShowOnMap}
          toast={toast}
        />
      )}

      {profileOpen && (
        <ProfileModal onSave={setProfile} onClose={() => { pendingVote.current = null; setProfileOpen(false) }} />
      )}

      {syncOpen && (
        <SyncModal onUpload={syncUpload} onDownload={syncDownload} onClose={() => setSyncOpen(false)} />
      )}

      {statsOpen && (
        <StatsModal
          zones={db.zones}
          listings={LISTINGS}
          sold={SOLD}
          gbpEur={db.gbpEur}
          onPickZone={(z) => setFilters((f) => ({ ...f, zone: z }))}
          onClose={() => setStatsOpen(false)}
        />
      )}

      {dealsOpen && (
        <DealsModal deals={deals} listings={LISTINGS} gbpEur={db.gbpEur} updated={LAST_UPDATED} favs={favs} onToggleFav={toggleFav} onOpen={openDetail} onClose={() => setDealsOpen(false)} />
      )}

      {compareOpen && (
        <CompareModal
          items={LISTINGS.filter((l) => favs.has(l.id))}
          gbpEur={db.gbpEur}
          noteText={noteText}
          votes={votes}
          onOpen={openDetail}
          onToggleFav={toggleFav}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {alertsOpen && (
        <AlertsPanel
          zones={db.zones}
          alerts={alerts}
          news={news}
          pushState={pushState}
          pushErr={pushErr}
          onSave={saveAlert}
          onDelete={deleteAlert}
          onMarkRead={markNewsRead}
          onEnablePush={() => syncPush(alerts, true)}
          onTestPush={testPush}
          onClose={() => setAlertsOpen(false)}
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
