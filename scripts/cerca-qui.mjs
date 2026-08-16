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
// A bare "garden(s)" is not enough for the Giardino tag: area blurbs cite
// castle gardens, botanic gardens and garden centres. Require the garden to
// belong to the property — a qualifier, a position, or a key-features bullet.
const GARDEN = [
  /(private|rear|front|back|enclosed|walled|landscaped|mature|secluded|generous|large|sizeable|beautiful|lovely|sunny|substantial|good[- ]sized|wrap[- ]?around|low[- ]maintenance|well[- ](?:kept|maintained|tended|stocked)|(?:south|west|east|north)(?:[- ](?:east|west))?[- ]facing)\s+gardens?\b/i,
  /gardens?\s+(?:to|at)\s+(?:the\s+)?(?:front|rear|side|back)|garden\s+grounds?\b/i,
  /with\s+(?:a\s+|its\s+own\s+|extensive\s+)?gardens?\b|gardens?\s+(?:is|are)\s+(?:fully\s+)?(?:enclosed|landscaped|walled|laid|fenced)/i,
  /"gardens?"/i, // a stand-alone key-features bullet
  /gardens?\s+(?:and|&|with)\s+(?:garage|parking|driveway|patio|decking|greenhouse|shed)/i,
]
// Beachfront needs DIRECT adjacency phrasing — "walking distance to the
// beach" is half of coastal ad copy and must not count.
const BEACH = [
  /beach ?front|beach[- ]?side|shore ?front|foreshore|water'?s edge/i,
  /(?:\bon|onto|edge of|bordering|adjoining|beside|directly (?:on|above|overlooking)|(?:private|direct) access to) (?:the |[A-Z][a-z]+ )?(?:beach|shore|strand)\b/i,
  /steps? (?:from|to|away from) the (?:beach|shore|sea|strand|water)\b/i,
]
const featsOf = (text) => {
  const f = []
  if (/\bgarages?\b/i.test(text)) f.push('Garage')
  if (GARDEN.some((r) => r.test(text))) f.push('Giardino')
  if (BEACH.some((r) => r.test(text))) f.push('Spiaggia')
  if (/\d+\s*acres|paddock|smallholding/i.test(text)) f.push('Terreno')
  if (/in need of (some )?(modernisation|renovation|refurbishment|upgrading|updating)|requir(es|ing) renovation|renovation project|fixer-upper|scope for (modernisation|improvement|renovation)/i.test(text)) f.push('Da ammodernare')
  return f
}

