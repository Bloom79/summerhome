// Daily refresh of the Altopiano delle Rocche region (Ovindoli, Rocca di
// Mezzo, Rocca di Cambio) → public/it/data.json. Run by it-refresh.yml,
// runnable by hand: node scripts/it/refresh.mjs
//
// Each source in ./sources/ exports { id, label, search(area), verify(l) }:
//   search → candidate listings (already normalised, any order)
//   verify → true = still live, false = off the market; throws = can't tell
// The pipeline owns everything else: area filter, zones, tags, merge with
// yesterday's data (ids, first-seen date, price history), verification of
// vanished listings, cross-source dedupe, distances to the lifts and drive
// times. Outcome goes to $GITHUB_OUTPUT: status = changed|unchanged|error.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { TODAY, out, pmap, haversineM, featsOf, typeOf, getJSON } from './lib.mjs'
import { AREA, zoneOf } from './area.mjs'
import { SOURCES } from './sources/index.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const DIR = ROOT + 'public/it/'
const dataPath = DIR + 'data.json'
// Ids live in their own range so favourites/seen sets (shared across
// regions on a device) can never collide with UK ids.
const ID_BASE = 1_000_000
const STARTED = Date.now()
const BUDGET_MS = +(process.env.BUDGET_MIN || 12) * 60e3
const pastBudget = (share) => Date.now() - STARTED > BUDGET_MS * share
const elapsed = () => `${Math.round((Date.now() - STARTED) / 1000)}s`

const prev = existsSync(dataPath)
  ? JSON.parse(readFileSync(dataPath, 'utf8'))
  : { updated: null, zones: [], features: [], sold: [], listings: [] }
const prevByUrl = new Map(prev.listings.map((l) => [l.url, l]))
const bySource = Object.fromEntries(SOURCES.map((s) => [s.id, s]))
const report = [`# Altopiano delle Rocche ${TODAY}`, '']

// ---- 1. Search every source ----
const health = {} // id -> { n, ok, err }
const scraped = new Map()
for (const s of SOURCES) {
  let cands = []
  try { cands = await s.search(AREA) } catch (e) { health[s.id] = { n: 0, ok: false, err: e.message }; continue }
  let kept = 0
  for (const c of cands) {
    if (!c || !c.url || scraped.has(c.url)) continue
    if (!(c.price >= 10000 && c.price <= 5e6)) continue
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue
    const z = zoneOf(c.lat, c.lng, `${c.addr || ''} ${c.town || ''}`)
    if (!z) continue
    const text = `${c.title || ''} ${c.desc || ''}`
    scraped.set(c.url, {
      id: 0, title: c.title || c.addr || z.town, contract: 'sale',
      type: c.type || typeOf(text), price: Math.round(c.price), currency: 'EUR', country: 'IT',
      size: c.size || null, rooms: c.rooms || null, baths: c.baths || null, floor: c.floor ?? null, year: c.year || null,
      energy: c.energy || null, zone: z.zone, town: z.town, addr: c.addr || z.town,
      lat: c.lat, lng: c.lng, approx: !!c.approx, imgs: (c.imgs || []).slice(0, 40),
      feats: [...new Set([...(c.feats || []), ...featsOf(text)])], seaView: false,
      desc: c.desc || '', date: c.date && c.date <= TODAY ? c.date : TODAY, url: c.url, src: s.id,
      ...(c.auction ? { auction: c.auction } : {}), ...(c.rendita ? { rendita: c.rendita } : {}),
      ...(c.extra || {}),
    })
    kept++
  }
  health[s.id] = { n: kept, ok: true }
  console.log(`[${elapsed()}] ${s.id}: ${cands.length} risultati, ${kept} nell'area`)
}

// A source that suddenly returns far fewer listings than it carried is
// broken or blocked today, not emptied by the market: don't let its
// listings be verified (and archived) against a failing source.
const carried = {}
for (const l of prev.listings) carried[l.src] = (carried[l.src] || 0) + 1
for (const [id, h] of Object.entries(health))
  if (h.ok && (carried[id] || 0) >= 5 && h.n < carried[id] * 0.3) { h.ok = false; h.err = `solo ${h.n} vs ${carried[id]} ieri` }
