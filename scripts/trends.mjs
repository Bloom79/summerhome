// Market trends from the daily snapshots of public/data.json in git history:
// per day → total listings, new that day, sold-archive size, and per zone
// the count and the median asking price in EUR (auction lots excluded).
// Writes public/trends.json (last 90 days). Needs enough git depth
// (the workflow checks out with fetch-depth: 200).
import { execFileSync } from 'child_process'
import { writeFileSync } from 'fs'

const ROOT = new URL('..', import.meta.url).pathname
const median = (a) => (a.length ? [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] : null)
const shas = execFileSync('git', ['log', '--format=%H', '-n', '120', '--', 'public/data.json'], { cwd: ROOT }).toString().trim().split('\n').filter(Boolean)
const byDay = new Map()
for (const sha of shas) {
  let d
  try { d = JSON.parse(execFileSync('git', ['show', `${sha}:public/data.json`], { cwd: ROOT, maxBuffer: 64e6 }).toString()) } catch { continue }
  if (!d?.updated || byDay.has(d.updated)) continue // newest commit of each day wins
  const fx = d.gbpEur || 1.15
  const eur = (l) => (l.currency === 'GBP' ? l.price * fx : l.price)
  const sale = (d.listings || []).filter((l) => l.contract !== 'rent' && !(l.feats || []).includes('Asta'))
  const zones = {}
  for (const z of d.zones || []) {
    const ls = sale.filter((l) => l.zone === z)
    if (ls.length) zones[z] = { n: ls.length, med: Math.round(median(ls.map(eur))) }
  }
  byDay.set(d.updated, { d: d.updated, total: (d.listings || []).length, new: (d.listings || []).filter((l) => l.date === d.updated).length, sold: (d.sold || []).length, zones })
}
const days = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d)).slice(-90)
writeFileSync(ROOT + 'public/trends.json', JSON.stringify({ updated: days[days.length - 1]?.d || null, days }))
console.log(`trends: ${days.length} giorni (${days[0]?.d} → ${days[days.length - 1]?.d})`)
