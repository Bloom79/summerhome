// Daily bargain analysis — run by the daily-refresh GitHub Action right
// after the listings refresh (and runnable by hand: node scripts/analyze-deals.mjs).
//
// Scores every for-sale listing against predefined checks and writes
// public/deals.json for the portal's "Occasioni" view. All checks are
// deterministic and explainable — each deal carries its full breakdown:
//
//   A. sqm      (max 32) — €/m² vs the zone median (needs size + ≥5 comps)
//   B. comps    (max 26) — price vs same-bedroom homes in the zone (≥4 comps)
//   C. cuts     (max 18) — tracked price reductions since first seen
//   D. days     (max 8)  — time on the portal (negotiation leverage)
//   E. motive   (max 10) — seller-motivation wording on the source page
//                          (fixed price, closing date, no chain, quick sale)
//   F. upside   (max 6)  — renovation project / land: value-add potential
//   G. premium  (max 6)  — sea view or beachfront priced below the zone median
//
// A listing is a deal only if A+B+C ≥ 15 (a real price signal, not just age
// or a fixer-upper). Tiers: score ≥ 60 → 'top' (🔥), ≥ 45 → 'good' (💎).
// (70 was never reached in a month of runs — the best real deal scored 64.)
// Source pages are fetched once per url — results are cached in deals.json.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs'
import { execFile } from 'child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const ROOT = new URL('..', import.meta.url).pathname
const out = (k, v) => {
  console.log(`${k}=${v}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
}
const get = (url) => new Promise((resolve, reject) =>
  execFile('curl', ['-sf', '--max-time', '25', '-A', UA, url], { maxBuffer: 64e6 },
    (e, so) => (e ? reject(new Error(`curl ${url}`)) : resolve(so.toString()))))
const pmap = async (items, fn, limit = 8) => {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}
const median = (arr) => arr.length ? [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)] : null

const db = JSON.parse(readFileSync(ROOT + 'public/data.json', 'utf8'))
const dealsPath = ROOT + 'public/deals.json'
const prev = existsSync(dealsPath) ? JSON.parse(readFileSync(dealsPath, 'utf8')) : {}
const pageCache = prev.pages || {}
const fx = db.gbpEur || 1.15
const eur = (l) => l.currency === 'GBP' ? l.price * fx : l.price
// Auction guide prices are teasers: lots are neither deals nor comps.
const sale = db.listings.filter((l) => l.contract !== 'rent' && !l.feats.includes('Asta'))

// ---- Zone statistics (the listing itself is excluded from its own comps) ----
const zoneUnit = {}   // zone -> [{url, unit}]
const zoneRooms = {}  // zone|rooms -> [{url, price}]
for (const l of sale) {
  if (l.size > 15) (zoneUnit[l.zone] = zoneUnit[l.zone] || []).push({ url: l.url, unit: eur(l) / l.size })
  if (l.rooms) (zoneRooms[`${l.zone}|${l.rooms}`] = zoneRooms[`${l.zone}|${l.rooms}`] || []).push({ url: l.url, price: eur(l) })
}

// ---- Seller-motivation signals from the source page (fetched once per url) ----
const MOTIVE = [
  ['fixed', /fixed price|price-type-name">\s*Fixed/i, 4],
  ['closing', /closing date/i, 3],
  ['nochain', /no (onward )?chain|chain[- ]free/i, 2],
  ['quick', /motivated seller|priced (for|to) (a )?(quick|fast|swift) sale|reduced for (a )?quick sale|priced to sell|keen to sell|quick sale (sought|required)/i, 4],
]
const toScan = sale.filter((l) => !/s1homes/.test(l.url) && !pageCache[l.url])
await pmap(toScan, async (l) => {
  try {
    const page = await get(l.url)
    pageCache[l.url] = { flags: MOTIVE.filter(([, re]) => re.test(page)).map(([k]) => k) }
  } catch { /* retried on the next run */ }
}, 8)

// ---- Score every listing ----
const TODAY = db.updated
const daysOn = (d) => Math.max(0, Math.round((new Date(TODAY) - new Date(d)) / 864e5))
const deals = []
for (const l of sale) {
  const checks = []
  // A. €/m² vs zone median
  const comps = (zoneUnit[l.zone] || []).filter((c) => c.url !== l.url)
  if (l.size > 15 && comps.length >= 5) {
    const zm = median(comps.map((c) => c.unit))
    const unit = eur(l) / l.size
    const pct = (zm - unit) / zm
    if (pct >= 0.10) checks.push({ k: 'sqm', v: { unit: Math.round(unit), zone: Math.round(zm), pct: Math.round(pct * 100) }, pts: Math.round(Math.min(pct, 0.35) / 0.35 * 32) })
  }
  // B. price vs same-bedroom homes in the zone
  const rc = (zoneRooms[`${l.zone}|${l.rooms}`] || []).filter((c) => c.url !== l.url)
  if (l.rooms && rc.length >= 4) {
    const zm = median(rc.map((c) => c.price))
    const pct = (zm - eur(l)) / zm
    if (pct >= 0.12) checks.push({ k: 'comps', v: { n: rc.length, rooms: l.rooms, pct: Math.round(pct * 100) }, pts: Math.round(Math.min(pct, 0.40) / 0.40 * 26) })
  }
  // C. tracked price cuts
  if (Array.isArray(l.hist) && l.hist.length > 1) {
    const first = l.hist[0].p
    const cut = (first - l.price) / first
    const nCuts = l.hist.slice(1).filter((h, i) => h.p < l.hist[i].p).length
    if (cut >= 0.03) checks.push({ k: 'cuts', v: { pct: Math.round(cut * 100), n: nCuts }, pts: Math.round(Math.min(cut, 0.15) / 0.15 * 14) + (nCuts >= 2 ? 4 : 0) })
  }
  // D. time on the portal
  const dd = daysOn(l.date)
  if (dd >= 45) checks.push({ k: 'days', v: { d: dd }, pts: dd >= 120 ? 8 : dd >= 75 ? 6 : 3 })
  // E. seller-motivation wording
  const flags = pageCache[l.url]?.flags || []
  if (flags.length) {
    const pts = Math.min(10, flags.reduce((s, f) => s + (MOTIVE.find(([k]) => k === f)?.[2] || 0), 0))
    checks.push({ k: 'motive', v: { flags }, pts })
  }
  // F. value-add potential
  const upPts = (l.feats.includes('Da ammodernare') ? 4 : 0) + (l.feats.includes('Terreno') ? 2 : 0)
  if (upPts) checks.push({ k: 'upside', v: { reno: l.feats.includes('Da ammodernare'), land: l.feats.includes('Terreno') }, pts: upPts })
  // G. premium features below the zone median
  if ((l.seaView || l.feats.includes('Spiaggia')) && l.rooms && rc.length >= 4 && eur(l) < median(rc.map((c) => c.price)))
    checks.push({ k: 'premium', v: { beach: l.feats.includes('Spiaggia') }, pts: 6 })

  const score = Math.min(100, checks.reduce((s, c) => s + c.pts, 0))
  const priceSignal = checks.filter((c) => ['sqm', 'comps', 'cuts'].includes(c.k)).reduce((s, c) => s + c.pts, 0)
  if (score >= 45 && priceSignal >= 15)
    deals.push({ id: l.id, url: l.url, score, tier: score >= 60 ? 'top' : 'good', isNew: l.date === TODAY, checks })
}
deals.sort((a, b) => b.score - a.score)

// Drop cached pages for urls no longer in the portal.
const liveUrls = new Set(sale.map((l) => l.url))
for (const u of Object.keys(pageCache)) if (!liveUrls.has(u)) delete pageCache[u]

writeFileSync(dealsPath, JSON.stringify({ updated: TODAY, deals, pages: pageCache }))
const byId = new Map(db.listings.map((l) => [l.id, l]))
const lines = deals.slice(0, 8).map((d) => {
  const l = byId.get(d.id)
  return `- ${d.tier === 'top' ? '🔥' : '💎'} ${d.score}pt ${l.addr} — ${l.currency === 'EUR' ? '€' : '£'}${l.price.toLocaleString('en-GB')} (${d.checks.map((c) => c.k).join('+')})`
})
writeFileSync(ROOT + 'deals-report.md', `# Occasioni ${TODAY}\n${lines.join('\n')}\n`)
out('deals', deals.length)
out('deals_new', deals.filter((d) => d.isNew).length)
out('summary', `${deals.length} occasioni (${deals.filter((d) => d.tier === 'top').length} top) su ${sale.length} annunci`)