const healthy = (id) => health[id]?.ok
if (scraped.size === 0 && prev.listings.length) {
  out('status', 'error'); out('summary', 'nessuna sorgente ha risposto — non tocco i dati'); process.exit(0)
}

// ---- 2. Merge with yesterday ----
const events = { nuove: [], ribassi: [], rialzi: [], vendute: [] }
const next = []
for (const [url, c] of scraped) {
  const old = prevByUrl.get(url)
  if (!old) { next.push(c); events.nuove.push(c); continue }
  const merged = {
    ...old, ...c, id: old.id, date: old.date, chk: TODAY,
    imgs: c.imgs.length >= (old.imgs || []).length ? c.imgs : old.imgs,
    desc: (c.desc || '').length >= (old.desc || '').length ? c.desc : old.desc,
    feats: [...new Set([...(old.feats || []).filter((f) => f !== 'Vicino piste'), ...c.feats])],
    travel: old.travel, ski: old.ski,
  }
  if (c.price !== old.price) {
    merged.hist = [...(old.hist || [{ d: old.date, p: old.price }]), { d: TODAY, p: c.price }].slice(-10)
    if (c.price < old.price) events.ribassi.push({ ...merged, oldPrice: old.price })
    else events.rialzi.push({ ...merged, oldPrice: old.price })
  }
  next.push(merged)
}

// ---- 3. Vanished listings: verify on the source before archiving ----
const toSold = (l, status) => ({
  title: l.title, zone: l.zone, town: l.town, addr: l.addr, price: l.price, currency: 'EUR',
  lat: l.lat, lng: l.lng, imgs: (l.imgs || []).slice(0, 1), rooms: l.rooms, firstSeen: l.date, removed: TODAY, url: l.url, status,
})
const missing = prev.listings.filter((l) => !scraped.has(l.url)).sort((a, b) => (a.chk || '').localeCompare(b.chk || ''))
let unverified = 0, dropped = 0
await pmap(missing, async (l) => {
  const src = bySource[l.src]
  // Auction lots: the sale date passed and the lot left the listings.
  if (l.auction && l.auction < TODAY) { events.vendute.push(toSold(l, 'removed')); return }
  // A source unreachable for two weeks (blocked, relay off): drop its
  // listings quietly, not archived as sold, since their fate is unknown.
  if (!src || !healthy(l.src)) {
    if ((Date.now() - new Date(l.chk || l.date).getTime()) / 864e5 > 14) { dropped++; return }
    next.push(l); unverified++; return
  }
  if (pastBudget(0.8)) { next.push(l); unverified++; return }
  let live
  try { live = await src.verify(l) } catch { next.push(l); unverified++; return }
  if (live) next.push({ ...l, chk: TODAY })
  else events.vendute.push(toSold(l, 'removed'))
}, 3)

// ---- 4. Cross-source duplicates (agencies list the same home everywhere) ----
// Same zone and same price on DIFFERENT sources, plus the size within 3 m²
// (or, when a size is missing, the same bedroom count on both): keep the
// richer copy (exact coordinates, more photos), remember the others in
// `alt` so the detail can link every portal. Bedrooms alone can't decide:
// Subito has only "locali", so its rooms are null.
const dupKey = (l) => `${l.zone}|${l.price}`
const sameHome = (a, b) => (a.size && b.size ? Math.abs(a.size - b.size) <= 3 : !!(a.rooms && b.rooms && a.rooms === b.rooms))
const groups = new Map()
for (const l of next) { const k = dupKey(l); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l) }
const drop = new Set()
for (const arr of groups.values()) {
  if (arr.length < 2) continue
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    const a = arr[i], b = arr[j]
    if (drop.has(a) || drop.has(b) || a.src === b.src || !sameHome(a, b)) continue
    const score = (l) => (l.approx ? 0 : 50) + (l.imgs || []).length + (prevByUrl.has(l.url) ? 5 : 0)
    const [keep, lose] = score(a) >= score(b) ? [a, b] : [b, a]
    keep.alt = [...new Map([...(keep.alt || []), { src: lose.src, url: lose.url }, ...(lose.alt || [])].map((x) => [x.url, x])).values()]
      .filter((x) => x.url !== keep.url)
    for (const k of ['size', 'rooms', 'baths', 'energy', 'year']) if (!keep[k] && lose[k]) keep[k] = lose[k]
    keep.feats = [...new Set([...keep.feats, ...lose.feats])]
    drop.add(lose)
  }
}
const listings = next.filter((l) => !drop.has(l))
events.nuove = events.nuove.filter((l) => !drop.has(l))

