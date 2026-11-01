// Weekly source-consistency audit — run by the weekly-audit GitHub Action
// (and runnable by hand: node scripts/audit-sources.mjs).
//
// Re-checks EVERY published listing against its live source page: is it
// still on the market, and do price, address and coordinates still match?
// Individual mismatches are normal churn (the next daily refresh heals
// them); the audit's real job is catching systematic breakage — a portal
// redesign that silently rots one adapter. Outcome goes to $GITHUB_OUTPUT:
//   status = ok | issues   summary = <one line>
// and a human report is written to audit-report.md (for the issue body).

import { readFileSync, writeFileSync, appendFileSync } from 'fs'
import { execFile } from 'child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const ROOT = new URL('..', import.meta.url).pathname

const out = (k, v) => {
  console.log(`${k}=${v}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
}
// 404/410 means the listing is off the market. Other failures carry their
// reason ("HTTP 403", "curl 28" = timeout) into the report, so a blocked
// or slow source can be told apart from a broken adapter.
class Gone extends Error {}
const get = (url) => new Promise((resolve, reject) =>
  execFile('curl', ['-s', '--max-time', '25', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6 }, (e, so) => {
    if (e) return reject(new Error(`curl ${e.code}`))
    const s = so.toString(), i = s.lastIndexOf('\n'), code = +s.slice(i + 1)
    if (code === 404 || code === 410) return reject(new Gone())
    if (!code || code >= 400) return reject(new Error(`HTTP ${code}`))
    resolve(s.slice(0, i))
  }))
const pmap = async (items, fn, limit = 8) => {
  const res = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k) }
  }))
  return res
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const db = JSON.parse(readFileSync(ROOT + 'public/data.json', 'utf8'))

// Every check returns a list of problem strings (empty = consistent).
// 'gone' means the source says the listing is off the market.
const checks = {
  rightmove: async (l) => {
    const page = await get(l.url)
    const probs = []
    if (/this property has been removed|no longer (available|on the market)/i.test(page.slice(0, 60000)) ||
        (!page.includes('"keyFeatures"') && !/£[\d,]+/.test(page.slice(0, 60000)))) return ['gone']
    if (!page.includes(l.price.toLocaleString('en-GB'))) probs.push(`prezzo ${l.price} non in pagina`)
    return probs
  },
  onthemarket: async (l) => {
    const page = await get(l.url)
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(page)
    if (!m) return ['struttura pagina cambiata (niente __NEXT_DATA__)']
    // Since Oct 2026 the Redux state sits under props.pageProps.
    const j = JSON.parse(m[1])
    const p = (j.props?.pageProps?.initialReduxState || j.props?.initialReduxState)?.property
    if (!p || !p.priceRaw) return ['gone']
    const probs = []
    if (+p.priceRaw !== l.price) probs.push(`prezzo ${l.price} ≠ ${p.priceRaw}`)
    if (p.displayAddress && norm(p.displayAddress).slice(0, 15) !== norm(l.addr).slice(0, 15))
      probs.push(`indirizzo "${l.addr}" ≠ "${p.displayAddress}"`)
    const la = p.location?.lat ?? p.location?.latitude
    if (typeof la === 'number' && Math.abs(la - l.lat) > 0.01) probs.push(`coordinate ${l.lat} ≠ ${la}`)
    return probs
  },
  s1homes: async (l) => {
    const page = await get(`https://www.s1homes.com/property-for-sale/view/${l.url.split('/').pop()}`)
    const og = /property="og:title" content="([^"]*)"/.exec(page)?.[1] || ''
    if (/^s1homes \|/.test(og)) return ['gone']
    // s1homes re-words addresses freely (adds the locality, drops the house
    // number), so compare by street/town tokens instead of by prefix.
    const tokens = l.addr.toLowerCase().match(/[a-z]{4,}/g) || []
    const hay = norm(og)
    if (og && tokens.length && tokens.filter((w) => hay.includes(w)).length < Math.min(2, tokens.length))
      return [`indirizzo "${l.addr}" ≠ og:title "${og}"`]
    return []
  },
  tspc: async (l) => {
    const page = await get(l.url)
    if (/<title>\s*Property Unavailable/i.test(page)) return ['gone']
    const probs = []
    const price = +((/class="pricing">\s*<div class="type">[^<]*<\/div>\s*<div class="value">\s*£([\d,]+)/.exec(page)?.[1] || '').replace(/,/g, ''))
    if (price && price !== l.price) probs.push(`prezzo ${l.price} ≠ ${price}`)
    const h1 = /<h1>([^<]+)<\/h1>/.exec(page)?.[1] || ''
    if (h1 && norm(h1).slice(0, 15) !== norm(l.addr).slice(0, 15)) probs.push(`indirizzo "${l.addr}" ≠ "${h1}"`)
    const la = parseFloat(/data-lat="(-?[\d.]+)"/.exec(page)?.[1])
    if (Number.isFinite(la) && Math.abs(la - l.lat) > 0.01) probs.push(`coordinate ${l.lat} ≠ ${la}`)
    return probs
  },
  espc: async (l) => {
    // 410 Gone for withdrawn listings (get() turns it into 'gone').
    const page = await get(l.url)
    if (!page.includes('"latitude"')) return ['gone']
    const probs = []
    const price = +(/"price":"?([\d]+)/.exec(page)?.[1] || 0)
    if (price && price !== l.price) probs.push(`prezzo ${l.price} ≠ ${price}`)
    const la = parseFloat(/"latitude":"?(-?[\d.]+)/.exec(page)?.[1])
    if (Number.isFinite(la) && Math.abs(la - l.lat) > 0.01) probs.push(`coordinate ${l.lat} ≠ ${la}`)
    return probs
  },
  aspc: async (l) => {
    // Public API: `null` for withdrawn listings.
    const p = JSON.parse(await get(`https://api.aspc.co.uk/Property/GetProperty/${l.url.split('/').pop()}`))
    if (!p || !p.IsOpen || p.UnderOffer) return ['gone']
    const probs = []
    if (Math.round(p.Price) !== l.price) probs.push(`prezzo ${l.price} ≠ ${Math.round(p.Price)}`)
    const la = +(/POINT \((-?[\d.]+) (-?[\d.]+)\)/.exec(p.Location?.Spatial?.Geography?.WellKnownText || '')?.[2])
    if (Number.isFinite(la) && Math.abs(la - l.lat) > 0.01) probs.push(`coordinate ${l.lat} ≠ ${la}`)
    return probs
  },
  myhome: async (l) => {
    const page = await get(l.url)
    const title = (/<title>([^<]*)/.exec(page)?.[1] || '').trim()
    if (/^(Sold|Sale Agreed)/i.test(title)) return ['gone']
    if (!/€\s?[\d,]+/.test(title)) return ['gone']
    const price = +(/€\s?([\d,]+)/.exec(title)?.[1] || '').replace(/,/g, '')
    if (price && price !== l.price) return [`prezzo ${l.price} ≠ ${price}`]
    return []
  },
  // Auction houses (Future/Prime Property Auctions, Auction House Scotland):
  // the lot page answering is all the refresh relies on too.
  aste: async (l) => { await get(l.url); return [] },
}
const srcOf = (url) =>
  /rightmove/.test(url) ? 'rightmove' : /onthemarket/.test(url) ? 'onthemarket' :
  /s1homes/.test(url) ? 's1homes' : /tspc/.test(url) ? 'tspc' : /espc\.com/.test(url) ? 'espc' : /aspc\.co\.uk/.test(url) ? 'aspc' :
  /futurepropertyauctions|primepropertyauctions|auctionhouse\.co\.uk/.test(url) ? 'aste' : 'myhome'

// Per-source cap on parallel requests: ESPC is the one portal that failed
// a whole audit at once (Nov 2026) while the gentler daily refresh got through.
const CAP = { espc: 2 }
const slots = {}
const withSlot = async (src, fn) => {
  const s = (slots[src] ||= { n: 0, q: [] })
  while (s.n >= (CAP[src] || Infinity)) await new Promise((r) => s.q.push(r))
  s.n++
  try { return await fn() } finally { s.n--; s.q.shift()?.() }
}

const bySrc = {}
const findings = [] // {l, probs}
const unreachable = []
const GONE = ['gone']
const run = (src, l) => withSlot(src, () => checks[src](l)).catch((e) => { if (e instanceof Gone) return GONE; throw e })
// Retired sources (TSPC, 403 to scripts) are dropped by the refresh; skip them here too.
await pmap(db.listings.filter((x) => !/tspc\.co\.uk/.test(x.url)), async (l) => {
  const src = srcOf(l.url)
  const s = bySrc[src] = bySrc[src] || { total: 0, bad: 0, gone: 0, unreachable: 0, why: {} }
  s.total++
  let probs
  try { probs = await run(src, l) } catch {
    // One retry after a pause: slow portals (TSPC ~3.5s/page) throttle
    // bursts, and a transient timeout must not read as a broken adapter.
    await new Promise((r) => setTimeout(r, 4000))
    try { probs = await run(src, l) } catch (e) {
      s.unreachable++; unreachable.push(l)
      s.why[e.message] = (s.why[e.message] || 0) + 1
      return
    }
  }
  if (!probs.length) return
  if (probs[0] === 'gone') { s.gone++; findings.push({ l, probs: ['non più sul portale (il prossimo refresh la archivierà)'] }) }
  else { s.bad++; findings.push({ l, probs }) }
}, 8)

// Systematic breakage: a big share of one source failing means the adapter
// is broken, not the market moving. That includes "gone": the refresh
// re-checks missing listings every few days, so a healthy source has only
// a handful at audit time; OnTheMarket showed 100% gone for four weeks
// (Oct 2026) after a page-structure change, unnoticed.
const broken = Object.entries(bySrc)
  .filter(([, s]) => s.total >= 5 && (s.bad + s.unreachable + s.gone) / s.total > 0.3)
  .map(([src]) => src)
const whyOf = (s) => Object.entries(s.why).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ')

const lines = [
  `# Audit sorgenti ${new Date().toISOString().slice(0, 10)}`,
  '',
  `${db.listings.length} annunci controllati contro le pagine sorgente.`,
  '',
  '| Sorgente | Annunci | Incoerenti | Rimossi | Irraggiungibili | Motivo |',
  '|---|---|---|---|---|---|',
  ...Object.entries(bySrc).map(([src, s]) => `| ${src} | ${s.total} | ${s.bad} | ${s.gone} | ${s.unreachable} | ${whyOf(s)} |`),
  '',
  ...(broken.length ? [`⚠️ **Possibile rottura sistematica dell'adapter**: ${broken.join(', ')} (oltre il 30% degli annunci incoerenti, rimossi o irraggiungibili — probabile cambiamento del sito, o blocco delle richieste se il motivo è HTTP 403/429).`, ''] : []),
  ...(findings.length ? ['## Annunci con problemi', '', ...findings.map(({ l, probs }) => `- #${l.id} ${l.addr} (${l.zone}) — ${probs.join('; ')} — ${l.url}`)] : ['Nessuna incoerenza trovata. ✅']),
  ...(unreachable.length ? ['', `${unreachable.length} pagine non raggiungibili ora (transitorio, non conteggiate come errori salvo soglia sistematica).`] : []),
]
writeFileSync(ROOT + 'audit-report.md', lines.join('\n') + '\n')

const nBad = findings.filter((f) => !f.probs[0].startsWith('non più')).length
const nGone = findings.length - nBad
out('status', broken.length || nBad > 0 || nGone > 3 ? 'issues' : 'ok')
out('summary', `${db.listings.length} controllati · ${nBad} incoerenti · ${nGone} rimossi dal portale · ${unreachable.length} irraggiungibili${broken.length ? ` · ADAPTER ROTTO: ${broken.join(',')}` : ''}`)
