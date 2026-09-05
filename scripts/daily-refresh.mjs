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
// JSON POST (ESPC's search endpoints); rejects on transport errors, resolves
// null on non-JSON so a callers' `?.` chain just sees an empty answer.
const post = (url, body) => new Promise((resolve, reject) =>
  execFile('curl', ['-sf', '--max-time', '25', '-A', UA, '-H', 'Content-Type: application/json', '-H', 'Accept: application/json', '-X', 'POST', url, '--data', JSON.stringify(body)], { maxBuffer: 64e6 },
    (e, so) => { if (e) return reject(new Error(`curl ${url}`)); try { resolve(JSON.parse(so.toString())) } catch { resolve(null) } }))
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

// Geo waterfront check: OSM coastline/beach within ~80m of the point. Ads
// for a house facing the harbour wall often never say "beachfront" — the
// map does. Best-effort: any Overpass failure just means no tag today.
const nearCoast = async (la, ln) => {
  const q = `[out:json][timeout:8];(way(around:80,${la},${ln})["natural"="coastline"];way(around:80,${la},${ln})["natural"="beach"];node(around:80,${la},${ln})["natural"="beach"];);out 1;`
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const j = await new Promise((resolve, reject) =>
        execFile('curl', ['-sf', '--max-time', '12', '-A', 'casatrova-agent/1.0', ep, '--data-urlencode', `data=${q}`], { maxBuffer: 4e6 },
          (e, so) => (e ? reject(e) : resolve(JSON.parse(so.toString())))))
      return (j.elements || []).length > 0
    } catch { /* try next mirror */ }
  }
  return false
}

const validCoords = (la, ln) => typeof la === 'number' && typeof ln === 'number' &&
  la >= 49.5 && la <= 61.2 && ln >= -11.5 && ln <= 1.9 && la !== 0 && ln !== 0

// ---- Full-text enrichment (same rules as the instant handler) ----
const SEA = [
  /\b(sea|ocean|coastal|atlantic|estuary|harbour|water|loch|lough|firth|island)\b[^.]{0,40}\bviews?\b/i,
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
// Smallholding signals behind the 🌱 Coltivabile macro-filter: land you can
// work, buildings you can work in, cover you can grow under, water you can
// draw. Separate tags so each stays individually filterable. "barn" excludes
// "barn conversion" (that's the house, not an outbuilding); water needs the
// feature ON the property, not the Burnside up the road.
const FARM = {
  Terreno: /\b\d+(?:\.\d+)?\s*acres?\b|\bpaddocks?\b|\bsmallholdings?\b|\bcrofts?\b|\bgrazing\b|\bacreage\b/i,
  Annessi: /\bout-?houses?\b|\bout-?buildings?\b|\bsteadings?\b|\bbyres?\b|\bbarns?\b(?!\s+conversion)|\bstables?\b|\bbothy\b|\bworkshops?\b/i,
  Serra: /\bpoly-?tunnels?\b|\bgreen-?houses?\b|\bglass-?houses?\b/i,
  Acqua: /\bbore-?holes?\b|private water supply|\bwell water\b|\bnatural spring\b|(?:burn|stream|river)\s+(?:runs|running|borders?|bordering|frontage|boundary)|with (?:a |its own )?(?:burn|stream)\b/i,
}
const featsOf = (text) => {
  const f = []
  if (/\bgarages?\b/i.test(text)) f.push('Garage')
  if (GARDEN.some((r) => r.test(text))) f.push('Giardino')
  if (BEACH.some((r) => r.test(text))) f.push('Spiaggia')
  for (const [tag, re] of Object.entries(FARM)) if (re.test(text)) f.push(tag)
  if (/in need of (some )?(modernisation|renovation|refurbishment|upgrading|updating)|requir(es|ing) renovation|renovation project|fixer-upper|scope for (modernisation|improvement|renovation)/i.test(text)) f.push('Da ammodernare')
  // Portal listings sold via auction (FPA relists on OnTheMarket, agents
  // use "for sale by auction"): the guide price is a teaser, so the Asta
  // tag matters for medians and deals, not just for the badge.
  if (/\bby (?:public |online |timed )?auction\b|auction (?:date|closes|closing|bidding|guide)|\bgoing to auction\b/i.test(text)) f.push('Asta')
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
    ['497', 'Eyemouth', /Eyemouth|Coldingham/i], ['45', 'Arbroath', /Arbroath|Auchmithie|Inverkeilor/i], ['952', 'Montrose', /Montrose|St ?Cyrus|Johnshaven/i],
    ['621', 'Helensburgh', /Helensburgh/i], ['17291', 'Millport', /Millport|Cumbrae/i],
    ['1421', 'Wemyss Bay', /Wemyss Bay|Skelmorlie/i], ['287', 'Carnoustie', /Carnoustie|Easthaven|East Haven/i],
  ],
}
const MH_BURTONPORT = {
  // cap 30 was saturated by 2026-09: every new Rosses listing got dropped.
  zone: 'Burtonport (Donegal, IE)', county: 'donegal', cap: 60,
  towns: ['burtonport', 'dungloe', 'kincasslagh', 'annagry', 'gweedore', 'falcarragh'],
}