// ---- 5. Ids, distances to the ski lifts, drive times ----
let maxId = Math.max(ID_BASE, ...prev.listings.map((l) => l.id || 0))
for (const l of listings) if (!l.id) l.id = ++maxId
for (const l of listings) {
  let best = null
  for (const b of AREA.ski) {
    const m = haversineM(l, b)
    if (!best || m < best.m) best = { n: b.name, m: Math.round(m / 10) * 10 }
  }
  l.ski = best
  if (best && best.m <= 3000 && !l.feats.includes('Vicino piste')) l.feats.push('Vicino piste')
  // Official OMI €/m² range for this comune and building type.
  const omi = AREA.omi[l.zone]
  l.omi = omi ? omi[l.type === 'Appartamento' ? 'civili' : 'villini'] : null
}
// Drive time from the closest gate (Roma / L'Aquila / Pescara): one OSRM
// table call per 50 homes, only for homes without one yet.
const needTravel = listings.filter((l) => !l.travel)
for (let i = 0; i < needTravel.length && !pastBudget(0.95); i += 50) {
  const batch = needTravel.slice(i, i + 50)
  const coords = [...AREA.gates.map((g) => `${g.lng},${g.lat}`), ...batch.map((l) => `${l.lng},${l.lat}`)].join(';')
  const srcIdx = AREA.gates.map((_, k) => k).join(';')
  const dstIdx = batch.map((_, k) => AREA.gates.length + k).join(';')
  try {
    const j = await getJSON(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=${srcIdx}&destinations=${dstIdx}`)
    if (j.code !== 'Ok') continue
    batch.forEach((l, k) => {
      let best = null
      AREA.gates.forEach((g, gi) => { const s = j.durations[gi]?.[k]; if (s != null && (!best || s < best.s)) best = { s, g: g.name } })
      if (best) l.travel = { g: best.g, min: Math.round(best.s / 60) }
    })
  } catch { /* OSRM busy: retried tomorrow */ }
}

// ---- 6. Write ----
const zones = [...new Set([...AREA.zones, ...listings.map((l) => l.zone)])]
const features = [...new Set(listings.flatMap((l) => l.feats))].sort()
const sold = [...events.vendute, ...(prev.sold || [])].slice(0, 400)
const db = { updated: TODAY, zones, features, sold, listings, gbpEur: null }
const changed = JSON.stringify({ ...prev, updated: null }) !== JSON.stringify({ ...db, updated: null })
mkdirSync(DIR, { recursive: true })
if (changed) writeFileSync(dataPath, JSON.stringify(db))

const perSrc = Object.entries(health).map(([id, h]) => `| ${id} | ${h.n} | ${h.ok ? 'ok' : `⚠️ ${h.err}`} |`)
report.push('| Sorgente | Annunci | Stato |', '|---|---|---|', ...perSrc, '',
  `${listings.length} annunci · ${events.nuove.length} nuovi · ${events.ribassi.length} ribassi · ${events.vendute.length} venduti/ritirati · ${drop.size} doppioni uniti · ${unverified} non verificati oggi${dropped ? ` · ${dropped} rimossi (sorgente irraggiungibile da 14 giorni)` : ''}`)
writeFileSync(ROOT + 'it-refresh-report.md', report.join('\n') + '\n')
console.log(report.join('\n'))

const broken = Object.entries(health).filter(([, h]) => !h.ok).map(([id]) => id)
out('status', changed ? 'changed' : 'unchanged')
out('summary', `${events.nuove.length} nuove, ${events.ribassi.length} ribassi, ${events.vendute.length} vendute/ritirate · ${listings.length} annunci${broken.length ? ` · ⚠️ ${broken.join(',')}` : ''}`)
out('broken', broken.join(','))
