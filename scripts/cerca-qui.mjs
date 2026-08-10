// Deterministic handler for a "Cerca qui:" issue — run by the cerca-qui
// GitHub Action the moment a request lands, so the portal answers in minutes
// instead of waiting for the daily agent (which remains the fallback and the
// one that keeps the zone fresh afterwards).
//
// Reads ISSUE_BODY from the environment, scrapes the right portal for the
// country (Rightmove for the UK, MyHome.ie for Ireland), and rewrites
// public/data.json + docs/extra-zones.json. Outcome goes to $GITHUB_OUTPUT:
//   status = ok | none | error   added = N   zone = <name>   msg = <detail>
// Exit code is always 0 — the workflow branches on `status`.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { execFile } from 'child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const ROOT = new URL('..', import.meta.url).pathname
const TODAY = new Date().toISOString().slice(0, 10)

const out = (k, v) => {
  console.log(`${k}=${v}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
}
const finish = (status, msg, zone = '', added = 0) => {
  out('status', status); out('msg', msg); out('zone', zone); out('added', added)
  process.exit(0)
}

// curl instead of fetch: it honors proxy/CA env everywhere the script runs.
const get = (url) => new Promise((resolve, reject) =>
  execFile('curl', ['-sf', '--max-time', '25', '-A', UA, url], { maxBuffer: 64e6 },
    (e, so) => (e ? reject(new Error(`curl ${url}`)) : resolve(so.toString()))))

// Bounded-concurrency map: detail pages download in parallel (8 at a time)
// so quality enrichment (full-text seaView/feats) doesn't cost minutes.
const pmap = async (items, fn, limit = 8) => {
  const res = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k) }
  }))
  return res
}

// ---- Parse the request ----
const m = /```json\s*([\s\S]*?)```/.exec(process.env.ISSUE_BODY || '')
if (!m) finish('error', 'blocco JSON non trovato nella issue')
let req
try { req = JSON.parse(m[1]) } catch { finish('error', 'JSON della issue non valido') }
const { place, lat, lng, bounds } = req
const num = (v) => typeof v === 'number' && Number.isFinite(v)
if (!num(lat) || !num(lng) || !bounds || !num(bounds.north) || !num(bounds.south) || !num(bounds.east) || !num(bounds.west))
  finish('error', 'coordinate o confini mancanti')
if (lat < 49.5 || lat > 61.2 || lng < -11.5 || lng > 1.9) finish('error', 'area fuori da UK/Irlanda')
const padLat = (bounds.north - bounds.south) * 0.3
const padLng = (bounds.east - bounds.west) * 0.3
const box = { n: bounds.north + padLat, s: bounds.south - padLat, e: bounds.east + padLng, w: bounds.west - padLng }
const inBox = (la, ln) => la >= box.s && la <= box.n && ln >= box.w && ln <= box.e
  && la >= 49.5 && la <= 61.2 && ln >= -11.5 && ln <= 1.9

// ---- Country + town via Nominatim ----
// The map centre can sit over water (coastal areas!), where a reverse
// geocode only says "Ireland": probe the centre first, then the bounds
// corners, until a real locality and county show up. A generic place name
// from the request ("Irlanda", "Scotland"...) is ignored.
const GENERIC = /^(irlanda|ireland|éire|eire|scozia|scotland|alba|uk|united kingdom|regno unito|great britain|gb)$/i
const revgeo = async (la, ln, zoom) => {
  try { return JSON.parse(await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${ln}&zoom=${zoom}&accept-language=en`)) } catch { return null }
}
const probes = [
  [lat, lng, 12], [lat, lng, 10],
  [bounds.north, bounds.west, 10], [bounds.north, bounds.east, 10],
  [bounds.south, bounds.west, 10], [bounds.south, bounds.east, 10],
]
let addr = {}, geoTown = '', county = '', cc = ''
const nearTowns = new Set()
for (const [la, ln, z] of probes) {
  const g = await revgeo(la, ln, z)
  const a = g?.address
  if (!a) continue
  cc = cc || a.country_code || ''
  for (const k of ['town', 'village', 'city', 'hamlet']) if (a[k] && !/^county /i.test(a[k])) nearTowns.add(a[k])
  const gt = a.town || a.village || a.city || a.hamlet || ''
  geoTown = geoTown || (/^county /i.test(gt) ? '' : gt)
  county = county || a.county || ''
  if (!addr.state) addr = a
}
// Localities actually inside the (padded) area, via Overpass: reverse
// geocoding misses them when probe points land on water or open country.
// NB: Overpass answers 406 to browser user agents — plain curl UA here.
let nearestTown = ''
const q = `[out:json][timeout:10];node["place"~"town|village|hamlet"](${box.s},${box.w},${box.n},${box.e});out 30;`
for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
  try {
    const ov = await new Promise((resolve, reject) =>
      execFile('curl', ['-sf', '--max-time', '20', '-A', 'casatrova-agent/1.0', ep, '--data-urlencode', `data=${q}`], { maxBuffer: 16e6 },
        (e, so) => (e ? reject(e) : resolve(JSON.parse(so.toString())))))
    let best = Infinity
    for (const el of ov.elements || []) {
      const nm = el.tags?.['name:en'] || el.tags?.name
      if (!nm) continue
      nearTowns.add(nm)
      const d = (el.lat - lat) ** 2 + (el.lon - lng) ** 2
      if (d < best) { best = d; nearestTown = nm }
    }
    break
  } catch { /* try next mirror */ }
}
cc = cc || (lng < -6.0 && lat < 55.4 ? 'ie' : 'gb')
const reqPlace = typeof place === 'string' && place.trim() && !GENERIC.test(place.trim()) ? place.trim() : ''
const town = (reqPlace || geoTown || nearestTown || county || '').replace(/^County /i, '').trim()
if (!town) finish('error', 'località non identificata')
const scotland = addr.state === 'Scotland' || (cc === 'gb' && lat > 54.6)
const zoneName = `${town} (${cc === 'ie' ? 'Irlanda' : scotland ? 'Scozia' : 'UK'})`

