// Deterministic daily refresh of public/data.json — run by the
// daily-refresh GitHub Action (and runnable by hand: node scripts/daily-refresh.mjs).
//
// Re-scrapes every zone (built-ins + docs/extra-zones.json), then applies the
// portal's contract: first-seen dates are kept, live listings that fell out of
// the capped sample are carried over, vanished listings are verified on the
// source before being archived as sold/removed, price changes are tracked.
// Writes nothing when nothing changed. Outcome goes to $GITHUB_OUTPUT:
//   status = changed | none | error   summary = <one line>
// and a human report is written to refresh-report.md (for the commit body).

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { execFile } from 'child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const ROOT = new URL('..', import.meta.url).pathname
const TODAY = new Date().toISOString().slice(0, 10)

const out = (k, v) => {
  console.log(`${k}=${v}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
}

const get = (url) => new Promise((resolve, reject) =>
  execFile('curl', ['-sf', '--max-time', '25', '-A', UA, url], { maxBuffer: 64e6 },
    (e, so) => (e ? reject(new Error(`curl ${url}`)) : resolve(so.toString()))))
const getStatus = (url) => new Promise((resolve) =>
  execFile('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', '-A', UA, url], {},
    (e, so) => resolve(e ? 0 : +so.toString())))

const pmap = async (items, fn, limit = 8) => {
  const res = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k) }
  }))
  return res
}

const validCoords = (la, ln) => typeof la === 'number' && typeof ln === 'number' &&
  la >= 49.5 && la <= 61.2 && ln >= -11.5 && ln <= 1.9 && la !== 0 && ln !== 0

// ---- Full-text enrichment (same rules as the instant handler) ----
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

// ---- Zone configurations ----
const RM_ZONES = [
  { zone: 'North Berwick (Scozia)', town: 'North Berwick', codes: ['1008'], pages: [0, 24], filter: /North Berwick|Gullane|Dirleton|Aberlady|EH39|EH31/i, cap: 30 },
  { zone: 'East Neuk (Fife, Scozia)', town: 'Anstruther', codes: ['97068'], pages: [0, 24], filter: /Anstruther|Crail|Pittenweem|St Monans|Elie|Cellardyke|KY10|KY9/i, cap: 30 },
  { zone: 'Rosemarkie (Scozia)', town: 'Rosemarkie', codes: ['94460'], pages: [0, 24], filter: /Rosemarkie|Fortrose|Avoch|IV10/i, cap: 16 },
  { zone: 'Loch Tay (Scozia)', town: 'Kenmore', codes: ['6', '13772', '738'], pages: [0, 24], filter: /Kenmore|Aberfeldy|Killin|Acharn|Fearnan|Lawers|Fortingall|Weem|Dull|Loch Tay|PH15/i, cap: 22 },
]
const COSTA = {
  zone: 'Costa Scozia (≤4h da Edimburgo)', cap: 48, perTown: 4,
  towns: [
    ['449', 'Dunbar', /Dunbar/i], ['1245', 'St Andrews', /St ?Andrews/i], ['1022', 'Oban', /Oban/i],
    ['774', 'Largs', /Largs/i], ['74', 'Ayr', /Ayr|Troon|Prestwick/i], ['1274', 'Stonehaven', /Stonehaven/i],
    ['965', 'Nairn', /Nairn/i], ['755', 'Kirkcudbright', /Kirkcudbright/i], ['20157', 'Portpatrick', /Portpatrick/i],
    ['1315', 'Tarbert', /Tarbert/i], ['869', 'Lossiemouth', /Lossiemouth|Hopeman|Burghead/i], ['4', 'Aberdeen', /Aberdeen/i],
    ['457', 'Dunoon', /Dunoon/i], ['21140', 'Rothesay', /Rothesay|Bute/i], ['549', 'Girvan', /Girvan/i],
    ['497', 'Eyemouth', /Eyemouth|Coldingham/i], ['45', 'Arbroath', /Arbroath/i], ['952', 'Montrose', /Montrose/i],
    ['621', 'Helensburgh', /Helensburgh/i], ['17291', 'Millport', /Millport|Cumbrae/i],
    ['1421', 'Wemyss Bay', /Wemyss Bay|Skelmorlie/i], ['287', 'Carnoustie', /Carnoustie/i],
  ],
}
const MH_BURTONPORT = {
  zone: 'Burtonport (Donegal, IE)', county: 'donegal', cap: 30,
  towns: ['burtonport', 'dungloe', 'kincasslagh', 'annagry', 'gweedore', 'falcarragh'],
}

// ---- Scrapers (search results only; detail pages fetched for NEW urls) ----
const rmSearch = async (code, index) => {
  let html
  try {
    html = await get(`https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E${code}&searchType=SALE&numberOfPropertiesPerPage=24&index=${index}`)
  } catch { return [] }
  const k = html.indexOf('"properties":[')
  if (k < 0) return []
  let i = html.indexOf('[', k), d = 0, j = i
  for (; j < html.length; j++) { if (html[j] === '[') d++; else if (html[j] === ']') { d--; if (!d) break } }
  try { return JSON.parse(html.slice(i, j + 1)) } catch { return [] }
}
const rmCandidate = (p, zone, town) => {
  if (p.transactionType && p.transactionType !== 'buy') return null
  const sub = (p.propertySubType || '').toLowerCase()
  if (/land|plot|site|garage|parking/.test(sub)) return null
  if (!p.price?.amount || !validCoords(p.location?.latitude, p.location?.longitude)) return null
  return {
    id: 0, title: p.displayAddress, contract: 'sale',
    type: /bungalow/.test(sub) ? 'Bungalow' : /flat|apartment/.test(sub) ? 'Appartamento' : /cottage/.test(sub) ? 'Cottage' : 'Casa indipendente',
    price: p.price.amount, currency: 'GBP',
    size: null, rooms: p.bedrooms ?? null, baths: p.bathrooms || null, floor: null, year: null, energy: null,
    zone, town, addr: p.displayAddress, lat: p.location.latitude, lng: p.location.longitude,
    imgs: (p.propertyImages?.images || []).slice(0, 6).map((im) => (im.srcUrl || '').replace('media.rightmove.co.uk:443', 'media.rightmove.co.uk')).filter(Boolean),
    feats: [], seaView: false, desc: '', date: TODAY,
    url: `https://www.rightmove.co.uk/properties/${p.id}`,
  }
}
const rmEnrich = async (l) => {
  try {
    const page = await get(l.url)
    const kf = page.indexOf('"keyFeatures"')
    const text = (kf >= 0 ? page.slice(kf, kf + 6000) : page.slice(0, 60000)).replace(/<[^>]+>/g, ' ')
    l.seaView = SEA.some((r) => r.test(text))
    l.feats = featsOf(text)
  } catch { /* enrich is best-effort */ }
  return l
}

