import { IMGS } from './data.js'

// ---- Prezzo ----
export const fmtP = (l) =>
  l.contract === 'rent'
    ? '€ ' + l.price.toLocaleString('it-IT') + '/mese'
    : '€ ' + l.price.toLocaleString('it-IT')

// Compact price used on map pins (es. €1.2M, €445k, €1.4k/m)
export const shortP = (l) => {
  if (l.contract === 'rent') {
    return '€' + (l.price >= 1000 ? (l.price / 1000).toFixed(1).replace('.0', '') + 'k' : l.price) + '/m'
  }
  return '€' + (l.price >= 1000000
    ? (l.price / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
    : Math.round(l.price / 1000) + 'k')
}

// ---- Immagini con fallback ----
export const imgUrl = (k) => (IMGS[k] ? IMGS[k][0] : '')
export const imgFall = (k) => (IMGS[k] ? `https://picsum.photos/seed/${IMGS[k][1]}/900/560` : '')
export const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><rect width="900" height="560" fill="#dce6e7"/><text x="450" y="300" font-size="90" text-anchor="middle">🏠</text></svg>'
  )

// onError handler: primary → picsum fallback → svg placeholder (main img only)
export const handleImgError = (e, k) => {
  const el = e.currentTarget
  if (!el.dataset.f) {
    el.dataset.f = '1'
    el.src = imgFall(k)
  } else if (el.classList.contains('gmain')) {
    el.onerror = null
    el.src = PLACEHOLDER
  } else {
    el.style.display = 'none'
  }
}

// ---- Distanza (Haversine, km) ----
export const dist = (a, b, c, d) => {
  const R = 6371
  const dLa = ((c - a) * Math.PI) / 180
  const dLo = ((d - b) * Math.PI) / 180
  const x =
    Math.sin(dLa / 2) ** 2 +
    Math.cos((a * Math.PI) / 180) * Math.cos((c * Math.PI) / 180) * Math.sin(dLo / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export const fmtDist = (d) => (d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km')

// ---- Geocoding (OpenStreetMap / Nominatim) ----
export async function geocode(text, limit = 5) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=it&addressdetails=1&limit=${limit}&q=${encodeURIComponent(text)}`,
    { headers: { 'Accept-Language': 'it' } }
  )
  return r.ok ? r.json() : []
}

// Zoom level heuristic based on the type of place returned by Nominatim.
export const zoomForType = (type) =>
  ['house', 'building', 'residential', 'address'].includes(type) ? 17
  : ['suburb', 'neighbourhood', 'quarter'].includes(type) ? 14
  : ['city', 'town'].includes(type) ? 13
  : ['village', 'hamlet'].includes(type) ? 14
  : 11