// ---- Existing data ----
const dataPath = ROOT + 'public/data.json'
const db = JSON.parse(readFileSync(dataPath, 'utf8'))
const existingUrls = new Set([...db.listings, ...db.sold].map((l) => l.url).filter(Boolean))
if (db.zones.includes(zoneName))
  finish('none', `la zona «${zoneName}» è già nel portale`, zoneName)
const stats = { candidates: 0, kept: 0, dropQuality: 0, dropBounds: 0, dropDup: 0 }

// ---- Full-text enrichment rules (same as the daily agent) ----
const SEA = [
  /(sea|ocean|coastal|atlantic|estuary|harbour|water|loch|lough|firth|island)[^.]{0,40}views?/i,
  /seafront|waterfront|shorefront|beachfront|water's edge|wild atlantic way/i,
  /overlooking the (sea|ocean|atlantic|firth|bay|coast|harbour|estuary|loch|lough|water|shore|strand)/i,
  /views? (over|of|across|to|towards|onto|out to)( the)? (sea|ocean|atlantic|firth|bay|coast|harbour|estuary|loch|lough|water|shore|strand|islands?)/i,
  /(panoramic|uninterrupted|stunning|elevated|magnificent|breathtaking|commanding) (sea|coastal|ocean|atlantic|water|loch|estuary|harbour) views?/i,
]
const featsOf = (text) => {
  const f = []
  if (/\bgarages?\b/i.test(text)) f.push('Garage')
  if (/\bgardens?\b(?!\s*cent)/i.test(text)) f.push('Giardino')
  if (/\d+\s*acres|paddock|smallholding/i.test(text)) f.push('Terreno')
  if (/in need of (some )?(modernisation|renovation|refurbishment|upgrading|updating)|requir(es|ing) renovation|renovation project|fixer-upper|scope for (modernisation|improvement|renovation)/i.test(text)) f.push('Da ammodernare')
  return f
}

const CAP = 20
const listings = []
let searchKeys = []

