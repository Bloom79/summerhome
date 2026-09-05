import { useEffect, useMemo, useState } from 'react'
import { fmtP, imgUrl, handleImgError } from '../utils.js'
import { useI18n } from '../i18n.jsx'

// Viewing-trip planner: pick favourites, pick the airport you land at, and
// OSRM's trip service orders the stops into the shortest drive. Legs show
// minutes and km; one tap opens the whole route in Google Maps.
export const GATES = [
  ['Edimburgo', 55.9508, -3.3615], ['Glasgow', 55.8642, -4.4331], ['Inverness', 57.5425, -4.0475],
  ['Aberdeen', 57.2019, -2.1978], ['Dublino', 53.4264, -6.2499], ['Donegal', 55.0442, -8.3410],
]
const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}` : `${min} min`)

export default function TripModal({ items, gbpEur, onOpen, onClose }) {
  const { t, eur: eurMode } = useI18n()
  const fx = eurMode ? gbpEur : null
  const [gate, setGate] = useState(0)
  const [picked, setPicked] = useState(() => new Set(items.slice(0, 8).map((l) => l.id)))
  const [route, setRoute] = useState(null) // {stops:[{l, min, km}], totalMin, totalKm}
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const chosen = useMemo(() => items.filter((l) => picked.has(l.id)), [items, picked])
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else if (n.size < 10) n.add(id); return n })

  useEffect(() => {
    if (chosen.length < 1) { setRoute(null); return }
    let alive = true
    setBusy(true); setErr(false)
    const g = GATES[gate]
    const coords = [`${g[2]},${g[1]}`, ...chosen.map((l) => `${l.lng},${l.lat}`)].join(';')
    fetch(`https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&roundtrip=false&overview=false`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        if (j.code !== 'Ok' || !j.trips?.[0]) { setErr(true); setRoute(null); return }
        // waypoints[i] is input i; waypoint_index is its position in the trip.
        const order = j.waypoints.map((w, i) => ({ i, at: w.waypoint_index })).sort((a, b) => a.at - b.at).map((x) => x.i)
        const legs = j.trips[0].legs
        const stops = order.slice(1).map((inputIdx, k) => ({ l: chosen[inputIdx - 1], min: Math.round(legs[k].duration / 60), km: Math.round(legs[k].distance / 1000) }))
        setRoute({ stops, totalMin: Math.round(j.trips[0].duration / 60), totalKm: Math.round(j.trips[0].distance / 1000) })
      })
      .catch(() => { if (alive) setErr(true) })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [chosen, gate])

  const gmaps = () => {
    if (!route) return '#'
    const g = GATES[gate]
    const pts = route.stops.map((s) => `${s.l.lat},${s.l.lng}`)
    const dest = pts[pts.length - 1]
    const way = pts.slice(0, -1).join('|')
    return `https://www.google.com/maps/dir/?api=1&origin=${g[1]},${g[2]}&destination=${dest}${way ? `&waypoints=${encodeURIComponent(way)}` : ''}&travelmode=driving`
  }

  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox cmpbox tripbox" onClick={(e) => e.stopPropagation()}>
        <h3>🗺 {t('trip_title')}</h3>
        <p className="agentexpl">{t('trip_explain')}</p>
        <label className="tripgate">{t('trip_from')}
          <select value={gate} onChange={(e) => setGate(+e.target.value)}>
            {GATES.map((g, i) => <option key={g[0]} value={i}>✈️ {g[0]}</option>)}
          </select>
        </label>
        <div className="trippick">
          {items.map((l) => (
            <label key={l.id} className={'trippickrow' + (picked.has(l.id) ? ' on' : '')}>
              <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
              {l.imgs?.[0] ? <img src={imgUrl(l.imgs[0])} onError={(e) => handleImgError(e)} alt="" /> : <span className="tripph">🏠</span>}
              <span className="tripaddr">{(l.addr || '').split(',').slice(0, 2).join(',')}<small>{fmtP(l, fx)}</small></span>
            </label>
          ))}
        </div>
        {busy && <div className="agentload"><span className="spin" />{t('trip_computing')}</div>}
        {err && <p className="agentexpl">⚠️ {t('trip_err')}</p>}
        {route && !busy && (
          <div className="triproute">
            <div className="tripstop start">✈️ {GATES[gate][0]}</div>
            {route.stops.map((s, i) => (
              <div key={s.l.id} className="tripstop">
                <span className="tripleg">↓ {fmtDur(s.min)} · {s.km} km</span>
                <button className="tripname" onClick={() => { onClose(); onOpen(s.l.id) }}>{i + 1}. {(s.l.addr || '').split(',').slice(0, 2).join(',')}</button>
              </div>
            ))}
            <div className="triptotal">⏱ {t('trip_total', { t: fmtDur(route.totalMin), km: route.totalKm, n: route.stops.length })}</div>
            <a className="agentsend" href={gmaps()} target="_blank" rel="noopener noreferrer">🧭 {t('trip_gmaps')}</a>
          </div>
        )}
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
