import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, ZoomControl, useMapEvents } from 'react-leaflet'
import { pubsInBbox, ICON, gmapsLink, osmLink } from '../poi.js'
import { fmtP, shortP, ppm, hostOf, SAT_URL, SAT_LABELS, SAT_ATTR } from '../utils.js'
import { useI18n } from '../i18n.jsx'
import Gallery from './Gallery.jsx'

// Price-pin divIcon (positioned via CSS transform on .pricepin).
// `pc` marks the special pins: 'fresh' = added in the last 3 days,
// 'gem' = curated deal with sea view/garden priced below the zone median.
// `sea` (ad claims a sea view, or geo-verified waterfront) gives the pin a
// blue border so sea-view homes stand out on the map at a glance.
const pinIcon = (l, hl, seen, sold, pc, fx) =>
  L.divIcon({
    className: '',
    html: `<div class="pricepin${hl ? ' hl' : ''}${seen ? ' seen' : ''}${sold ? ' sold' : ''}${pc && !sold ? ' ' + pc : ''}${!sold && (l.seaView || (l.feats || []).includes('Spiaggia')) ? ' sea' : ''}">${pc === 'gem' && !sold ? '💎 ' : pc === 'fresh' && !sold ? '✨ ' : ''}${shortP(l, fx)}</div>`,
    iconSize: [0, 0],
  })

