// ---- Prezzo ----
const SYMBOL = { EUR: '€', GBP: '£' }
export const priceSym = (l) => SYMBOL[l.currency] || '€'
const priceLocale = (l) => (l.currency === 'GBP' ? 'en-GB' : 'it-IT')

export const fmtP = (l) => {
  const s = priceSym(l)
  const n = l.price.toLocaleString(priceLocale(l))
  return l.contract === 'rent' ? `${s} ${n}/mese` : `${s} ${n}`
}

// Compact price used on map pins (es. £695k, €1.2M, £1.4k/m)
export const shortP = (l) => {
  const s = priceSym(l)
  if (l.contract === 'rent') {
    return s + (l.price >= 1000 ? (l.price / 1000).toFixed(1).replace('.0', '') + 'k' : l.price) + '/m'
  }
  return s + (l.price >= 1000000
    ? (l.price / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
    : Math.round(l.price / 1000) + 'k')
}

// ---- Immagini ----
// Le foto sono URL reali dal CDN del portale di origine (Rightmove / MyHome).
export const imgUrl = (u) => (typeof u === 'string' && u.startsWith('http') ? u : '')
export const PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><rect width="900" height="560" fill="#dce6e7"/><text x="450" y="300" font-size="90" text-anchor="middle">🏠</text></svg>'
  )

// onError handler: if a source photo fails to load, hide it (cards) or show the
// neutral placeholder (main gallery image).
export const handleImgError = (e) => {
  const el = e.currentTarget
  el.onerror = null
  if (el.classList.contains('gmain')) el.src = PLACEHOLDER
  else el.style.display = 'none'
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

// Short, human-readable host for a source-listing URL (es. "daft.ie").
export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'annuncio originale'
  }
}

// ---- Geocoding (OpenStreetMap / Nominatim) ----
// Limited to the UK & Ireland — the only countries this portal covers.
export async function geocode(text, limit = 5) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=gb,ie&addressdetails=1&limit=${limit}&q=${encodeURIComponent(text)}`,
    { headers: { 'Accept-Language': 'en' } }
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
