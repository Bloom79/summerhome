// Deterministic handler for a "Cerca qui:" issue — run by the cerca-qui
// GitHub Action the moment a request lands, so the portal answers in minutes
// instead of waiting for the daily agent (which remains the fallback and the
// one that keeps the zone fresh afterwards).
//
// Reads ISSUE_BODY from the environment, scrapes the right portal for the
// country (Rightmove for the UK, MyHome.ie for Ireland), and rewrites
// src/data.js + docs/extra-zones.json. Outcome goes to $GITHUB_OUTPUT:
//   status = ok | none | error   added = N   zone = <name>   msg = <detail>
// Exit code is always 0 — the workflow branches on `status`.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'

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
const get = async (url) => {
  const r = spawnSync('curl', ['-sf', '--max-time', '25', '-A', UA, url], { maxBuffer: 64e6 })
  if (r.status !== 0) throw new Error(`curl ${r.status} ${url}`)
  return r.stdout.toString()
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
let geo = null
try {
  geo = JSON.parse(await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&accept-language=en`))
} catch { /* fall back to the coarse box below */ }
const addr = geo?.address || {}
const cc = addr.country_code || (lng < -6.0 && lat < 55.4 ? 'ie' : 'gb')
const town = (place || addr.town || addr.village || addr.city || addr.county || '').trim()
if (!town) finish('error', 'località non identificata')
const scotland = addr.state === 'Scotland' || (cc === 'gb' && lat > 54.6)
const zoneName = `${town} (${cc === 'ie' ? 'Irlanda' : scotland ? 'Scozia' : 'UK'})`

// ---- Existing data ----
const dataPath = ROOT + 'src/data.js'
let data = readFileSync(dataPath, 'utf8')
const existingUrls = new Set([...data.matchAll(/"url": ?"([^"]+)"/g)].map((x) => x[1]))
if (data.includes(JSON.stringify(zoneName)))
  finish('none', `la zona «${zoneName}» è già nel portale`, zoneName)

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
  // ---- MyHome.ie ----
  const slug = (s) => s.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/ +/g, '-')
  const county = slug((addr.county || '').replace(/^County /i, ''))
  if (!county) finish('error', 'contea irlandese non identificata')
  searchKeys = [`${county}/${slug(town)}`]
  let html
  try { html = await get(`https://www.myhome.ie/residential/${county}/house-for-sale-in-${slug(town)}`) }
  catch { finish('error', `ricerca MyHome fallita per ${town}`) }
  const brochures = new Set()
  for (const s of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(s[1])
      const items = j['@type'] === 'ItemList' ? j.itemListElement || [] : []
      for (const it of items) { const u = it.url || it.item?.url; if (u) brochures.add(u) }
    } catch { /* other ld+json blocks */ }
  }
  for (const u of brochures) {
    if (listings.length >= CAP) break
    if (existingUrls.has(u)) continue
    let page
    try { page = await get(u) } catch { continue }
    const title = /<title>([^<]*)/.exec(page)?.[1] || ''
    if (/^(Sold|Sale Agreed)/i.test(title.trim())) continue
    const price = +(/€\s?([\d,]+)/.exec(title)?.[1] || '').replace(/,/g, '')
    const cm = /BrochureMap":\{"longitude":(-?[\d.]+),"latitude":(-?[\d.]+)/.exec(page)
    if (!price || !cm) continue
    const [plng, plat] = [+cm[1], +cm[2]]
    if (!inBox(plat, plng)) continue
    const beds = +(/"NumberOfBeds":(\d+)/.exec(page)?.[1] || 0) || null
    const imgs = [...new Set([...page.matchAll(/https:\/\/photos-a\.propertyimages\.ie\/media\/[^"'\\]+_l\.jpg/g)].map((x) => x[0]))].slice(0, 6)
    const text = page.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
    const addrTxt = title.split(/ [-–] /)[0].replace(/€.*$/, '').trim() || town
    listings.push({
      id: 0, title: addrTxt, type: 'Casa indipendente', contract: 'sale', price, currency: 'EUR',
      size: null, rooms: beds, baths: null, floor: null, year: null, energy: null,
      zone: zoneName, town, addr: addrTxt, lat: plat, lng: plng, imgs,
      feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY, url: u,
    })
  }
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
  const props = []
  for (const index of [0, 24]) {
    let html
    try {
      html = await get(`https://www.rightmove.co.uk/property-for-sale/find.html?locationIdentifier=${encodeURIComponent(loc)}&searchType=SALE&numberOfPropertiesPerPage=24&index=${index}`)
    } catch { continue }
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
  for (const p of props) {
    if (listings.length >= CAP) break
    if (p.transactionType && p.transactionType !== 'buy') continue
    const pla = p.location?.latitude, pln = p.location?.longitude
    if (!pla || !pln || !inBox(pla, pln)) continue
    const sub = (p.propertySubType || '').toLowerCase()
    if (/land|plot|site|garage|parking/.test(sub)) continue
    if (!p.price?.amount) continue
    const url = `https://www.rightmove.co.uk/properties/${p.id}`
    if (existingUrls.has(url) || seen.has(url)) continue
    seen.add(url)
    let text = ''
    try {
      const page = await get(url)
      const kf = page.indexOf('"keyFeatures"')
      text = (kf >= 0 ? page.slice(kf, kf + 6000) : page.slice(0, 60000)).replace(/<[^>]+>/g, ' ')
    } catch { /* enrich is best-effort */ }
    listings.push({
      id: 0, title: p.displayAddress, contract: 'sale',
      type: /bungalow/.test(sub) ? 'Bungalow' : /flat|apartment/.test(sub) ? 'Appartamento' : /cottage/.test(sub) ? 'Cottage' : 'Casa indipendente',
      price: p.price.amount, currency: 'GBP',
      size: null, rooms: p.bedrooms ?? null, baths: p.bathrooms || null, floor: null, year: null, energy: null,
      zone: zoneName, town, addr: p.displayAddress, lat: pla, lng: pln,
      imgs: (p.propertyImages?.images || []).slice(0, 6).map((im) => (im.srcUrl || '').replace('media.rightmove.co.uk:443', 'media.rightmove.co.uk')).filter(Boolean),
      feats: featsOf(text), seaView: SEA.some((r) => r.test(text)), desc: '', date: TODAY, url,
    })
  }
}

if (!listings.length) finish('none', `nessun annuncio in vendita trovato nell'area di ${town}`, zoneName)

// ---- Write src/data.js ----
const zres = data.replace(/(export const ZONES = \[[\s\S]*?)(\n\])/, (_, a, b) => `${a}\n  ${JSON.stringify(zoneName)},${b}`)
if (zres === data) finish('error', 'struttura ZONES inattesa in src/data.js')
data = zres
const maxId = Math.max(...[...data.matchAll(/\{"id": ?(\d+),/g)].map((x) => +x[1]))
listings.forEach((l, i) => { l.id = maxId + 1 + i })
const endIdx = data.lastIndexOf(']')
data = data.slice(0, endIdx) + listings.map((l) => '  ' + JSON.stringify(l) + ',').join('\n') + '\n' + data.slice(endIdx)
writeFileSync(dataPath, data)

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

finish('ok', `aggiunte ${listings.length} case`, zoneName, listings.length)