// ---- Scrapers (search results only; detail pages fetched for NEW urls) ----
const rmSearch = async (code, index) => {
  let html
  try {
    // sortType=6 = newest first: the default sort buries fresh listings
    // beyond the two pages we fetch, and a daily differ needs the newest.
    html = await get(`https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=REGION%5E${code}&searchType=SALE&numberOfPropertiesPerPage=24&index=${index}&sortType=6`)
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
  if (/land|plot|site|garage|parking|private hall|block of/.test(sub)) return null
  if (!p.price?.amount || !validCoords(p.location?.latitude, p.location?.longitude)) return null
  return {
    id: 0, title: p.displayAddress, contract: 'sale',
    type: /bungalow/.test(sub) ? 'Bungalow' : /flat|apartment/.test(sub) ? 'Appartamento' : /cottage/.test(sub) ? 'Cottage' : 'Casa indipendente',
    price: p.price.amount, currency: 'GBP',
    size: null, rooms: p.bedrooms ?? null, baths: p.bathrooms || null, floor: null, year: null, energy: null,
    zone, town, addr: p.displayAddress, lat: p.location.latitude, lng: p.location.longitude,
    imgs: (p.propertyImages?.images || []).slice(0, 6).map((im) => (im.srcUrl || '').replace('media.rightmove.co.uk:443', 'media.rightmove.co.uk')).filter(Boolean),
    // The ad's REAL publication date (search results expose it): a listing
    // recovered weeks late must not show up as "added today".
    feats: [], seaView: false, desc: '',
    date: ((d) => (/^20\d{2}-\d{2}-\d{2}/.test(d) && d.slice(0, 10) < TODAY ? d.slice(0, 10) : TODAY))(p.firstVisibleDate || ''),
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
    // The search JSON stops at 6 photos; the detail page carries them all.
    const gal = [...new Set([...page.matchAll(/https:\/\/media\.rightmove\.co\.uk\/property-photo\/[\w/]+\.jpe?g/g)].map((x) => x[0]))].slice(0, 40)
    if (gal.length >= l.imgs.length) l.imgs = gal
    const sqm = +((/info-reel-SIZE-text"><p[^>]*>[^<]*<\/p><p[^>]*>([\d,]+)\s*sq m/.exec(page)?.[1] || '').replace(/,/g, ''))
    if (sqm > 15 && sqm < 2000) l.size = sqm
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
  const text = page.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  // Not every brochure carries the NumberOfBeds JSON — fall back to the
  // visible "3 beds 1 bath" strapline.
  const bedsRaw = +(/"NumberOfBeds":(\d+)/.exec(page)?.[1] || /\b(\d{1,2})\s*beds?\b/i.exec(text)?.[1] || 0)
  const beds = bedsRaw >= 1 && bedsRaw <= 12 ? bedsRaw : null
  const bathsRaw = +(/"NumberOfBathrooms":(\d+)/.exec(page)?.[1] || /\b(\d{1,2})\s*baths?\b/i.exec(text)?.[1] || 0)
  const baths = bathsRaw >= 1 && bathsRaw <= 10 ? bathsRaw : null
  const imgs = [...new Set([...page.matchAll(/https:\/\/photos-a\.propertyimages\.ie\/media\/[^"'\\]+_l\.jpg/g)].map((x) => x[0]))].slice(0, 40)
  const h1 = /<h1[^>]*>\s*([^<]+)/.exec(page)?.[1]?.trim()
  const addrTxt = h1 || (title.split('|')[1] || title).split(/ [-–] /)[0].trim() || town
  return {
    id: 0, title: addrTxt, type: 'Casa indipendente', contract: 'sale', price, currency: 'EUR',
    size: null, rooms: beds, baths, floor: null, year: null, energy: null,
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
const normAddr = (a) => a.toLowerCase().replace(/plot \d+/g, '').replace(/[^a-z0-9]/g, '')
// Same house cross-listed on another portal: same price within ~150m. A real
// distance check — string keys on rounded coords miss pairs falling across a
// rounding-cell boundary. Deliberately NOT matching different prices at the
// same address: those can be distinct units of one building (e.g. three
// separate flats at "8 Murray Park" at three prices), which must all stay.
const nearPt = (p, l) => p.price === l.price &&
  Math.abs(p.lat - l.lat) < 0.0015 && Math.abs(p.lng - l.lng) < 0.003
const dedupKeys = new Set()
const placed = []
const addCapped = (items, cap) => {
  let n = 0
  for (const l of items) {
    if (!l || n >= cap) continue
    if (scraped.has(l.url)) continue
    const k = normAddr(l.addr).slice(0, 40) + '|' + l.price
    if (dedupKeys.has(k) || placed.some((p) => nearPt(p, l))) continue
    dedupKeys.add(k)
    placed.push({ price: l.price, lat: l.lat, lng: l.lng })
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
const s1Candidate = (o, ztOverride) => {
  if (o.channel && o.channel.key !== 'sales') return null
  const la = parseFloat(o.latitude), ln = parseFloat(o.longitude)
  if (!o.price || !validCoords(la, ln)) return null
  const ptype = (o.propertyType?.name || '').toLowerCase()
  if (/land|plot|site|garage|parking/.test(ptype)) return null
  const addr = [o.houseNameNumber, o.address2, o.address3, o.town, o.postcode].filter(Boolean).join(', ')
  const zt = ztOverride || zoneOf(addr)
  if (!zt) return null
  const featStr = (o.features || []).join(' ')
  const text = `${o.summary || ''} ${o.description || ''}`.replace(/<[^>]+>/g, ' ')
  return {
    id: 0, title: addr, contract: 'sale',
    type: /bungalow/.test(ptype) ? 'Bungalow' : /flat|apartment|maisonette/.test(ptype) ? 'Appartamento' : /cottage/.test(ptype) ? 'Cottage' : 'Casa indipendente',
    price: o.price, currency: 'GBP',
    size: null, rooms: ((n) => (n >= 1 && n <= 12 ? n : null))(+(/([0-9]+)\s*bedroom/.exec(featStr)?.[1] || 0)),
    baths: ((n) => (n >= 1 && n <= 10 ? n : null))(+(/([0-9]+)\s*bathroom/.exec(featStr)?.[1] || 0)),
    floor: null, year: null, energy: null,
    zone: zt.zone, town: zt.town, addr, lat: la, lng: ln,
    imgs: (o.media || []).slice(0, 6).map((m) => m.metadata?.src?.url).filter((u) => u && u.startsWith('https://cdn.s1homes.com/')),
    // s1homes property ids start with the listing datetime (YYYYMMDD…).
    feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '',
    date: ((m) => (m && `${m[1]}-${m[2]}-${m[3]}` < TODAY && +m[2] <= 12 && +m[3] <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : TODAY))(/^(20\d{2})(\d{2})(\d{2})/.exec(String(o.propertyId || ''))),
    url: `https://www.s1homes.com/property/${o.propertyId}`,
  }
}
{
  const pages = await pmap(S1_PATHS, (path) => get(`https://www.s1homes.com/property-for-sale/${path}/`).catch(() => ''), 6)
  const cands = pages.flatMap((h) => s1Parse(h)).map((o) => s1Candidate(o)).filter(Boolean)
  const byZone = {}
  for (const l of cands) (byZone[l.zone] = byZone[l.zone] || []).push(l)
  for (const [z, arr] of Object.entries(byZone)) { addCapped(arr, 12); console.log(`s1homes → ${z}: ${arr.length} candidati`) }
}

// ---- ESPC: the Edinburgh Solicitors Property Centre — East Lothian, East
// Fife, Perthshire and Argyll listings marketed by solicitor-estate agents,
// a good share of which never reach Rightmove. The site is a JSON API in
// disguise: POST /locations/autocomplete resolves a town to its key, POST
// /properties/search/list returns full result objects (price, beds, baths,
// type, 40 photos, blurb). Coordinates and the full description live on the
// detail page, fetched only for urls new to the portal.
const ESPC_TOWNS = [
  'North Berwick', 'Gullane', 'Dirleton', 'Aberlady', 'Dunbar',
  'Anstruther', 'Crail', 'Pittenweem', 'Elie', 'St Monans', 'Cellardyke', 'St Andrews', 'Leuchars',
  'Rosemarkie', 'Fortrose', 'Avoch', 'Nairn',
  'Aberfeldy', 'Kenmore', 'Killin',
  'Oban', 'Dunoon', 'Tarbert', 'Largs', 'Helensburgh', 'Rothesay', 'Stonehaven', 'Eyemouth', 'Kirkcudbright',
]
const espcKey = async (town) => {
  try {
    const a = await post('https://espc.com/locations/autocomplete', { query: town, size: 5, pastsales: false })
    // Town-level keys have two segments ("east-lothian/north-berwick");
    // streets have three. First town-level hit whose name starts with the query.
    const hit = (Array.isArray(a) ? a : []).find((x) => x.key && x.key.split('/').length <= 2 &&
      (x.displayText || '').toLowerCase().startsWith(town.toLowerCase().replace(/^st /, 'st')))
      || (Array.isArray(a) ? a : []).find((x) => x.key && x.key.split('/').length <= 2)
    return hit ? { displayText: hit.displayText, key: hit.key, category: hit.category || 0 } : null
  } catch { return null }
}
const espcSearch = async (loc) => {
  const all = []
  for (let p = 1; p <= 4; p++) {
    let j
    try {
      j = await post('https://espc.com/properties/search/list', {
        locations: [loc], radiuses: [], school: null, view: null, p, ps: 50, sortBy: null, rental: false,
        maxPrice: null, minPrice: null, minBeds: null, underOffer: false, new: null, fixedPrice: false,
      })
    } catch { break }
    const rs = j?.results || []
    all.push(...rs)
    if (all.length >= (j?.totalResults || 0) || rs.length < 50) break
  }
  return all
}
const espcCandidate = async (r) => {
  if (!r || !r.url || !r.priceRaw || r.priceRaw < 20000) return null
  if (/rent|pcm|per month/i.test(r.offerType || '') || /rent/i.test(r.priceDescription || '')) return null
  const ptype = (r.propertyType || '').toLowerCase()
  if (/land|plot|site|garage|parking|commercial/.test(ptype)) return null
  const url = 'https://espc.com' + r.url.replace(/[?#].*$/, '')
  const addr = String(r.address || '').replace(/\s*\r?\n\s*/g, ', ').replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim()
  const zt = zoneOf(addr)
  if (!zt) return null
  const prev = prevByUrl.get(url)
  let la = prev?.lat, ln = prev?.lng
  let text = `${r.summary || ''} ${r.description || ''}`
  if (!validCoords(la, ln)) {
    // New to the portal: the detail page carries the coordinates and the
    // full blurb (search results truncate it).
    let page = ''
    try { page = await get(url) } catch { return null }
    la = parseFloat(/"latitude":"?(-?[\d.]+)/.exec(page)?.[1])
    ln = parseFloat(/"longitude":"?(-?[\d.]+)/.exec(page)?.[1])
    if (!validCoords(la, ln)) return null
    text = page.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
  }
  const imgs = (r.propertyImages || []).filter((u) => typeof u === 'string' && u.startsWith('https://espc.com/images?')).slice(0, 40)
  return {
    id: 0, title: addr, contract: 'sale',
    type: /bungalow/.test(ptype) ? 'Bungalow' : /flat|apartment|maisonette/.test(ptype) ? 'Appartamento' : /cottage/.test(ptype) ? 'Cottage' : 'Casa indipendente',
    price: +r.priceRaw, currency: 'GBP',
    size: null, rooms: r.bedrooms >= 1 && r.bedrooms <= 12 ? r.bedrooms : null,
    baths: r.bathrooms >= 1 && r.bathrooms <= 10 ? r.bathrooms : null,
    floor: null, year: null, energy: null,
    zone: zt.zone, town: zt.town, addr, lat: la, lng: ln, imgs,
    feats: featsOf(text), seaView: SEA.some((x) => x.test(text)), desc: '',
    date: prev?.date || TODAY, url,
  }
}
{
  const keys = (await pmap(ESPC_TOWNS, espcKey, 4)).filter(Boolean)
  const seenKeys = new Set()
  const locs = keys.filter((k) => !seenKeys.has(k.key) && seenKeys.add(k.key))
  const results = (await pmap(locs, espcSearch, 3)).flat()
  const byId = new Map()
  for (const r of results) if (r?.id && !byId.has(r.id)) byId.set(r.id, r)
  const cands = (await pmap([...byId.values()], espcCandidate, 6)).filter(Boolean)
  const byZone = {}
  for (const l of cands) (byZone[l.zone] = byZone[l.zone] || []).push(l)
  for (const [z, arr] of Object.entries(byZone)) { addCapped(arr, 25); console.log(`espc → ${z}: ${arr.length} candidati`) }
  console.log(`espc: ${locs.length} località, ${byId.size} risultati, ${cands.length} candidati`)
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
const otmCandidate = (o, ztOverride) => {
  const price = +String(o.price || '').replace(/[^0-9]/g, '')
  const la = o.location?.lat, ln = o.location?.lon
  if (!price || !validCoords(la, ln)) return null
  const ptype = (o['humanised-property-type'] || '').toLowerCase()
  if (/land|plot|site|garage|parking|mooring/.test(ptype)) return null
  const addr = o.address || ''
  const zt = ztOverride || zoneOf(addr)
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
    const big = (p.images || []).filter((im) => im.isImage && im.largeUrl?.startsWith('https://media.onthemarket.com/')).slice(0, 40).map((im) => im.largeUrl)
    if (big.length) l.imgs = big
    // OTM only reveals coarse age buckets — better an estimated backdate
    // than an old ad masquerading as "added today".
    const ds = String(p.daysSinceAddedReduced || '')
    const back = (n) => new Date(new Date(TODAY) - n * 864e5).toISOString().slice(0, 10)
    if (/>\s*14/.test(ds)) l.date = back(15)
    else if (/<\s*14/.test(ds)) l.date = back(8)
  } catch { /* enrich is best-effort */ }
  return l
}
{
  const pages = await pmap(OTM_TOWNS, (t) => get(`https://www.onthemarket.com/for-sale/property/${t}/`).catch(() => ''), 6)
  const cands = pages.flatMap((h) => otmNext(h)?.results?.list || []).map((o) => otmCandidate(o)).filter(Boolean)
  const byZone = {}
  for (const l of cands) (byZone[l.zone] = byZone[l.zone] || []).push(l)
  for (const [z, arr] of Object.entries(byZone)) { addCapped(arr, 12); console.log(`onthemarket → ${z}: ${arr.length} candidati`) }
}

// ---- TSPC (Tayside solicitors' portal): RETIRED 2026-09 — the site answers
// 403 to every scripted request since mid-August (search and listings alike),
// so its listings could neither refresh nor be verified. Rightmove already
// covers Arbroath, Carnoustie and Montrose. Carried TSPC urls are dropped
// below (not archived as sold: their fate is unknown).
const RETIRED = /tspc\.co\.uk/
// ---- Case all'asta (Scozia): Future Property Auctions + Auction House.
// Guide/opening bids are teaser prices, not market prices: auction lots
// carry the 'Asta' feat and an `auction` date, are EXCLUDED from zone
// medians and the deals analysis, and archive themselves once the auction
// date has passed. Coordinates come from the postcode (postcodes.io).
const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' }
const isoDate = (txt) => {
  // Month may be abbreviated ("27 Aug 2026") — match by 3-letter prefix.
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Z][a-z]{2,8})\s+(20\d\d)/.exec(txt || '')
  const mk = m && Object.keys(MONTHS).find((k) => k.startsWith(m[2].toLowerCase().slice(0, 3)))
  if (!mk) return null
  return `${m[3]}-${MONTHS[mk]}-${String(+m[1]).padStart(2, '0')}`
}
const pcGeo = async (pc) => {
  try {
    const j = JSON.parse(await get(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc.replace(/\s+/g, ''))}`))
    return j.result && validCoords(j.result.latitude, j.result.longitude) ? [j.result.latitude, j.result.longitude] : null
  } catch { return null }
}
const POUND = '(?:£|�|&pound;)'
const typeOfTitle = (t) => /bungalow/i.test(t) ? 'Bungalow' : /flat|apartment|maisonette/i.test(t) ? 'Appartamento' : /cottage/i.test(t) ? 'Cottage' : 'Casa indipendente'
// Auction feeds span ALL of Scotland, so the loose town regexes misfire:
// "24 Montrose Place" in Selkirk, "East Dunbartonshire" ⊃ Dunbar,
// "Ayrshire" ⊃ Ayr. Match only the address tail (street segment stripped)
// and require a word boundary after every town alternative. Lots that are
// not single homes (portfolios, tenanted investments) are skipped.
const AUC_SKIP = /land|site|garage|plot|commercial|shop|office|portfolio|tenanted|investment/i
const zoneOfAuction = (addr) => {
  const tail = addr.includes(',') ? addr.split(',').slice(1).join(',') : addr
  const rb = (re) => new RegExp('(?:' + re.source.split('|').map((s) => s + '\\b').join('|') + ')', 'i')
  for (const z of RM_ZONES) if (rb(z.filter).test(tail)) return { zone: z.zone, town: z.town }
  for (const [, town, filter] of COSTA.towns) if (rb(filter).test(tail)) return { zone: COSTA.zone, town }
  return null
}
const aucAll = []
{
  const aucCands = []
  // Future Property Auctions — the catalogue is PAGINATED (~500 lots in
  // pages of 39, offset=0,39,78,…): walk every page or Fife lots on page 5
  // never surface. Cards carry the full address in `listing-address` (the
  // <h4> title is just "4 Bedroom House") and exact coordinates in their
  // Google Maps link, so no geocoding round-trip is needed.
  try {
    for (let off = 0; off < 1600; off += 39) {
      let html
      // One flaky page must not abort the remaining ~17 catalogue pages.
      try { html = await get(`https://www.futurepropertyauctions.co.uk/catalogue_viewall.asp${off ? `?offset=${off}` : ''}`) } catch { continue }
      const cards = html.split('class="listing-badges"').slice(1)
      if (!cards.length) break
      for (const c of cards) {
        const chunk = c.slice(0, 6000)
        const title = (/<h4><a[^>]*>([^<]+)/.exec(chunk) || [])[1]
        if (!title) continue
        const addr = ((/listing-address[^>]*>[\s\S]*?<\/i>\s*([^<]+)/.exec(chunk) || [])[1] || '')
          .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
        if (AUC_SKIP.test(title + ' ' + addr)) continue
        const zt = zoneOfAuction(addr)
        if (!zt) continue
        const bid = +((new RegExp(POUND + '\\s?([\\d,]+)').exec(chunk) || [])[1] || '').replace(/,/g, '')
        const did = (/property_details\.asp\?id=(\d+)/.exec(chunk) || [])[1]
        if (!bid || bid < 10000 || !did) continue
        const gm = /maps\?[^"]*q=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(chunk)
        let geo = gm && validCoords(+gm[1], +gm[2]) ? [+gm[1], +gm[2]] : null
        let page = ''
        try { page = await get(`https://www.futurepropertyauctions.co.uk/property_details.asp?id=${did}`) } catch { /* card data may suffice */ }
        if (!geo) {
          const pc = (/[A-Z]{1,2}\d{1,2}[A-Z]? \d[A-Z]{2}/.exec(addr + ' ' + page) || [])[0]
          geo = pc ? await pcGeo(pc) : null
        }
        if (!geo) continue
        const beds = +((/(\d+)\s*Bed/i.exec(title + ' ' + page) || [])[1] || 0) || null
        const auction = isoDate(chunk.replace(/&nbsp;/g, ' ')) || isoDate(page)
        const imgs = [...new Set([...page.matchAll(/https?:\/\/www\.futurepropertyauctions\.co\.uk\/upload\/[\w]+\.jpg/gi)].map((x) => x[0].replace('http://', 'https://')))].slice(0, 30)
        // The lot description carries the same garden/sea-view/renovation
        // signals as any portal listing — feed it through the same rules.
        const dtxt = (page.split('property-description')[1] || '')
          .split(/Register to Bid|Arrange a Viewing|Similar Properties|Auction Finance|Request More/i)[0]
          .slice(0, 9000).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
        aucCands.push({
          id: 0, title: addr || title.trim(), contract: 'sale', type: typeOfTitle(title),
          price: bid, currency: 'GBP', size: null, rooms: beds, baths: null, floor: null, year: null, energy: null,
          zone: zt.zone, town: zt.town, addr: addr || title.trim(), lat: geo[0], lng: geo[1], imgs,
          feats: [...new Set(['Asta', ...featsOf(dtxt)])], seaView: SEA.some((r) => r.test(dtxt)), desc: '', date: TODAY, auction,
          url: `https://www.futurepropertyauctions.co.uk/property_details.asp?id=${did}`,
        })
      }
    }
  } catch { /* auction source is best-effort */ }
  // Auction House Scotland — network listing page.
  try {
    const html = await get('https://www.auctionhouse.co.uk/scotland')
    // One card = one href→sticker→Guide→address run. Parse PER SEGMENT
    // (split on the lot href): a card without "Guide |" (Guide Coming
    // Soon) must be skipped, not paired with the next card's data — that
    // exact slide once attached an Aberdeen address to a Greenock lot.
    for (const seg of html.split('href="/scotland/auction/lot/').slice(1)) {
      const lotId = (/^(\d+)"/.exec(seg) || [])[1]
      const m = /image-sticker[^>]*>\s*Lot\s*\d+[\s\S]{0,800}?Guide \| (?:£|�|&pound;)([\d,]+)[\s\S]{0,500}?blue-text">([^<]+)<\/p>\s*<p[^>]*grid-address">([^<]+)/.exec(seg.slice(0, 3500))
      if (!lotId || !m) continue
      const path = `/scotland/auction/lot/${lotId}`
      const [, guide, bedsType, addr] = m
      if (AUC_SKIP.test(bedsType + ' ' + addr)) continue
      const zt = zoneOfAuction(addr)
      if (!zt) continue
      const bid = +guide.replace(/,/g, '')
      if (!bid || bid < 10000) continue
      const pc = (/[A-Z]{1,2}\d{1,2}[A-Z]? \d[A-Z]{2}/.exec(addr) || [])[0]
      const geo = pc ? await pcGeo(pc) : null
      if (!geo) continue
      const url2 = `https://www.auctionhouse.co.uk${path}`
      let auction = null, imgs = [], dtxt = ''
      try {
        const det = await get(url2)
        auction = isoDate(det)
        imgs = [...new Set([...det.matchAll(/\/lot-image\/\d+/g)].map((x) => 'https://www.auctionhouse.co.uk' + x[0]))].slice(0, 30)
        dtxt = det.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
      } catch { /* keep card data */ }
      aucCands.push({
        id: 0, title: addr.trim(), contract: 'sale', type: typeOfTitle(bedsType),
        price: bid, currency: 'GBP', size: null, rooms: +((/(\d+)\s*Bed/i.exec(bedsType) || [])[1] || 0) || null,
        baths: null, floor: null, year: null, energy: null,
        zone: zt.zone, town: zt.town, addr: addr.trim(), lat: geo[0], lng: geo[1], imgs,
        feats: [...new Set(['Asta', ...featsOf(dtxt)])], seaView: SEA.some((r) => r.test(dtxt)), desc: '', date: TODAY, auction,
        url: url2,
      })
    }
  } catch { /* auction source is best-effort */ }
  // Prime Property Auctions (Glasgow) — WordPress SSR: detail pages embed a
  // JSON blob with cleaned_address, exact coordinates, guide price, beds,
  // baths and the gallery. Lots sell "offer now" style, so an auction date
  // only exists when the blurb announces a closing/bidding date.
  try {
    const html = await get('https://primepropertyauctions.co.uk/properties/')
    const slugs = [...new Set([...html.matchAll(/href="\/property\/([^"/]+)\//g)].map((m) => m[1]))]
    for (const slug of slugs) {
      let page = ''
      try { page = await get(`https://primepropertyauctions.co.uk/property/${slug}/`) } catch { continue }
      const addr = (/cleaned_address:"([^"]+)"/.exec(page) || [])[1]
      if (!addr || AUC_SKIP.test(slug + ' ' + addr)) continue
      const zt = zoneOfAuction(addr)
      if (!zt) continue
      const lat = +((/latitude:(-?\d+\.\d+)/.exec(page) || [])[1])
      const lng = +((/longitude:(-?\d+\.\d+)/.exec(page) || [])[1])
      const price = +((/(?:^|[^a-zA-Z])price:(\d+)/.exec(page) || [])[1] || 0)
      if (!price || price < 10000 || !validCoords(lat, lng)) continue
      const auctionCtx = (/(?:auction|closing|bidding)[^.]{0,80}?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]{2,8}\s+20\d\d)/i.exec(page) || [])[1]
      // The gallery repeats each photo in several crop sizes: keep the
      // standard 1024px variant only (falling back to whatever exists).
      const rawImgs = [...new Set([...page.matchAll(/https:\/\/primepropertyauctions\.flywheelsites\.com\/wp-content\/uploads\/[^"',\s\\]+\.(?:jpe?g|png|webp)/gi)].map((x) => x[0]))]
        .filter((u) => !/logo|floorplan|scaled|Report/i.test(u))
      const hd = rawImgs.filter((u) => /-1024x/.test(u))
      const imgs = (hd.length ? hd : rawImgs).slice(0, 30)
      const dtxt = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
      aucCands.push({
        id: 0, title: addr, contract: 'sale',
        type: /flat|apartment/i.test(page.slice(0, 40000)) && /propertyType:"flat"/.test(page) ? 'Appartamento' : typeOfTitle(slug.replace(/-/g, ' ')),
        price, currency: 'GBP', size: null,
        rooms: +((/numberOfBedrooms:(\d+)/.exec(page) || [])[1] || 0) || null,
        baths: +((/numberOfBathroomsTotal:(\d+)/.exec(page) || [])[1] || 0) || null,
        floor: null, year: null, energy: null,
        zone: zt.zone, town: zt.town, addr, lat, lng, imgs,
        feats: [...new Set(['Asta', ...featsOf(dtxt)])], seaView: SEA.some((r) => r.test(dtxt)), desc: '', date: TODAY, auction: auctionCtx ? isoDate(auctionCtx) : null,
        url: `https://primepropertyauctions.co.uk/property/${slug}/`,
      })
    }
  } catch { /* auction source is best-effort */ }
  const byZone = {}
  for (const l of aucCands) (byZone[l.zone] = byZone[l.zone] || []).push(l)
  // Auctions churn in weeks, not months: a low daily cap would drip-feed a
  // catalogue that is already capped by the zone filter itself.
  for (const [z, arr] of Object.entries(byZone)) { addCapped(arr, 30); console.log(`aste → ${z}: ${arr.length} lotti`) }
  aucAll.push(...aucCands)
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
    // The instant handler records which OnTheMarket slugs / s1homes towns
    // answered for this area, so every source keeps refreshing the zone.
    if (z.otmSlugs?.length) {
      const p2 = await pmap(z.otmSlugs, (t) => get(`https://www.onthemarket.com/for-sale/property/${t}/`).catch(() => ''), 4)
      const c2 = p2.flatMap((h) => otmNext(h)?.results?.list || []).map((o) => otmCandidate(o, { zone: z.zone, town: townName })).filter((l) => l && inb(l.lat, l.lng))
      addCapped(c2, z.cap || 20)
      console.log(`onthemarket → ${z.zone}: ${c2.length} candidati`)
    }
    if (z.s1Towns?.length) {
      // s1homes ignores the region segment of the search path, so a fixed
      // placeholder works for any town.
      const p3 = await pmap(z.s1Towns, (t) => get(`https://www.s1homes.com/property-for-sale/Scotland/${t}/`).catch(() => ''), 4)
      const c3 = p3.flatMap(s1Parse).map((o) => s1Candidate(o, { zone: z.zone, town: townName })).filter((l) => l && inb(l.lat, l.lng))
      addCapped(c3, z.cap || 20)
      console.log(`s1homes → ${z.zone}: ${c3.length} candidati`)
    }
  } else {
    const county = z.searchKeys[0]
    // `countyPages: false` keeps a coastal zone coastal: the county-wide
    // pages (newest 60 in the county) would pull in inland towns.
    const urls2 = [
      ...z.searchKeys.slice(1).map((ts) => `https://www.myhome.ie/residential/${county}/house-for-sale-in-${ts}`),
      ...(z.countyPages === false ? [] : [1, 2, 3].map((pg) => `https://www.myhome.ie/residential/${county}/house-for-sale${pg > 1 ? `?page=${pg}` : ''}`)),
    ]
    const pages = await pmap(urls2, (u) => get(u).catch(() => ''), 4)
    const brochureUrls = [...new Set(pages.flatMap((h) => [...mhBrochures(h)]))].slice(0, z.maxBrochures || 60)
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
  // Keep the RICHER gallery: the search-result candidate only ever carries
  // ~6 photos, while a previously-enriched listing has up to 40 from its
  // detail page. Without the size comparison every refresh downgraded old
  // listings back to 6 photos (enrichment runs on NEW urls only) — the root
  // cause of the recurring "too few images" complaint.
  const merged = { ...old, price: cand.price, imgs: cand.imgs.length > old.imgs.length ? cand.imgs : old.imgs, rooms: cand.rooms ?? old.rooms, baths: cand.baths ?? old.baths }
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
// Waterfront geo-tag for the new listings (text rules already ran).
await pmap(enrichQueue.filter((l) => !l.feats.includes('Spiaggia')), async (l) => {
  if (await nearCoast(l.lat, l.lng)) l.feats.push('Spiaggia')
}, 3)

// Missing urls: verify on the source before archiving; live ones carry over.
const retired = db.listings.filter((l) => RETIRED.test(l.url))
if (retired.length) console.log(`sorgente ritirata: ${retired.length} annunci TSPC rimossi dal portale`)
const missing = db.listings.filter((l) => !scraped.has(l.url) && !RETIRED.test(l.url))
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
  } else if (/espc\.com/.test(l.url)) {
    // ESPC answers 410 Gone for withdrawn/sold listings; a live page
    // carries the "latitude" JSON. Transport errors keep the listing.
    const code = await getStatus(l.url)
    if (code === 404 || code === 410) { soldNew.push({ ...toSold(l), status: 'removed' }); return }
    let page = ''
    try { page = await get(l.url) } catch { nextListings.push(l); return }
    if (!page.includes('"latitude"')) soldNew.push({ ...toSold(l), status: 'removed' })
    else nextListings.push(l)
  } else if (/futurepropertyauctions\.co\.uk|auctionhouse\.co\.uk|primepropertyauctions\.co\.uk/.test(l.url)) {
    // Auction lots: gone from the catalogue means sold or withdrawn; a
    // passed auction date means the auction happened either way.
    if (l.auction && l.auction < TODAY) soldNew.push({ ...toSold(l), status: 'removed' })
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
// url, or the same spot on another portal) must not come back as 'new':
// prefer the carried listing.
const keyOf = (l) => normAddr(l.addr).slice(0, 40) + '|' + l.price
const carried = nextListings.filter((l) => prevByUrl.has(l.url))
const carriedKeys = new Set(carried.map(keyOf))
const carriedPts = carried.map((l) => ({ price: l.price, lat: l.lat, lng: l.lng }))
const isRelist = (l) => !prevByUrl.has(l.url) &&
  (carriedKeys.has(keyOf(l)) || carriedPts.some((p) => nearPt(p, l)))
for (let i = nextListings.length - 1; i >= 0; i--) if (isRelist(nextListings[i])) nextListings.splice(i, 1)
events.nuove = events.nuove.filter((l) => !isRelist(l))

const changed = events.nuove.length || events.ribassi.length || events.rialzi.length || events.vendute.length || retired.length
if (!changed) {
  out('status', 'none')
  out('summary', 'nessuna novità: dati identici')
  process.exit(0)
}

// ---- Assemble and write ----
let maxId = Math.max(0, ...db.listings.map((l) => l.id))
for (const l of nextListings) if (!l.id) l.id = ++maxId
// Auction houses often relist their lots on the portals (FPA → OnTheMarket):
// the portal copy wins the dedupe, so carry the auction nature over to it —
// same guide price at the same address means it IS the auction lot.
for (const l of nextListings) {
  if (l.feats.includes('Asta')) continue
  const k = normAddr(l.addr).slice(0, 40) + '|' + l.price
  const hit = aucAll.find((a) => normAddr(a.addr).slice(0, 40) + '|' + a.price === k ||
    nearPt({ price: l.price, lat: l.lat, lng: l.lng }, a))
  if (hit) { l.feats.push('Asta'); if (hit.auction) l.auction = hit.auction }
}
const zoneSet = new Set([...db.zones])
for (const l of nextListings) if (!zoneSet.has(l.zone)) { db.zones.push(l.zone); zoneSet.add(l.zone) }
for (const f of ['Asta', 'Annessi', 'Serra', 'Acqua']) if (!db.features.includes(f)) db.features.push(f)
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
