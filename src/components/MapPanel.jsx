import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, ZoomControl, useMapEvents } from 'react-leaflet'
import { fmtP, shortP, hostOf, SAT_URL, SAT_LABELS, SAT_ATTR } from '../utils.js'
import { useI18n } from '../i18n.jsx'
import Gallery from './Gallery.jsx'

// Price-pin divIcon (positioned via CSS transform on .pricepin).
// `pc` marks the special pins: 'fresh' = added in the last 3 days,
// 'gem' = curated deal with sea view/garden priced below the zone median.
const pinIcon = (l, hl, seen, sold, pc, fx) =>
  L.divIcon({
    className: '',
    html: `<div class="pricepin${hl ? ' hl' : ''}${seen ? ' seen' : ''}${sold ? ' sold' : ''}${pc && !sold ? ' ' + pc : ''}">${pc === 'gem' && !sold ? '💎 ' : pc === 'fresh' && !sold ? '✨ ' : ''}${shortP(l, fx)}</div>`,
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

const clusterIcon = (n) =>
  L.divIcon({ className: '', html: `<div class="clusterpin">${n}</div>`, iconSize: [0, 0] })

export default function MapPanel({
  items, zoom, highlightId, userPos, areaSync, seen, soldView, pinClassOf, gbpEur, satellite,
  onToggleAreaSync, onToggleSatellite, onFitAll, onAgentSearchHere, onMarkerClick, onClusterClick, onOpen, onSeen, onMapReady, onBoundsChange,
}) {
  const { t, eur } = useI18n()
  const fx = eur ? gbpEur : null

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
                <div className="pop">
                  {l.imgs && l.imgs.length
                    ? <div className="popimg"><Gallery imgs={l.imgs} /></div>
                    : null}
                  <div className="pb">
                    <div className="pt">{l.title}</div>
                    <div className="pa">📍 {l.addr}</div>
                    <div className="pp">{fmtP(l, fx)}</div>
                    {!soldView && <span className="plink" onClick={() => onOpen(l.id)}>{t('pop_full')}</span>}
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
        <button className="mbtn agent" onClick={onAgentSearchHere}>{t('map_agent_here')}</button>
        <button className="mbtn" onClick={onFitAll}>{t('map_see_all')}</button>
      </div>
    </section>
  )
}
