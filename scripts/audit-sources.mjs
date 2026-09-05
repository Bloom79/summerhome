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
    const p = JSON.parse(m[1]).props?.initialReduxState?.property
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
    // 410 Gone for withdrawn listings (get() rejects on it → handled as
    // unreachable by the caller, so probe the status first).
    const code = await getStatus(l.url)
    if (code === 404 || code === 410) return ['gone']
    const page = await get(l.url)
    if (!page.includes('"latitude"')) return ['gone']
    const probs = []
    const price = +(/"price":"?([\d]+)/.exec(page)?.[1] || 0)
    if (price && price !== l.price) probs.push(`prezzo ${l.price} ≠ ${price}`)
    const la = parseFloat(/"latitude":"?(-?[\d.]+)/.exec(page)?.[1])
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
}
const srcOf = (url) =>
  /rightmove/.test(url) ? 'rightmove' : /onthemarket/.test(url) ? 'onthemarket' :
  /s1homes/.test(url) ? 's1homes' : /tspc/.test(url) ? 'tspc' : /espc\.com/.test(url) ? 'espc' : 'myhome'

const bySrc = {}
const findings = [] // {l, probs}
const unreachable = []
// Retired sources (TSPC, 403 to scripts) are dropped by the refresh; skip them here too.
await pmap(db.listings.filter((x) => !/tspc\.co\.uk/.test(x.url)), async (l) => {
  const src = srcOf(l.url)
  bySrc[src] = bySrc[src] || { total: 0, bad: 0, gone: 0, unreachable: 0 }
  bySrc[src].total++
  let probs
  try { probs = await checks[src](l) } catch {
    // One retry after a pause: slow portals (TSPC ~3.5s/page) throttle
    // bursts, and a transient timeout must not read as a broken adapter.
    await new Promise((r) => setTimeout(r, 4000))
    try { probs = await checks[src](l) } catch { bySrc[src].unreachable++; unreachable.push(l); return }
  }
  if (!probs.length) return
  if (probs[0] === 'gone') { bySrc[src].gone++; findings.push({ l, probs: ['non più sul portale (il prossimo refresh la archivierà)'] }) }
  else { bySrc[src].bad++; findings.push({ l, probs }) }
}, 8)

// Systematic breakage: a big share of one source failing means the adapter
// is broken, not the market moving.
const broken = Object.entries(bySrc)
  .filter(([, s]) => s.total >= 5 && (s.bad + s.unreachable) / s.total > 0.3)
  .map(([src]) => src)

const lines = [
  `# Audit sorgenti ${new Date().toISOString().slice(0, 10)}`,
  '',
  `${db.listings.length} annunci controllati contro le pagine sorgente.`,
  '',
  '| Sorgente | Annunci | Incoerenti | Rimossi | Irraggiungibili |',
  '|---|---|---|---|---|',
  ...Object.entries(bySrc).map(([src, s]) => `| ${src} | ${s.total} | ${s.bad} | ${s.gone} | ${s.unreachable} |`),
  '',
  ...(broken.length ? [`⚠️ **Possibile rottura sistematica dell'adapter**: ${broken.join(', ')} (oltre il 30% degli annunci incoerenti o irraggiungibili — probabile cambiamento del sito).`, ''] : []),
  ...(findings.length ? ['## Annunci con problemi', '', ...findings.map(({ l, probs }) => `- #${l.id} ${l.addr} (${l.zone}) — ${probs.join('; ')} — ${l.url}`)] : ['Nessuna incoerenza trovata. ✅']),
  ...(unreachable.length ? ['', `${unreachable.length} pagine non raggiungibili ora (transitorio, non conteggiate come errori salvo soglia sistematica).`] : []),
]
writeFileSync(ROOT + 'audit-report.md', lines.join('\n') + '\n')

const nBad = findings.filter((f) => !f.probs[0].startsWith('non più')).length
const nGone = findings.length - nBad
out('status', broken.length || nBad > 0 || nGone > 3 ? 'issues' : 'ok')
out('summary', `${db.listings.length} controllati · ${nBad} incoerenti · ${nGone} rimossi dal portale · ${unreachable.length} irraggiungibili${broken.length ? ` · ADAPTER ROTTO: ${broken.join(',')}` : ''}`)
