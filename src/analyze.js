// Client-side replica of scripts/analyze-deals.mjs, so ANY house can be
// analyzed on demand in its detail sheet — keep the two in sync. Unlike the
// server version it also returns the neutral facts (above-median or
// below-threshold comparisons, missing size) that explain why a house is
// NOT flagged as a deal.
const median = (a) => (a.length ? [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] : null)

export function analyzeListing(l, listings, gbpEur, pages = {}, updated = '') {
  if (!l || l.contract === 'rent' || !l.price || l.feats.includes('Asta')) return null
  const fx = gbpEur || 1.15
  const eur = (x) => (x.currency === 'GBP' ? x.price * fx : x.price)
  const sale = listings.filter((x) => x.contract !== 'rent' && !x.feats.includes('Asta'))
  const checks = []

  // A. €/m² vs zone median (max 32)
  const unitComps = sale.filter((x) => x.zone === l.zone && x.size > 15 && x.url !== l.url).map((x) => eur(x) / x.size)
  if (l.size > 15 && unitComps.length >= 5) {
    const zm = median(unitComps)
    const unit = eur(l) / l.size
    const pct = (zm - unit) / zm
    if (pct >= 0.10) checks.push({ k: 'sqm', v: { unit: Math.round(unit), zone: Math.round(zm), pct: Math.round(pct * 100) }, pts: Math.round(Math.min(pct, 0.35) / 0.35 * 32) })
    else checks.push({ k: 'sqm_info', v: { unit: Math.round(unit), zone: Math.round(zm), pct: Math.round(Math.abs(pct) * 100), over: pct < 0 }, pts: 0 })
  } else if (!l.size) {
    checks.push({ k: 'nosize', v: {}, pts: 0 })
  }

  // B. price vs same-bedroom homes in the zone (max 26)
  const rc = sale.filter((x) => x.zone === l.zone && x.rooms === l.rooms && x.url !== l.url).map((x) => eur(x))
  if (l.rooms && rc.length >= 4) {
    const zm = median(rc)
    const pct = (zm - eur(l)) / zm
    if (pct >= 0.12) checks.push({ k: 'comps', v: { n: rc.length, rooms: l.rooms, pct: Math.round(pct * 100) }, pts: Math.round(Math.min(pct, 0.40) / 0.40 * 26) })
    else checks.push({ k: 'comps_info', v: { n: rc.length, rooms: l.rooms, pct: Math.round(Math.abs(pct) * 100), over: pct < 0 }, pts: 0 })
  }

  // C. tracked price cuts (max 18)
  if (Array.isArray(l.hist) && l.hist.length > 1) {
    const first = l.hist[0].p
    const cut = (first - l.price) / first
    const nCuts = l.hist.slice(1).filter((h, i) => h.p < l.hist[i].p).length
    if (cut >= 0.03) checks.push({ k: 'cuts', v: { pct: Math.round(cut * 100), n: nCuts }, pts: Math.round(Math.min(cut, 0.15) / 0.15 * 14) + (nCuts >= 2 ? 4 : 0) })
  }

  // D. time on the portal (max 8)
  const dd = updated ? Math.max(0, Math.round((new Date(updated) - new Date(l.date)) / 864e5)) : 0
  if (dd >= 45) checks.push({ k: 'days', v: { d: dd }, pts: dd >= 120 ? 8 : dd >= 75 ? 6 : 3 })

  // E. seller-motivation wording (max 10) — flags cached in deals.json
  const MOTIVE_PTS = { fixed: 4, closing: 3, nochain: 2, quick: 4 }
  const flags = pages[l.url]?.flags || []
  if (flags.length) checks.push({ k: 'motive', v: { flags }, pts: Math.min(10, flags.reduce((s, f) => s + (MOTIVE_PTS[f] || 0), 0)) })

  // F. value-add potential (max 6)
  const upPts = (l.feats.includes('Da ammodernare') ? 4 : 0) + (l.feats.includes('Terreno') ? 2 : 0)
  if (upPts) checks.push({ k: 'upside', v: { reno: l.feats.includes('Da ammodernare'), land: l.feats.includes('Terreno') }, pts: upPts })

  // G. premium features below the zone median (max 6)
  if ((l.seaView || l.feats.includes('Spiaggia')) && l.rooms && rc.length >= 4 && eur(l) < median(rc))
    checks.push({ k: 'premium', v: { beach: l.feats.includes('Spiaggia') }, pts: 6 })

  const score = Math.min(100, checks.reduce((s, c) => s + c.pts, 0))
  const priceSignal = checks.filter((c) => ['sqm', 'comps', 'cuts'].includes(c.k)).reduce((s, c) => s + c.pts, 0)
  const isDeal = score >= 45 && priceSignal >= 15
  return { score, isDeal, tier: score >= 60 ? 'top' : isDeal ? 'good' : null, checks }
}

// Estimated saving vs the zone median, in EUR. The €/m² estimate is
// like-for-like so it wins when available; the same-bedroom median can be
// inflated by much larger homes, so it is only a fallback.
export function savingOf(deal, l, gbpEur) {
  const fx = gbpEur || 1.15
  const priceEur = l.currency === 'GBP' ? l.price * fx : l.price
  let best = 0
  const sqm = (deal.checks || []).find((c) => c.k === 'sqm')
  if (sqm && l.size) best = (sqm.v.zone - sqm.v.unit) * l.size
  else {
    const comps = (deal.checks || []).find((c) => c.k === 'comps')
    if (comps) { const p = comps.v.pct / 100; best = priceEur * p / (1 - p) }
  }
  return best > 1000 ? Math.round(best / 1000) * 1000 : 0
}
