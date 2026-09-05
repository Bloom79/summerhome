// Places around a house from OpenStreetMap (Overpass): pubs, bars,
// restaurants, cafés, shops, beach, station, golf. Two mirrors, a shared
// in-memory + localStorage cache, and links out to the venue's own site and
// to Google Maps (photos, reviews, hours) since OSM carries no photos.
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

export const hav = (a, b, c, d) => {
  const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r
  const s = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(s))
}
export const fmtM = (m) => (m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(1)} km`)

async function overpass(q) {
  for (const ep of ENDPOINTS) {
    try {
      const ctl = new AbortController()
      const kill = setTimeout(() => ctl.abort(), 12000)
      const r = await fetch(ep, { method: 'POST', body: new URLSearchParams({ data: q }), signal: ctl.signal })
      clearTimeout(kill)
      if (!r.ok) continue
      const j = await r.json()
      // A mirror under load answers 200 with a remark and no data: try the next one.
      if (j.remark && /error|timeout|load/i.test(j.remark) && !(j.elements || []).length) continue
      return j.elements || []
    } catch { /* next mirror */ }
  }
  throw new Error('overpass')
}

export const ICON = { pub: '🍺', rest: '🍽', cafe: '☕', shop: '🛒', beach: '🏖', station: '🚉', golf: '⛳' }
const catOf = (t = {}) =>
  t.amenity === 'pub' || t.amenity === 'bar' ? 'pub' : t.amenity === 'restaurant' ? 'rest' : t.amenity === 'cafe' ? 'cafe'
  : t.shop ? 'shop' : t.natural === 'beach' ? 'beach' : t.railway === 'station' ? 'station' : t.leisure === 'golf_course' ? 'golf' : null

export const placeOf = (el) => {
  const t = el.tags || {}
  const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon
  const cat = catOf(t)
  if (lat == null || !cat) return null
  return {
    id: el.type[0] + el.id, cat, name: t.name || t.brand || '', lat, lng,
    web: t.website || t['contact:website'] || t.url || null,
    cuisine: t.cuisine ? t.cuisine.replace(/_/g, ' ').replace(/;/g, ', ') : null,
    hours: t.opening_hours || null,
  }
}
// Google Maps text search on the name (photos, reviews, hours); coordinates
// when the venue has no name on OSM.
export const gmapsLink = (p, town) => p.name
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name + (town ? ', ' + town : ''))}`
  : `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
export const osmLink = (p) => `https://www.openstreetmap.org/${p.id[0] === 'n' ? 'node' : 'way'}/${p.id.slice(1)}`

const mem = new Map()
const store = (() => { try { return JSON.parse(localStorage.getItem('ct_near')) || {} } catch { return {} } })()
const persist = () => { try { localStorage.setItem('ct_near', JSON.stringify(store)) } catch { /* full */ } }

// Everything useful around one house, one query. Venues (pub/rest/cafe)
// sorted by distance; nearest shop/beach/station/golf as distances.
export async function nearby(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
  if (store[key]) return store[key]
  const q = `[out:json][timeout:12];(
    nwr(around:1500,${lat},${lng})["amenity"~"^(pub|bar|restaurant|cafe)$"];
    nwr(around:2500,${lat},${lng})["shop"~"^(supermarket|convenience|general)$"];
    nwr(around:3000,${lat},${lng})["natural"="beach"];
    nwr(around:8000,${lat},${lng})["railway"="station"];
    nwr(around:3000,${lat},${lng})["leisure"="golf_course"];
  );out center tags 120;`
  const els = await overpass(q)
  const all = els.map(placeOf).filter(Boolean).map((p) => ({ ...p, d: Math.round(hav(lat, lng, p.lat, p.lng)) }))
  // Pubs first (that's the question being asked), then restaurants, then cafés — each by distance.
  const rank = { pub: 0, rest: 1, cafe: 2 }
  const venues = all.filter((p) => p.cat in rank).sort((a, b) => rank[a.cat] - rank[b.cat] || a.d - b.d).slice(0, 12)
  const nearest = {}
  for (const c of ['shop', 'beach', 'station', 'golf']) { const m = all.filter((p) => p.cat === c).sort((a, b) => a.d - b.d)[0]; if (m) nearest[c] = { d: m.d, name: m.name } }
  const counts = { pub: all.filter((p) => p.cat === 'pub').length, rest: all.filter((p) => p.cat === 'rest').length, cafe: all.filter((p) => p.cat === 'cafe').length }
  const rec = { venues, nearest, counts }
  if (all.length) { store[key] = rec; persist() }
  return rec
}

// Pubs, bars and restaurants inside a map viewport (zoomed-in only).
export async function pubsInBbox(b) {
  const r = (x) => x.toFixed(3)
  const key = `${r(b.getSouth())},${r(b.getWest())},${r(b.getNorth())},${r(b.getEast())}`
  if (mem.has(key)) return mem.get(key)
  const q = `[out:json][timeout:12];nwr(${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()})["amenity"~"^(pub|bar|restaurant)$"];out center tags 300;`
  const els = await overpass(q)
  const out = els.map(placeOf).filter(Boolean)
  if (out.length) mem.set(key, out) // never pin an empty answer: it may be a hiccup
  return out
}