// Bridge: expose the Leaflet map instance to the parent and report bounds.
function MapBridge({ onReady, onBoundsChange }) {
  const map = useMapEvents({
    moveend: () => onBoundsChange(map.getBounds(), map.getZoom()),
  })
  useEffect(() => {
    onReady(map)
    onBoundsChange(map.getBounds(), map.getZoom())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// Pubs / bars / restaurants from OpenStreetMap inside the viewport, from
// zoom 13 up (a coastal town fits in one query). Fetches are debounced on
// moveend and cached per rounded bbox in poi.js.
const poiIcon = (p) => L.divIcon({ className: '', html: `<div class="poipin ${p.cat}">${ICON[p.cat]}</div>`, iconSize: [0, 0] })
function PubsLayer({ on, t }) {
  const [places, setPlaces] = useState([])
  const [zoomOk, setZoomOk] = useState(false)
  const onRef = useRef(on)
  onRef.current = on
  // moveend fires once per pan/zoom; the bbox cache absorbs repeats, so no
  // timer (background tabs throttle timers to a crawl).
  const map = useMapEvents({ moveend: () => load() })
  const load = () => {
    const ok = map.getZoom() >= 13
    setZoomOk(ok)
    if (!onRef.current || !ok) { setPlaces([]); return }
    const b = map.getBounds()
    if (!(b.getNorth() > b.getSouth())) return // hidden map (0×0 container): nothing to query
    pubsInBbox(b).then((ps) => { if (onRef.current) setPlaces(ps) }).catch(() => { /* keep what we have */ })
  }
  useEffect(() => { load() }, [on]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!on) return null
  return (
    <>
      {places.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={poiIcon(p)} zIndexOffset={-100}>
          <Popup>
            <div className="poipop">
              <b>{ICON[p.cat]} {p.name || (p.cat === 'pub' ? 'Pub' : 'Ristorante')}</b>
              {p.cuisine && <div className="poicui">{p.cuisine}</div>}
              {p.hours && <div className="poihrs">🕒 {p.hours}</div>}
              <div className="poilinks">
                {p.web && <a href={p.web} target="_blank" rel="noopener noreferrer">{t('link_site')} ↗</a>}
                <a href={gmapsLink(p)} target="_blank" rel="noopener noreferrer">{t('link_maps')} ↗</a>
                <a href={osmLink(p)} target="_blank" rel="noopener noreferrer">OSM ↗</a>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
      {!zoomOk && <div className="pubshint">{t('map_pubs_zoom')}</div>}
    </>
  )
}

const clusterIcon = (n) =>
  L.divIcon({ className: '', html: `<div class="clusterpin">${n}</div>`, iconSize: [0, 0] })

export default function MapPanel({
  items, zoom, highlightId, userPos, areaSync, seen, soldView, pinClassOf, gbpEur, satellite,
  onToggleAreaSync, onToggleSatellite, onFitAll, onAgentSearchHere, onMarkerClick, onClusterClick, onOpen, onSeen, onMapReady, onBoundsChange,
}) {
  const { t, eur } = useI18n()
  const fx = eur ? gbpEur : null
  // 🍺 layer toggle, remembered on the device.
  const [pubsOn, setPubsOn] = useState(() => { try { return localStorage.getItem('ct_pubs') === '1' } catch { return false } })
  const togglePubs = () => setPubsOn((v) => { try { localStorage.setItem('ct_pubs', v ? '0' : '1') } catch { /* ignore */ } return !v })

  // Grid clustering, no plugins: below street zoom, cells with 3+ houses
  // collapse into a count bubble that zooms in when clicked. The highlighted
  // listing always stays an individual pin.
  const { singles, groups } = useMemo(() => {
    if (zoom >= 12) return { singles: items, groups: [] }
    const cell = 360 / Math.pow(2, zoom + 4)
    const grid = new Map()
    for (const l of items) {
      const key = `${Math.round(l.lat / cell)}|${Math.round(l.lng / cell)}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(l)
    }
    const s = [], g = []
    for (const arr of grid.values()) {
      if (arr.length >= 3 && !arr.some((l) => l.id === highlightId)) {
        g.push({
          lat: arr.reduce((a, l) => a + l.lat, 0) / arr.length,
          lng: arr.reduce((a, l) => a + l.lng, 0) / arr.length,
          n: arr.length,
          key: arr[0].id,
        })
      } else s.push(...arr)
    }
    return { singles: s, groups: g }
  }, [items, zoom, highlightId])
  return (
    <section id="mapwrap">
      <div id="map">
        {/* Fallback view only: the real fit happens in App (fitToCriteria),
            re-armed by a ResizeObserver so a map mounted hidden (mobile list
            view) fits correctly the moment it becomes visible. */}
        <MapContainer center={[56.2, -5.3]} zoom={6} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          {satellite ? (
            <>
              <TileLayer key="sat" url={SAT_URL} maxZoom={19} attribution={SAT_ATTR} />
              <TileLayer key="satlbl" url={SAT_LABELS} maxZoom={19} subdomains="abcd" />
            </>
          ) : (
            <TileLayer
              key="osm"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
          )}
          <ZoomControl position="bottomright" />
          <MapBridge onReady={onMapReady} onBoundsChange={onBoundsChange} />
          <PubsLayer on={pubsOn} t={t} />

          {groups.map((g) => (
            <Marker
              key={'c' + g.key}
              position={[g.lat, g.lng]}
              icon={clusterIcon(g.n)}
              eventHandlers={{ click: () => onClusterClick(g.lat, g.lng) }}
            />
          ))}

          {singles.map((l) => (
            <Marker
              key={l.id}
              position={[l.lat, l.lng]}
              icon={pinIcon(l, l.id === highlightId, seen && seen.has(l.id), soldView, pinClassOf ? pinClassOf(l) : '', fx)}
              eventHandlers={{ click: () => onMarkerClick(l.id) }}
            >
              <Popup>
                <div className={'pop' + (soldView ? '' : ' openable')}>
                  {l.imgs && l.imgs.length
                    ? <div className="popimg"><Gallery imgs={l.imgs} onTap={soldView ? undefined : () => onOpen(l.id)} /></div>
                    : null}
                  <div className="pb" onClick={soldView ? undefined : () => onOpen(l.id)}>
                    <div className="pt">{l.title}</div>
                    <div className="pa">📍 {l.addr}</div>
                    <div className="pp">{fmtP(l, fx)}</div>
                    {!soldView && (
                      <div className="pf">
                        {(l.seaView || l.feats.includes('Spiaggia')) && <span className="on">{t('sea_view')}</span>}
                        {l.feats.includes('Giardino') && <span className="on">{t('garden')}</span>}
                        {l.rooms ? <span>🛏 {l.rooms}</span> : null}
                        {l.size ? <span>{l.size} m²</span> : null}
                        {ppm(l, fx) && <span>{ppm(l, fx)}</span>}
                      </div>
                    )}
                    {!soldView && <button className="pbtn" onClick={(e) => { e.stopPropagation(); onOpen(l.id) }}>{t('pop_full')}</button>}
                    {soldView && l.url && (
                      <a className="psrc" href={l.url} target="_blank" rel="noopener noreferrer">
                        🔗 {t('view_on', { host: hostOf(l.url) })} →
                      </a>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}

          {userPos && (
            <CircleMarker center={userPos} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#3b7dd8', fillOpacity: 1 }}>
              <Popup>{t('here')}</Popup>
            </CircleMarker>
          )}
        </MapContainer>
      </div>

      {!soldView && <div className="maplegend">{t('map_legend')}</div>}

      <div className="mapbtns">
        <button className={'mbtn' + (areaSync ? ' on' : '')} onClick={onToggleAreaSync}>{t('map_search_area')}</button>
        <button className={'mbtn sat' + (satellite ? ' on' : '')} onClick={onToggleSatellite} title={t('map_sat_title')}>{satellite ? t('map_sat_off') : t('map_sat')}</button>
        <button className={'mbtn pubs' + (pubsOn ? ' on' : '')} onClick={togglePubs} title={t('map_pubs_title')}>{t('map_pubs')}</button>
        <button className="mbtn agent" onClick={onAgentSearchHere}>{t('map_agent_here')}</button>
        <button className="mbtn" onClick={onFitAll}>{t('map_see_all')}</button>
      </div>
    </section>
  )
}