if (cc === 'ie') {
  // ---- MyHome.ie: county-wide search, the bounds filter picks the area ----
  const slug = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '-')
  const countySlug = slug((county || '').replace(/^County /i, ''))
  if (!countySlug) finish('error', 'contea irlandese non identificata')
  // County pages as backstop + a targeted search for every locality found
  // in or around the requested area (the county page alone shows only 20
  // county-wide results per page).
  const townSlugs = [...new Set([...nearTowns].map(slug).filter(Boolean))].slice(0, 8)
  searchKeys = [countySlug, ...townSlugs]
  // Town searches FIRST: their brochures are the in-area ones, and the
  // candidate cap below must never crowd them out with county-wide results.
  const urls = [
    ...townSlugs.map((ts) => `https://www.myhome.ie/residential/${countySlug}/house-for-sale-in-${ts}`),
    ...[1, 2, 3, 4, 5].map((pg) => `https://www.myhome.ie/residential/${countySlug}/house-for-sale${pg > 1 ? `?page=${pg}` : ''}`),
  ]
  const pages = await pmap(urls, async (u2) => { try { return await get(u2) } catch { return '' } }, 4)
  const brochures = new Set()
  for (const html of pages) {
    for (const s of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const j = JSON.parse(s[1])
        const items = j['@type'] === 'ItemList' ? j.itemListElement || [] : []
        for (const it of items) { const u2 = it.url || it.item?.url; if (u2) brochures.add(u2) }
      } catch { /* other ld+json blocks */ }
    }
    for (const mm of html.matchAll(/(?:https:\/\/www\.myhome\.ie)?\/residential\/brochure\/[^"'\\\s<>]+/g))
      brochures.add('https://www.myhome.ie' + mm[0].replace('https://www.myhome.ie', '').replace(/[?#].*$/, ''))
  }
  stats.candidates = brochures.size
  const candidates = [...brochures].filter((u) => existingUrls.has(u) ? (stats.dropDup++, false) : true).slice(0, 80)
  const parsed = await pmap(candidates, async (u) => {
    let page
    try { page = await get(u) } catch { return null }
    const title = /<title>([^<]*)/.exec(page)?.[1] || ''
    if (/^(Sold|Sale Agreed)/i.test(title.trim())) { stats.dropQuality++; return null }
    const price = +(/€\s?([\d,]+)/.exec(title)?.[1] || '').replace(/,/g, '')
    const cm = /BrochureMap":\{"longitude":(-?[\d.]+),"latitude":(-?[\d.]+)/.exec(page)
    if (!price || !cm) { stats.dropQuality++; return null }
    const [plng, plat] = [+cm[1], +cm[2]]
    if (!inBox(plat, plng)) { stats.dropBounds++; return null }
    const beds = +(/"NumberOfBeds":(\d+)/.exec(page)?.[1] || 0) || null
    const imgs = [...new Set([...page.matchAll(/https:\/\/photos-a\.propertyimages\.ie\/media\/[^"'\\]+_l\.jpg/g)].map((x) => x[0]))].slice(0, 6)
    const text = page.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
    // Title is "€price | address - agency - id - MyHome.ie"; the h1 is cleaner.
    const h1 = /<h1[^>]*>\s*([^<]+)/.exec(page)?.[1]?.trim()
    const addrTxt = h1 || (title.split('|')[1] || title).split(/ [-–] /)[0].trim() || town
    return {
      id: 0, title: addrTxt, type: 'Casa indipendente', contract: 'sale', price, currency: 'EUR',
      size: null, rooms: beds, baths: null, floor: null, year: null, energy: null,
      zone: zoneName, town, addr: addrTxt, lat: plat, lng: plng, imgs,
      feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY, url: u,
    }
  })
  listings.push(...parsed.filter(Boolean).slice(0, CAP))
} else {
  // ---- Rightmove ----
  let loc
  try {
    const ta = JSON.parse(await get(`https://los.rightmove.co.uk/typeahead?query=${encodeURIComponent(town)}&limit=10`))
    loc = (ta.matches || []).find((x) => x.type === 'REGION')
  } catch { /* handled below */ }
  if (!loc) finish('error', `località Rightmove non trovata per ${town}`)
  loc = `REGION^${loc.id}`
  searchKeys = [loc.replace('REGION^', '')]
  const pages = await pmap([0, 24], async (index) => {
    try {
      return await get(`https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=${encodeURIComponent(loc)}&searchType=SALE&numberOfPropertiesPerPage=24&index=${index}`)
    } catch { return '' }
  }, 2)
  const props = []
  for (const html of pages) {
    const k = html.indexOf('"properties":[')
    if (k < 0) continue
    let i = html.indexOf('[', k), depth = 0, j = i
    for (; j < html.length; j++) {
      if (html[j] === '[') depth++
      else if (html[j] === ']') { depth--; if (!depth) break }
    }
    try { props.push(...JSON.parse(html.slice(i, j + 1))) } catch { /* partial page */ }
  }
  const seen = new Set()
  const candidates = props.filter((p) => {
    stats.candidates++
    if (p.transactionType && p.transactionType !== 'buy') { stats.dropQuality++; return false }
    const pla = p.location?.latitude, pln = p.location?.longitude
    if (!pla || !pln) { stats.dropQuality++; return false }
    if (!inBox(pla, pln)) { stats.dropBounds++; return false }
    const sub = (p.propertySubType || '').toLowerCase()
    if (/land|plot|site|garage|parking/.test(sub)) { stats.dropQuality++; return false }
    if (!p.price?.amount) { stats.dropQuality++; return false }
    const url = `https://www.rightmove.co.uk/properties/${p.id}`
    if (existingUrls.has(url) || seen.has(url)) { stats.dropDup++; return false }
    seen.add(url)
    return true
  }).slice(0, CAP)
  const enriched = await pmap(candidates, async (p) => {
    const sub = (p.propertySubType || '').toLowerCase()
    const url = `https://www.rightmove.co.uk/properties/${p.id}`
    let text = ''
    try {
      const page = await get(url)
      const kf = page.indexOf('"keyFeatures"')
      text = (kf >= 0 ? page.slice(kf, kf + 6000) : page.slice(0, 60000)).replace(/<[^>]+>/g, ' ')
    } catch { /* enrich is best-effort */ }
    return {
      id: 0, title: p.displayAddress, contract: 'sale',
      type: /bungalow/.test(sub) ? 'Bungalow' : /flat|apartment/.test(sub) ? 'Appartamento' : /cottage/.test(sub) ? 'Cottage' : 'Casa indipendente',
      price: p.price.amount, currency: 'GBP',
      size: null, rooms: p.bedrooms ?? null, baths: p.bathrooms || null, floor: null, year: null, energy: null,
      zone: zoneName, town, addr: p.displayAddress, lat: p.location.latitude, lng: p.location.longitude,
      imgs: (p.propertyImages?.images || []).slice(0, 6).map((im) => (im.srcUrl || '').replace('media.rightmove.co.uk:443', 'media.rightmove.co.uk')).filter(Boolean),
      feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY, url,
    }
  })
  listings.push(...enriched)
}

const alreadyInArea = db.listings.filter((l) => inBox(l.lat, l.lng)).length
if (!listings.length)
  finish('none', alreadyInArea
    ? `nessun annuncio NUOVO nell'area di ${town}: le ${alreadyInArea} case in vendita lì sono già nel portale`
    : `nessun annuncio in vendita trovato nell'area di ${town}`, zoneName)

// ---- Write public/data.json ----
const maxId = Math.max(0, ...db.listings.map((l) => l.id))
listings.forEach((l, i) => { l.id = maxId + 1 + i })
db.zones.push(zoneName)
db.listings.push(...listings)
writeFileSync(dataPath, JSON.stringify(db))

// ---- Record the zone for the daily agent's refreshes ----
const ezPath = ROOT + 'docs/extra-zones.json'
const ez = existsSync(ezPath) ? JSON.parse(readFileSync(ezPath, 'utf8')) : []
if (!ez.some((z) => z.zone === zoneName)) {
  ez.push({
    zone: zoneName, country: cc === 'ie' ? 'IE' : 'UK', portal: cc === 'ie' ? 'myhome' : 'rightmove',
    searchKeys, filter: town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cap: CAP, bounds,
  })
  writeFileSync(ezPath, JSON.stringify(ez, null, 2) + '\n')
}

const sv = listings.filter((l) => l.seaView).length
const ft = listings.filter((l) => l.feats.length).length
finish('ok', `${stats.candidates} annunci esaminati → ${listings.length} pubblicati (${stats.dropBounds} fuori area, ${stats.dropDup} già noti, ${stats.dropQuality} scartati per dati incompleti)${alreadyInArea ? ` · nell'area c'erano già ${alreadyInArea} case del portale` : ''} · vista mare: ${sv} · con caratteristiche: ${ft}`, zoneName, listings.length)