const CAP = 20
const listings = []
let searchKeys = []
let otmSlugs = [], s1Towns = []

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
    const text = page.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
    // Not every brochure carries the NumberOfBeds JSON — fall back to the
    // visible "3 beds 1 bath" strapline.
    const bedsRaw = +(/"NumberOfBeds":(\d+)/.exec(page)?.[1] || /\b(\d{1,2})\s*beds?\b/i.exec(text)?.[1] || 0)
    const beds = bedsRaw >= 1 && bedsRaw <= 12 ? bedsRaw : null
    const bathsRaw = +(/"NumberOfBathrooms":(\d+)/.exec(page)?.[1] || /\b(\d{1,2})\s*baths?\b/i.exec(text)?.[1] || 0)
    const baths = bathsRaw >= 1 && bathsRaw <= 10 ? bathsRaw : null
    const imgs = [...new Set([...page.matchAll(/https:\/\/photos-a\.propertyimages\.ie\/media\/[^"'\\]+_l\.jpg/g)].map((x) => x[0]))].slice(0, 15)
    // Title is "€price | address - agency - id - MyHome.ie"; the h1 is cleaner.
    const h1 = /<h1[^>]*>\s*([^<]+)/.exec(page)?.[1]?.trim()
    const addrTxt = h1 || (title.split('|')[1] || title).split(/ [-–] /)[0].trim() || town
    return {
      id: 0, title: addrTxt, type: 'Casa indipendente', contract: 'sale', price, currency: 'EUR',
      size: null, rooms: beds, baths, floor: null, year: null, energy: null,
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
    if (/land|plot|site|garage|parking|private hall|block of/.test(sub)) { stats.dropQuality++; return false }
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
    let gal = []
    let sz = null
    try {
      const page = await get(url)
      const kf = page.indexOf('"keyFeatures"')
      text = (kf >= 0 ? page.slice(kf, kf + 6000) : page.slice(0, 60000)).replace(/<[^>]+>/g, ' ')
      gal = [...new Set([...page.matchAll(/https:\/\/media\.rightmove\.co\.uk\/property-photo\/[\w/]+\.jpe?g/g)].map((x) => x[0]))].slice(0, 15)
      const sqm = +((/info-reel-SIZE-text"><p[^>]*>[^<]*<\/p><p[^>]*>([\d,]+)\s*sq m/.exec(page)?.[1] || '').replace(/,/g, ''))
      if (sqm > 15 && sqm < 2000) sz = sqm
    } catch { /* enrich is best-effort */ }
    return {
      id: 0, title: p.displayAddress, contract: 'sale',
      type: /bungalow/.test(sub) ? 'Bungalow' : /flat|apartment/.test(sub) ? 'Appartamento' : /cottage/.test(sub) ? 'Cottage' : 'Casa indipendente',
      price: p.price.amount, currency: 'GBP',
      size: sz, rooms: p.bedrooms ?? null, baths: p.bathrooms || null, floor: null, year: null, energy: null,
      zone: zoneName, town, addr: p.displayAddress, lat: p.location.latitude, lng: p.location.longitude,
      imgs: gal.length ? gal : (p.propertyImages?.images || []).slice(0, 6).map((im) => (im.srcUrl || '').replace('media.rightmove.co.uk:443', 'media.rightmove.co.uk')).filter(Boolean),
      feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY, url,
    }
  })
  listings.push(...enriched)

  // ---- OnTheMarket + s1homes: the other UK sources, tried dynamically on
  // the same locality names. Unknown towns answer 404 (OTM) or an empty
  // result set (s1homes) and are skipped silently; the slugs that answered
  // are recorded in extra-zones.json so the daily agent keeps every source
  // refreshing this zone. Cross-source duplicates (same house, another
  // portal) are dropped by address+price / price+coords / address-prefix
  // keys, seeded with everything the portal already carries.
  const slugUk = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ +/g, '-')
  const slugs = [...new Set([town, ...nearTowns].filter(Boolean).map(slugUk).filter(Boolean))].slice(0, 7)
  const normAddr = (a) => a.toLowerCase().replace(/plot \d+/g, '').replace(/[^a-z0-9]/g, '')
  // Same house on another portal: same price within ~150m. A real distance
  // check, not a rounded-coords string key. Different prices at one address
  // can be distinct units of the same building, so they all stay.
  const nearPt = (p, l) => p.price === l.price &&
    Math.abs(p.lat - l.lat) < 0.0015 && Math.abs(p.lng - l.lng) < 0.003
  const dupKeys = new Set()
  const placed = []
  for (const l of [...listings, ...db.listings]) {
    if (!l.addr) continue
    dupKeys.add(normAddr(l.addr).slice(0, 40) + '|' + l.price)
    placed.push({ price: l.price, lat: l.lat, lng: l.lng })
  }
  const pushCand = (l) => {
    if (listings.length >= CAP) return
    if (existingUrls.has(l.url)) { stats.dropDup++; return }
    const k = normAddr(l.addr).slice(0, 40) + '|' + l.price
    if (dupKeys.has(k) || placed.some((p) => nearPt(p, l))) { stats.dropDup++; return }
    dupKeys.add(k)
    placed.push({ price: l.price, lat: l.lat, lng: l.lng })
    listings.push(l)
  }

  const otmFound = []
  await pmap(slugs, async (sl) => {
    let html
    try { html = await get(`https://www.onthemarket.com/for-sale/property/${sl}/`) } catch { return }
    const mm = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)
    if (!mm) return
    let list
    try { list = JSON.parse(mm[1]).props?.initialReduxState?.results?.list } catch { return }
    if (!Array.isArray(list)) return
    otmSlugs.push(sl)
    otmFound.push(...list)
  }, 4)
  for (const o of otmFound) {
    stats.candidates++
    const price = +String(o.price || '').replace(/[^0-9]/g, '')
    const pla = o.location?.lat, pln = o.location?.lon
    if (!price || typeof pla !== 'number' || typeof pln !== 'number') { stats.dropQuality++; continue }
    if (!inBox(pla, pln)) { stats.dropBounds++; continue }
    const ptype = (o['humanised-property-type'] || '').toLowerCase()
    if (/land|plot|site|garage|parking|mooring/.test(ptype)) { stats.dropQuality++; continue }
    const text = `${o['property-title'] || ''} ${(o.features || []).join(' ')}`
    pushCand({
      id: 0, title: o.address || town, contract: 'sale',
      type: /bungalow/.test(ptype) ? 'Bungalow' : /flat|apartment|maisonette/.test(ptype) ? 'Appartamento' : /cottage/.test(ptype) ? 'Cottage' : 'Casa indipendente',
      price, currency: 'GBP',
      size: null, rooms: o.bedrooms ?? null, baths: o.bathrooms || null, floor: null, year: null, energy: null,
      zone: zoneName, town, addr: o.address || town, lat: pla, lng: pln,
      imgs: (o.images || []).slice(0, 6).map((im) => im.default).filter((u) => u && u.startsWith('https://media.onthemarket.com/')),
      feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY,
      url: `https://www.onthemarket.com/details/${o.id}/`,
    })
  }
  // Detail pages of the OnTheMarket keeps: full description (seaView/feats),
  // size in m², 1024px photos.
  await pmap(listings.filter((l) => l.url.includes('onthemarket')), async (l) => {
    try {
      const page = await get(l.url)
      const p = JSON.parse(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(page)[1]).props?.initialReduxState?.property
      if (!p) return
      const text = `${p.description || ''} ${(p.features || []).map((f) => f.feature || '').join(' ')}`.replace(/<[^>]+>/g, ' ')
      if (text.trim()) { l.seaView = SEA.some((r) => r.test(text)); l.feats = featsOf(text) }
      if (+p.minimumAreaSqM > 15) l.size = Math.round(+p.minimumAreaSqM)
      const big = (p.images || []).filter((im) => im.isImage && im.largeUrl?.startsWith('https://media.onthemarket.com/')).slice(0, 15).map((im) => im.largeUrl)
      if (big.length) l.imgs = big
    } catch { /* enrich is best-effort */ }
  }, 8)

  // s1homes ignores the region segment of the search path, so a fixed
  // placeholder works for any town. Its search pages embed the full listing
  // JSON — no per-listing fetch needed.
  const s1Found = []
  await pmap(slugs.map((s) => s.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('-')), async (ts) => {
    let html
    try { html = await get(`https://www.s1homes.com/property-for-sale/Scotland/${ts}/`) } catch { return }
    const k2 = html.indexOf('window.__ssr_init_data__')
    if (k2 < 0) return
    let i2 = html.indexOf('{', k2), d2 = 0, j2 = i2
    for (; j2 < html.length; j2++) { if (html[j2] === '{') d2++; else if (html[j2] === '}') { d2--; if (!d2) break } }
    let data
    try { data = JSON.parse(html.slice(i2, j2 + 1)).propertyAdvancedSearch?.data } catch { return }
    if (!Array.isArray(data)) return
    s1Towns.push(ts)
    s1Found.push(...data)
  }, 4)
  for (const o of s1Found) {
    stats.candidates++
    if (o.channel && o.channel.key !== 'sales') { stats.dropQuality++; continue }
    const pla = parseFloat(o.latitude), pln = parseFloat(o.longitude)
    if (!o.price || !Number.isFinite(pla) || !Number.isFinite(pln)) { stats.dropQuality++; continue }
    if (!inBox(pla, pln)) { stats.dropBounds++; continue }
    const ptype = (o.propertyType?.name || '').toLowerCase()
    if (/land|plot|site|garage|parking/.test(ptype)) { stats.dropQuality++; continue }
    const addrTxt = [o.houseNameNumber, o.address2, o.address3, o.town, o.postcode].filter(Boolean).join(', ') || town
    const featStr = (o.features || []).join(' ')
    const text = `${o.summary || ''} ${o.description || ''}`.replace(/<[^>]+>/g, ' ')
    pushCand({
      id: 0, title: addrTxt, contract: 'sale',
      type: /bungalow/.test(ptype) ? 'Bungalow' : /flat|apartment|maisonette/.test(ptype) ? 'Appartamento' : /cottage/.test(ptype) ? 'Cottage' : 'Casa indipendente',
      price: o.price, currency: 'GBP',
      size: null, rooms: ((n) => (n >= 1 && n <= 12 ? n : null))(+(/([0-9]+)\s*bedroom/.exec(featStr)?.[1] || 0)),
      baths: ((n) => (n >= 1 && n <= 10 ? n : null))(+(/([0-9]+)\s*bathroom/.exec(featStr)?.[1] || 0)),
      floor: null, year: null, energy: null,
      zone: zoneName, town, addr: addrTxt, lat: pla, lng: pln,
      imgs: (o.media || []).slice(0, 6).map((mo) => mo.metadata?.src?.url).filter((u) => u && u.startsWith('https://cdn.s1homes.com/')),
      feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY,
      url: `https://www.s1homes.com/property/${o.propertyId}`,
    })
  }
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
    ...(otmSlugs.length ? { otmSlugs: [...new Set(otmSlugs)] } : {}),
    ...(s1Towns.length ? { s1Towns: [...new Set(s1Towns)] } : {}),
  })
  writeFileSync(ezPath, JSON.stringify(ez, null, 2) + '\n')
}

const sv = listings.filter((l) => l.seaView).length
const ft = listings.filter((l) => l.feats.length).length
finish('ok', `${stats.candidates} annunci esaminati → ${listings.length} pubblicati (${stats.dropBounds} fuori area, ${stats.dropDup} già noti, ${stats.dropQuality} scartati per dati incompleti)${alreadyInArea ? ` · nell'area c'erano già ${alreadyInArea} case del portale` : ''} · vista mare: ${sv} · con caratteristiche: ${ft}`, zoneName, listings.length)