const mhBrochures = (html) => {
  const set = new Set()
  for (const s of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(s[1])
      const items = j['@type'] === 'ItemList' ? j.itemListElement || [] : []
      for (const it of items) { const u = it.url || it.item?.url; if (u) set.add(u) }
    } catch { /* other blocks */ }
  }
  for (const mm of html.matchAll(/(?:https:\/\/www\.myhome\.ie)?\/residential\/brochure\/[^"'\\\s<>]+/g))
    set.add('https://www.myhome.ie' + mm[0].replace('https://www.myhome.ie', '').replace(/[?#].*$/, ''))
  return set
}
const mhParse = async (u, zone, town) => {
  let page
  try { page = await get(u) } catch { return null }
  const title = /<title>([^<]*)/.exec(page)?.[1] || ''
  if (/^(Sold|Sale Agreed)/i.test(title.trim())) return 'gone'
  const price = +(/€\s?([\d,]+)/.exec(title)?.[1] || '').replace(/,/g, '')
  const cm = /BrochureMap":\{"longitude":(-?[\d.]+),"latitude":(-?[\d.]+)/.exec(page)
  if (!price || !cm || !validCoords(+cm[2], +cm[1])) return null
  const beds = +(/"NumberOfBeds":(\d+)/.exec(page)?.[1] || 0) || null
  const imgs = [...new Set([...page.matchAll(/https:\/\/photos-a\.propertyimages\.ie\/media\/[^"'\\]+_l\.jpg/g)].map((x) => x[0]))].slice(0, 6)
  const text = page.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  const h1 = /<h1[^>]*>\s*([^<]+)/.exec(page)?.[1]?.trim()
  const addrTxt = h1 || (title.split('|')[1] || title).split(/ [-–] /)[0].trim() || town
  return {
    id: 0, title: addrTxt, type: 'Casa indipendente', contract: 'sale', price, currency: 'EUR',
    size: null, rooms: beds, baths: null, floor: null, year: null, energy: null,
    zone, town, addr: addrTxt, lat: +cm[2], lng: +cm[1], imgs,
    feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY, url: u,
  }
}

// ---- Load current data ----
const dataPath = ROOT + 'public/data.json'
const db = JSON.parse(readFileSync(dataPath, 'utf8'))
const prevByUrl = new Map(db.listings.map((l) => [l.url, l]))
const prevSoldUrls = new Set(db.sold.map((s) => s.url).filter(Boolean))
const extra = existsSync(ROOT + 'docs/extra-zones.json') ? JSON.parse(readFileSync(ROOT + 'docs/extra-zones.json', 'utf8')) : []

// ---- Scrape all zones into `scraped` (url → candidate), capped per zone ----
const scraped = new Map()
// Cross-source dedupe: the same house listed on two portals shares its
// address+price, or sits at the same spot with the same price.
const dedupKeys = new Set()
const keysOf = (l) => {
  const norm = l.addr.toLowerCase().replace(/plot \d+/g, '').replace(/[^a-z0-9]/g, '')
  return [
    norm.slice(0, 40) + '|' + l.price,
    `${l.price}|${l.lat.toFixed(3)}|${l.lng.toFixed(3)}`,
    // Same house dual-listed by two agents at different asking prices: the
    // address prefix (house number + street) plus coarse coords match even
    // when the agents word the address and geocode it slightly differently.
    `${norm.slice(0, 12)}|${l.lat.toFixed(2)}|${l.lng.toFixed(2)}`,
  ]
}
const addCapped = (items, cap) => {
  let n = 0
  for (const l of items) {
    if (!l || n >= cap) continue
    if (scraped.has(l.url)) continue
    const ks = keysOf(l)
    if (ks.some((k) => dedupKeys.has(k))) continue
    ks.forEach((k) => dedupKeys.add(k))
    scraped.set(l.url, l)
    n++
  }
}

// Rightmove fixed zones
for (const z of RM_ZONES) {
  const pages = await pmap(z.codes.flatMap((c) => z.pages.map((idx) => [c, idx])), ([c, idx]) => rmSearch(c, idx), 4)
  const cands = pages.flat().filter((p) => z.filter.test(p.displayAddress || '')).map((p) => rmCandidate(p, z.zone, z.town)).filter(Boolean)
  addCapped(cands, z.cap)
  console.log(`${z.zone}: ${cands.length} candidati`)
}
// Costa Scozia: ~3 per town until cap
{
  const perTown = await pmap(COSTA.towns, async ([code, town, filter]) => {
    const props = await rmSearch(code, 0)
    return props.filter((p) => filter.test(p.displayAddress || '')).slice(0, COSTA.perTown + 2)
      .map((p) => rmCandidate(p, COSTA.zone, town)).filter(Boolean).slice(0, COSTA.perTown)
  }, 6)
  addCapped(perTown.flat(), COSTA.cap)
  console.log(`${COSTA.zone}: ${perTown.flat().length} candidati`)
}
// MyHome Burtonport
{
  const pages = await pmap(MH_BURTONPORT.towns, (t) => get(`https://www.myhome.ie/residential/${MH_BURTONPORT.county}/house-for-sale-in-${t}`).catch(() => ''), 4)
  const urls = [...new Set(pages.flatMap((h) => [...mhBrochures(h)]))]
  const parsed = (await pmap(urls, (u) => mhParse(u, MH_BURTONPORT.zone, 'Burtonport'), 8)).filter((x) => x && x !== 'gone')
  addCapped(parsed, MH_BURTONPORT.cap)
  console.log(`${MH_BURTONPORT.zone}: ${parsed.length} candidati`)
}
// ---- s1homes: Scottish solicitors' portal — listings often absent from
// Rightmove. Search pages embed the FULL listing JSON (address, coords,
// price, own-CDN photos, complete description), so no per-listing fetch.
const S1_PATHS = [
  'East-Lothian/North-Berwick', 'East-Lothian/Gullane', 'East-Lothian/Dunbar',
  'Fife/Anstruther', 'Fife/Crail', 'Fife/Pittenweem', 'Fife/Elie', 'Fife/St-Monans', 'Fife/Cellardyke',
  'Fife/St-Andrews', 'Fife/Leuchars',
  'Highland/Fortrose', 'Highland/Rosemarkie', 'Highland/Avoch', 'Highland/Nairn',
  'Perthshire/Aberfeldy', 'Stirlingshire/Killin',
  'Ayrshire/Largs', 'Ayrshire/Ayr', 'Ayrshire/Girvan',
  'Argyll/Oban', 'Argyll/Dunoon', 'Argyll/Tarbert',
  'Aberdeenshire/Stonehaven', 'Moray/Lossiemouth',
  'Dumfries-and-Galloway/Kirkcudbright', 'Dumfries-and-Galloway/Portpatrick',
  'Scottish-Borders/Eyemouth', 'Angus/Arbroath', 'Angus/Montrose', 'Angus/Carnoustie',
  'Dunbartonshire/Helensburgh',
]
const zoneOf = (txt) => {
  for (const z of RM_ZONES) if (z.filter.test(txt)) return { zone: z.zone, town: z.town }
  for (const [, town, filter] of COSTA.towns) if (filter.test(txt)) return { zone: COSTA.zone, town }
  for (const z of extra) { try { if (new RegExp(z.filter, 'i').test(txt)) return { zone: z.zone, town: z.zone.replace(/ \(.*/, '') } } catch { /* bad regex */ } }
  return null
}
const s1Parse = (html) => {
  const k = html.indexOf('window.__ssr_init_data__')
  if (k < 0) return []
  let i = html.indexOf('{', k), d = 0, j = i
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break } }
  try { return JSON.parse(html.slice(i, j + 1)).propertyAdvancedSearch?.data || [] } catch { return [] }
}
const s1Candidate = (o) => {
  if (o.channel && o.channel.key !== 'sales') return null
  const la = parseFloat(o.latitude), ln = parseFloat(o.longitude)
  if (!o.price || !validCoords(la, ln)) return null
  const ptype = (o.propertyType?.name || '').toLowerCase()
  if (/land|plot|site|garage|parking/.test(ptype)) return null
  const addr = [o.houseNameNumber, o.address2, o.address3, o.town, o.postcode].filter(Boolean).join(', ')
  const zt = zoneOf(addr)
  if (!zt) return null
  const featStr = (o.features || []).join(' ')
  const text = `${o.summary || ''} ${o.description || ''}`.replace(/<[^>]+>/g, ' ')
  return {
    id: 0, title: addr, contract: 'sale',
    type: /bungalow/.test(ptype) ? 'Bungalow' : /flat|apartment|maisonette/.test(ptype) ? 'Appartamento' : /cottage/.test(ptype) ? 'Cottage' : 'Casa indipendente',
    price: o.price, currency: 'GBP',
    size: null, rooms: +(/([0-9]+)\s*bedroom/.exec(featStr)?.[1] || 0) || null,
    baths: +(/([0-9]+)\s*bathroom/.exec(featStr)?.[1] || 0) || null,
    floor: null, year: null, energy: null,
    zone: zt.zone, town: zt.town, addr, lat: la, lng: ln,
    imgs: (o.media || []).slice(0, 6).map((m) => m.metadata?.src?.url).filter((u) => u && u.startsWith('https://cdn.s1homes.com/')),
    feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY,
    url: `https://www.s1homes.com/property/${o.propertyId}`,
  }
}
{
  const pages = await pmap(S1_PATHS, (path) => get(`https://www.s1homes.com/property-for-sale/${path}/`).catch(() => ''), 6)
  const cands = pages.flatMap((h) => s1Parse(h)).map(s1Candidate).filter(Boolean)
  const byZone = {}
  for (const l of cands) (byZone[l.zone] = byZone[l.zone] || []).push(l)
  for (const [z, arr] of Object.entries(byZone)) { addCapped(arr, 12); console.log(`s1homes → ${z}: ${arr.length} candidati`) }
}

// ---- OnTheMarket: agent-fed UK portal whose "Only With Us" exclusives are
// absent from Rightmove. Search pages embed the full listing JSON (address,
// exact coords, price, own-CDN photos) in __NEXT_DATA__, so no per-listing
// fetch; detail pages are fetched only for genuinely new listings (otmEnrich).
const OTM_TOWNS = [
  'north-berwick', 'gullane', 'dunbar', 'aberlady',
  'anstruther', 'crail', 'pittenweem', 'st-monans', 'cellardyke',
  'st-andrews', 'leuchars',
  'rosemarkie', 'fortrose', 'avoch', 'nairn',
  'aberfeldy', 'killin', 'kenmore',
  'oban', 'largs', 'ayr', 'stonehaven', 'kirkcudbright', 'portpatrick',
  'lossiemouth', 'dunoon', 'rothesay', 'girvan', 'eyemouth',
  'arbroath', 'montrose', 'helensburgh', 'millport', 'wemyss-bay', 'carnoustie', 'tarbert',
]
const otmNext = (html) => {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html || '')
  if (!m) return null
  try { return JSON.parse(m[1]).props?.initialReduxState || null } catch { return null }
}
const otmCandidate = (o) => {
  const price = +String(o.price || '').replace(/[^0-9]/g, '')
  const la = o.location?.lat, ln = o.location?.lon
  if (!price || !validCoords(la, ln)) return null
  const ptype = (o['humanised-property-type'] || '').toLowerCase()
  if (/land|plot|site|garage|parking|mooring/.test(ptype)) return null
  const addr = o.address || ''
  const zt = zoneOf(addr)
  if (!zt) return null
  const text = `${o['property-title'] || ''} ${(o.features || []).join(' ')}`
  return {
    id: 0, title: addr, contract: 'sale',
    type: /bungalow/.test(ptype) ? 'Bungalow' : /flat|apartment|maisonette/.test(ptype) ? 'Appartamento' : /cottage/.test(ptype) ? 'Cottage' : 'Casa indipendente',
    price, currency: 'GBP',
    size: null, rooms: o.bedrooms ?? null, baths: o.bathrooms || null, floor: null, year: null, energy: null,
    zone: zt.zone, town: zt.town, addr, lat: la, lng: ln,
    imgs: (o.images || []).slice(0, 6).map((im) => im.default).filter((u) => u && u.startsWith('https://media.onthemarket.com/')),
    feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY,
    url: `https://www.onthemarket.com/details/${o.id}/`,
  }
}
const otmEnrich = async (l) => {
  try {
    const p = otmNext(await get(l.url))?.property
    if (!p) return l
    const text = `${p.description || ''} ${(p.features || []).map((f) => f.feature || '').join(' ')}`.replace(/<[^>]+>/g, ' ')
    if (text.trim()) { l.seaView = SEA.some((r) => r.test(text)); l.feats = featsOf(text) }
    if (+p.minimumAreaSqM > 15) l.size = Math.round(+p.minimumAreaSqM)
    const big = (p.images || []).filter((im) => im.isImage && im.largeUrl?.startsWith('https://media.onthemarket.com/')).slice(0, 6).map((im) => im.largeUrl)
    if (big.length) l.imgs = big
  } catch { /* enrich is best-effort */ }
  return l
}
{
  const pages = await pmap(OTM_TOWNS, (t) => get(`https://www.onthemarket.com/for-sale/property/${t}/`).catch(() => ''), 6)
  const cands = pages.flatMap((h) => otmNext(h)?.results?.list || []).map(otmCandidate).filter(Boolean)
  const byZone = {}
  for (const l of cands) (byZone[l.zone] = byZone[l.zone] || []).push(l)
  for (const [z, arr] of Object.entries(byZone)) { addCapped(arr, 12); console.log(`onthemarket → ${z}: ${arr.length} candidati`) }
}

// Extra zones (user-requested)
for (const z of extra) {
  const pad = { latPad: (z.bounds.north - z.bounds.south) * 0.3, lngPad: (z.bounds.east - z.bounds.west) * 0.3 }
  const inb = (la, ln) => la >= z.bounds.south - pad.latPad && la <= z.bounds.north + pad.latPad && ln >= z.bounds.west - pad.lngPad && ln <= z.bounds.east + pad.lngPad
  const townName = z.zone.replace(/ \((Scozia|Irlanda|UK)\)$/, '')
  if (z.portal === 'rightmove') {
    const pages = await pmap(z.searchKeys.flatMap((c) => [0, 24].map((idx) => [c, idx])), ([c, idx]) => rmSearch(c, idx), 4)
    const cands = pages.flat().map((p) => rmCandidate(p, z.zone, townName)).filter((l) => l && inb(l.lat, l.lng))
    addCapped(cands, z.cap || 20)
    console.log(`${z.zone}: ${cands.length} candidati`)
  } else {
    const county = z.searchKeys[0]
    const urls2 = [
      ...z.searchKeys.slice(1).map((ts) => `https://www.myhome.ie/residential/${county}/house-for-sale-in-${ts}`),
      ...[1, 2, 3].map((pg) => `https://www.myhome.ie/residential/${county}/house-for-sale${pg > 1 ? `?page=${pg}` : ''}`),
    ]
    const pages = await pmap(urls2, (u) => get(u).catch(() => ''), 4)
    const brochureUrls = [...new Set(pages.flatMap((h) => [...mhBrochures(h)]))].slice(0, 60)
    const parsed = (await pmap(brochureUrls, (u) => mhParse(u, z.zone, townName), 8)).filter((x) => x && x !== 'gone')
    addCapped(parsed.filter((l) => inb(l.lat, l.lng)), z.cap || 20)
    console.log(`${z.zone}: ok`)
  }
}
console.log(`scrape totale: ${scraped.size} annunci`)
if (scraped.size < 60) { out('status', 'error'); out('summary', `scrape sospetto: solo ${scraped.size} annunci — non tocco i dati`); process.exit(0) }

// ---- Diff against previous data ----
const events = { nuove: [], ribassi: [], rialzi: [], vendute: [] }
const nextListings = []
const enrichQueue = []
for (const [url, cand] of scraped) {
  const old = prevByUrl.get(url)
  if (!old) { enrichQueue.push(cand); nextListings.push(cand); events.nuove.push(cand); continue }
  const merged = { ...old, price: cand.price, imgs: cand.imgs.length ? cand.imgs : old.imgs, rooms: cand.rooms ?? old.rooms, baths: cand.baths ?? old.baths }
  if (cand.price !== old.price)
    merged.hist = [...(old.hist || [{ d: old.date, p: old.price }]), { d: TODAY, p: cand.price }].slice(-10)
  if (cand.price < old.price) events.ribassi.push({ ...merged, oldPrice: old.price })
  else if (cand.price > old.price) events.rialzi.push({ ...merged, oldPrice: old.price })
  nextListings.push(merged)
}
// Enrich only genuinely new listings with their detail page, per source
// (MyHome and s1homes candidates already carry full-text enrichment from
// their search/brochure parse).
await pmap(enrichQueue.filter((l) => /rightmove\.co\.uk/.test(l.url)), rmEnrich, 8)
await pmap(enrichQueue.filter((l) => /onthemarket\.com/.test(l.url)), otmEnrich, 8)

// Missing urls: verify on the source before archiving; live ones carry over.
const missing = db.listings.filter((l) => !scraped.has(l.url))
const soldNew = []
await pmap(missing, async (l) => {
  if (/myhome\.ie/.test(l.url)) {
    const code = await getStatus(l.url)
    if (code === 404 || code === 410) { soldNew.push({ ...toSold(l), status: 'removed' }); return }
    let page = ''
    try { page = await get(l.url) } catch { nextListings.push(l); return }
    const title = /<title>([^<]*)/.exec(page)?.[1] || ''
    if (/^Sold/i.test(title.trim())) soldNew.push({ ...toSold(l), status: 'sold' })
    else if (/^Sale Agreed/i.test(title.trim())) soldNew.push({ ...toSold(l), status: 'sale_agreed' })
    else if (!/€\s?[\d,]+/.test(title)) soldNew.push({ ...toSold(l), status: 'removed' })
    else nextListings.push(l)
  } else if (/s1homes\.com/.test(l.url)) {
    // s1homes soft-404s (/property/<bad-id> still answers 200): the /view/
    // page is server-rendered and puts the ADDRESS in og:title for live
    // listings, a generic "s1homes | Property" for dead ones.
    let page = ''
    try { page = await get(`https://www.s1homes.com/property-for-sale/view/${l.url.split('/').pop()}`) } catch { nextListings.push(l); return }
    if (/property="og:title" content="s1homes \|/.test(page)) soldNew.push({ ...toSold(l), status: 'removed' })
    else nextListings.push(l)
  } else if (/onthemarket\.com/.test(l.url)) {
    // OnTheMarket hard-404s dead listings; live pages carry priceRaw in
    // their __NEXT_DATA__ blob.
    const code = await getStatus(l.url)
    if (code === 404 || code === 410) { soldNew.push({ ...toSold(l), status: 'removed' }); return }
    let page = ''
    try { page = await get(l.url) } catch { nextListings.push(l); return }
    if (/no longer (available|on the market)|has been removed/i.test(page) || !page.includes('"priceRaw"'))
      soldNew.push({ ...toSold(l), status: 'removed' })
    else nextListings.push(l)
  } else {
    let page = ''
    try { page = await get(l.url) } catch { nextListings.push(l); return }
    const gone = /this property has been removed|no longer (available|on the market)/i.test(page) ||
      (!page.includes('"keyFeatures"') && !/£[\d,]+/.test(page.slice(0, 60000)))
    if (gone) soldNew.push({ ...toSold(l), status: 'removed' })
    else nextListings.push(l)
  }
}, 8)
function toSold(l) {
  return {
    title: l.title, zone: l.zone, town: l.town, addr: l.addr, price: l.price, currency: l.currency,
    lat: l.lat, lng: l.lng, imgs: l.imgs.slice(0, 1), rooms: l.rooms, firstSeen: l.date, removed: TODAY, url: l.url,
  }
}
events.vendute = soldNew

// A relisting of a house we already carry (same address+price under a new
// url) must not come back as 'new': prefer the carried listing.
const keyOf = (l) => l.addr.toLowerCase().replace(/plot \d+/g, '').replace(/[^a-z0-9]/g, '').slice(0, 40) + '|' + l.price
const carriedKeys = new Set(nextListings.filter((l) => prevByUrl.has(l.url)).map(keyOf))
const isRelist = (l) => !prevByUrl.has(l.url) && carriedKeys.has(keyOf(l))
for (let i = nextListings.length - 1; i >= 0; i--) if (isRelist(nextListings[i])) nextListings.splice(i, 1)
events.nuove = events.nuove.filter((l) => !isRelist(l))

const changed = events.nuove.length || events.ribassi.length || events.rialzi.length || events.vendute.length
if (!changed) {
  out('status', 'none')
  out('summary', 'nessuna novità: dati identici')
  process.exit(0)
}

// ---- Assemble and write ----
let maxId = Math.max(0, ...db.listings.map((l) => l.id))
for (const l of nextListings) if (!l.id) l.id = ++maxId
const zoneSet = new Set([...db.zones])
for (const l of nextListings) if (!zoneSet.has(l.zone)) { db.zones.push(l.zone); zoneSet.add(l.zone) }
// Indicative GBP→EUR rate for the price display (ECB via frankfurter.app).
try {
  const fx = JSON.parse(await get('https://api.frankfurter.dev/v1/latest?base=GBP&symbols=EUR'))
  if (fx?.rates?.EUR > 0.5 && fx.rates.EUR < 3) db.gbpEur = +fx.rates.EUR.toFixed(4)
} catch { /* keep previous rate */ }
db.updated = TODAY
db.listings = nextListings
db.sold = [...soldNew, ...db.sold].slice(0, 150)
writeFileSync(dataPath, JSON.stringify(db))

const fmtP = (l) => `${l.currency === 'EUR' ? '€' : '£'}${l.price.toLocaleString('en-GB')}`
const lines = [
  `# Refresh ${TODAY}`,
  ...events.nuove.map((l) => `- 🏠 NUOVA: ${l.addr} — ${fmtP(l)} (${l.zone})`),
  ...events.ribassi.map((l) => `- 📉 RIBASSO: ${l.addr} — ${fmtP({ ...l, price: l.oldPrice })} → ${fmtP(l)}`),
  ...events.rialzi.map((l) => `- 📈 RIALZO: ${l.addr} — ${fmtP({ ...l, price: l.oldPrice })} → ${fmtP(l)}`),
  ...events.vendute.map((s) => `- 🔴 ${s.status.toUpperCase()}: ${s.addr} — ${fmtP(s)}`),
]
writeFileSync(ROOT + 'refresh-report.md', lines.join('\n') + '\n')
out('status', 'changed')
out('summary', `${events.nuove.length} nuove, ${events.ribassi.length + events.rialzi.length} variazioni di prezzo, ${events.vendute.length} vendute/ritirate · ${db.listings.length} annunci totali`)
