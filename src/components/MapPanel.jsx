import { useEffect } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, ZoomControl, useMapEvents } from 'react-leaflet'
import { fmtP, shortP, imgUrl, handleImgError, hostOf } from '../utils.js'
import { useI18n } from '../i18n.jsx'

// Price-pin divIcon (positioned via CSS transform on .pricepin).
const pinIcon = (l, hl, seen, sold) =>
  L.divIcon({
    className: '',
    html: `<div class="pricepin${hl ? ' hl' : ''}${seen ? ' seen' : ''}${sold ? ' sold' : ''}">${shortP(l)}</div>`,
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

export default function MapPanel({
  items, highlightId, userPos, areaSync, seen, soldView,
  onToggleAreaSync, onFitAll, onAgentSearchHere, onMarkerClick, onOpen, onSeen, onMapReady, onBoundsChange,
}) {
  const { t } = useI18n()
  return (
    <section id="mapwrap">
      <div id="map">
        {/* Fallback view only: the real fit happens in App (fitToCriteria),
            re-armed by a ResizeObserver so a map mounted hidden (mobile list
            view) fits correctly the moment it becomes visible. */}
        <MapContainer center={[56.2, -5.3]} zoom={6} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <ZoomControl position="bottomright" />
          <MapBridge onReady={onMapReady} onBoundsChange={onBoundsChange} />

          {items.map((l) => (
            <Marker
              key={l.id}
              position={[l.lat, l.lng]}
              icon={pinIcon(l, l.id === highlightId, seen && seen.has(l.id), soldView)}
              eventHandlers={{ click: () => onMarkerClick(l.id) }}
            >
              <Popup>
                <div className="pop">
                  {l.imgs && l.imgs.length
                    ? <img src={imgUrl(l.imgs[0])} onError={(e) => handleImgError(e)} alt="" />
                    : null}
                  <div className="pb">
                    <div className="pt">{l.title}</div>
                    <div className="pa">📍 {l.addr}</div>
                    <div className="pp">{fmtP(l)}</div>
                    {l.url && (
                      <a className="psrc" href={l.url} target="_blank" rel="noopener noreferrer" onClick={() => onSeen && onSeen(l.id)}>
                        🔗 {t('view_on', { host: hostOf(l.url) })} →
                      </a>
                    )}
                    {!soldView && <span className="plink" onClick={() => onOpen(l.id)}>{t('pop_full')}</span>}
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

      <div className="mapbtns">
        <button className={'mbtn' + (areaSync ? ' on' : '')} onClick={onToggleAreaSync}>{t('map_search_area')}</button>
        <button className="mbtn agent" onClick={onAgentSearchHere}>{t('map_agent_here')}</button>
        <button className="mbtn" onClick={onFitAll}>{t('map_see_all')}</button>
      </div>
    </section>
  )
}
