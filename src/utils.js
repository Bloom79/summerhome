// ---- Prezzo ----
const SYMBOL = { EUR: '€', GBP: '£' }
export const priceSym = (l) => SYMBOL[l.currency] || '€'
const priceLocale = (l) => (l.currency === 'GBP' ? 'en-GB' : 'it-IT')

// Optional `fx` (GBP→EUR rate): when given and the listing is priced in
// sterling, the price is shown converted to euro, prefixed by ≈ so a
// conversion is never mistaken for the asking price (global "€" toggle).
const shown = (l, fx) => (fx && l.currency === 'GBP'
  ? { sym: '€', n: Math.round(l.price * fx), locale: 'it-IT', approx: true }
  : { sym: priceSym(l), n: l.price, locale: priceLocale(l), approx: false })

export const fmtP = (l, fx) => {
  const { sym, n, locale, approx } = shown(l, fx)
  const s = `${approx ? '≈ ' : ''}${sym} ${n.toLocaleString(locale)}`
  return l.contract === 'rent' ? `${s}/mese` : s
}

// Compact price used on map pins (es. £695k, €1.2M, £1.4k/m)
export const shortP = (l, fx) => {
  const { sym, n, approx } = shown(l, fx)
  const pre = (approx ? '≈' : '') + sym
  if (l.contract === 'rent') {
    return pre + (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : n) + '/m'
  }
  return pre + (n >= 1000000
    ? (n / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
    : Math.round(n / 1000) + 'k')
}

// Price per m² (sale listings with a published floor area), in the shown
// currency — the number buyers compare across zones and portals.
export const ppm = (l, fx) => {
  if (l.contract !== 'sale' || !l.size || !l.price) return null
  const { sym, n, locale, approx } = shown(l, fx)
  return `${approx ? '≈' : ''}${sym}${Math.round(n / l.size).toLocaleString(locale)}/m²`
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

// ---- Sorgente dell'annuncio ----
// Badge identity for each data source (key drives the badge colour).
const SOURCES = [
  [/rightmove/, 'rightmove', 'Rightmove'],
  [/onthemarket/, 'otm', 'OnTheMarket'],
  [/s1homes/, 's1', 's1homes'],
  [/tspc/, 'tspc', 'TSPC'],
  [/myhome/, 'myhome', 'MyHome'],
  [/espc\.com/, 'espc', 'ESPC'],
  [/futurepropertyauctions/, 'auction', 'Future PA'],
  [/auctionhouse/, 'auction', 'Auction House'],
  [/primepropertyauctions/, 'auction', 'Prime'],
]
export const srcOf = (url) => {
  for (const [re, key, label] of SOURCES) if (re.test(url || '')) return { key, label }
  return null
}

// ---- Imposte d'acquisto stimate (SECONDA casa) ----
// Scozia: LBTT a scaglioni (0/2/5/10/12%) + ADS 8% sull'intero prezzo per
// le additional dwellings (aliquota dal 5 dic 2024). Irlanda: imposta di
// registro 1% fino a 1M, 2% fino a 1.5M, 6% oltre. Stima indicativa.
export const buyTax = (l) => {
  if (l.contract === 'rent' || !l.price) return null
  const p = l.price
  if (l.currency === 'GBP') {
    const bands = [[145000, 0], [250000, 0.02], [325000, 0.05], [750000, 0.10], [Infinity, 0.12]]
    let lbtt = 0, prev = 0
    for (const [cap, rate] of bands) {
      const amt = Math.min(p, cap) - prev
      if (amt > 0) lbtt += amt * rate
      prev = cap
      if (p <= cap) break
    }
    const ads = p >= 40000 ? p * 0.08 : 0
    return { sym: '\u00a3', lbtt: Math.round(lbtt), ads: Math.round(ads), total: Math.round(lbtt + ads) }
  }
  const sd = p <= 1000000 ? p * 0.01
    : p <= 1500000 ? 10000 + (p - 1000000) * 0.02
    : 20000 + (p - 1500000) * 0.06
  return { sym: '\u20ac', lbtt: Math.round(sd), ads: 0, total: Math.round(sd) }
}

// ---- Coastal areas inside the catch-all "Costa Scozia" zone ----
// The zone is a 400-listing bucket; the town says where a house really
// is. Area names are shown as a second filter when a zone spans several.
const AREAS = [
  [/^(Ayr|Troon|Prestwick|Largs|Girvan|Millport|Wemyss Bay|Skelmorlie)$/i, 'Ayrshire e Clyde'],
  [/^(Aberdeen|Stonehaven|Portlethen|Newtonhill)$/i, 'Aberdeen e Kincardine'],
  [/^(Nairn|Lossiemouth|Hopeman|Burghead|Elgin|Forres)$/i, 'Moray e Nairn'],
  [/^(Arbroath|Montrose|Carnoustie|Auchmithie|Inverkeilor)$/i, 'Angus'],
  [/^(Oban|Dunoon|Rothesay|Tarbert|Helensburgh|Campbeltown|Bute)$/i, 'Argyll'],
  [/^(Kirkcudbright|Portpatrick|Stranraer|Dumfries)$/i, 'Dumfries e Galloway'],
  [/^(Dunbar|Eyemouth|Coldingham|North Berwick|Gullane)$/i, 'Lothian e Borders'],
  [/^(St ?Andrews|Leuchars|Anstruther|Crail|Elie|Pittenweem|St Monans)$/i, 'Fife'],
]
export const areaOf = (town) => {
  for (const [re, name] of AREAS) if (re.test(town || '')) return name
  return null
}

// ---- Satellite basemap (no API key) ----
// Esri World Imagery for the aerial view, CARTO label overlay so towns and
// roads stay readable on top of it. Shared by the main map and the detail
// sheet's inline mini-map.
export const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SAT_LABELS = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'
export const SAT_ATTR = 'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, GIS User Community · labels &copy; <a href="https://carto.com/attributions">CARTO</a>'
