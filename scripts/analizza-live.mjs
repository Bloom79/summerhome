// Live per-house analysis — run by the analizza GitHub Action the moment an
// "Analizza:" issue lands (filed from the detail sheet via the worker).
//
// Unlike the static portal analysis, this goes to the LIVE sources at the
// moment the user asks: the original ad page (current price, qualifier,
// tenure, council tax, EPC, real time-on-market), a second-opinion live
// search on OnTheMarket, portal comparables and the sold archive. Output is
// an Italian markdown report written to analisi-report.md; the workflow
// posts it as the issue comment the portal polls for.

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
const median = (a) => (a.length ? [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] : null)
const fmtGBP = (n, sym) => sym + Math.round(n).toLocaleString('en-GB')
const hav = (a, b, c, d) => {
  const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r
  const s = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(s))
}

const fail = (msg) => { writeFileSync(ROOT + 'analisi-report.md', `⚠️ Analisi non riuscita: ${msg}`); out('status', 'error'); process.exit(0) }

const m = /```json\s*([\s\S]*?)```/.exec(process.env.ISSUE_BODY || '')
if (!m) fail('richiesta senza blocco JSON')
let req
try { req = JSON.parse(m[1]) } catch { fail('JSON non valido') }
const db = JSON.parse(readFileSync(ROOT + 'public/data.json', 'utf8'))
const l = db.listings.find((x) => x.url === req.url) || db.listings.find((x) => x.id === req.id)
if (!l) fail('casa non trovata nel portale (forse rimossa)')

const sym = l.currency === 'EUR' ? '€' : '£'
const fx = db.gbpEur || 1.15
const eur = (x) => (x.currency === 'GBP' ? x.price * fx : x.price)
const lines = [`## 🤖 Analisi live — ${l.addr}`, `_${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · prezzi live dalle fonti_`, '']

// ---- 1. The source page, right now ----
let page = ''
try { page = await get(l.url) } catch { /* handled below */ }
const text = page.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
if (!page) {
  lines.push(`⚠️ **La pagina originale non risponde** — l'annuncio potrebbe essere stato appena rimosso. Verifica: ${l.url}`)
} else if (/this property has been removed|no longer (available|on the market)|<title>\s*(Sold|Sale Agreed|Property Unavailable)/i.test(page)) {
  lines.push('🔴 **ATTENZIONE: la fonte segnala l\'annuncio come rimosso/venduto in questo momento.** Il portale lo archivierà al prossimo aggiornamento.')
} else {
  const priceNow = (() => {
    const mm = page.match(l.currency === 'EUR' ? /€\s?([\d,]+)/ : /£\s?([\d,]+)/)
    return mm ? +mm[1].replace(/,/g, '') : null
  })()
  lines.push('### 📄 La fonte, adesso')
  if (priceNow && Math.abs(priceNow - l.price) > l.price * 0.005)
    lines.push(`- 🚨 **Prezzo cambiato**: la pagina dice ${fmtGBP(priceNow, sym)} (il portale aveva ${fmtGBP(l.price, sym)})`)
  else lines.push(`- Prezzo confermato: **${fmtGBP(l.price, sym)}**`)
  const qual = (/Offers [Oo]ver|Fixed [Pp]rice|Guide [Pp]rice|Offers [Ii]n [Rr]egion [Oo]f|OIRO|POA/.exec(text) || [])[0]
  if (qual) {
    lines.push(`- Formula di prezzo: **${qual}**` + (/fixed/i.test(qual)
      ? ' — in Scozia è il prezzo effettivo: spesso indice di volontà di chiudere in fretta'
      : /offers over/i.test(qual) ? ' — in Scozia le chiusure tipiche superano la base del 5–15%' : ''))
  }
  const tenure = (/\bFreehold\b|\bLeasehold\b|\bFeuhold\b/.exec(text) || [])[0]
  if (tenure) lines.push(`- Proprietà: **${tenure}**${/Leasehold/.test(tenure) ? ' ⚠️ verificare durata e canoni' : ''}`)
  const ct = /[Cc]ouncil [Tt]ax(?:[^A-H]{0,20})[Bb]and:?\s*([A-H])\b/.exec(text)
  if (ct) lines.push(`- Council tax: banda **${ct[1]}**`)
  const epc = /EPC [Rr]ating[^A-G]{0,15}([A-G])\b/.exec(text)
  if (epc) lines.push(`- EPC: **${epc[1]}**`)
  const addedOn = /(?:Added|Reduced) on (\d{2}\/\d{2}\/\d{4})/.exec(text)
  const reduced = /Reduced on (\d{2}\/\d{2}\/\d{4})/.exec(text)
  if (reduced) lines.push(`- 📉 **Ribassata** il ${reduced[1]} — venditore già in trattativa con sé stesso`)
  else if (addedOn) {
    const [d, mo, y] = addedOn[1].split('/')
    const days = Math.round((Date.now() - new Date(`${y}-${mo}-${d}`)) / 864e5)
    lines.push(`- Sul mercato dal ${addedOn[1]} (**${days} giorni** reali, dalla fonte)`)
  }
  if (/closing date/i.test(text)) lines.push('- ⏰ **Closing date menzionata** nell\'annuncio: tempi stretti, muoversi subito')
  if (/no (onward )?chain|chain[- ]free/i.test(text)) lines.push('- ✅ Senza catena: tempi di rogito rapidi')
  lines.push('')
}

// ---- 2. Comparables in the portal (fresh today) ----
const zoneComps = db.listings.filter((x) => x.zone === l.zone && x.contract !== 'rent' && x.url !== l.url)
const sameRooms = zoneComps.filter((x) => x.rooms === l.rooms)
lines.push(`### 🏘 Confronto zona (${l.zone.replace(/ \(.*/, '')}, dati di oggi)`)
if (l.rooms && sameRooms.length >= 3) {
  const med = median(sameRooms.map(eur))
  const rank = sameRooms.filter((x) => eur(x) < eur(l)).length + 1
  lines.push(`- Tra le **${sameRooms.length + 1} case da ${l.rooms} camere** in zona questa è la **${rank}ª più economica** (mediana €${Math.round(med).toLocaleString('it-IT')})`)
}
if (l.size > 15) {
  const units = zoneComps.filter((x) => x.size > 15).map((x) => eur(x) / x.size)
  if (units.length >= 5) {
    const mu = median(units)
    const mine = eur(l) / l.size
    lines.push(`- €/m²: **${Math.round(mine).toLocaleString('it-IT')}** contro mediana di zona ${Math.round(mu).toLocaleString('it-IT')} (${mine < mu ? '−' : '+'}${Math.abs(Math.round((mine - mu) / mu * 100))}%)`)
  }
}
const alternatives = sameRooms.filter((x) => eur(x) < eur(l)).sort((a, b) => eur(a) - eur(b)).slice(0, 3)
if (alternatives.length) {
  lines.push(`- Alternative più economiche con le stesse camere:`)
  for (const a of alternatives) lines.push(`  - ${a.addr.split(',').slice(0, 2).join(',')} — ${fmtGBP(a.price, a.currency === 'EUR' ? '€' : '£')} → ${a.url}`)
}
lines.push('')

// ---- 3. Second opinion: live OnTheMarket search for the same town ----
if (l.currency === 'GBP' && l.town) {
  try {
    const slug = l.town.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ +/g, '-')
    const html = await get(`https://www.onthemarket.com/for-sale/property/${slug}/`)
    const list = JSON.parse(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1]).props.initialReduxState.results.list || []
    const same = list.filter((o) => o.bedrooms === l.rooms).map((o) => +String(o.price || '').replace(/[^0-9]/g, '')).filter((p) => p > 10000)
    if (same.length >= 3) {
      const medOtm = median(same)
      lines.push(`### 🔎 Controprova live (OnTheMarket, ${l.town}, in questo istante)`)
      lines.push(`- ${same.length} case da ${l.rooms} camere in vendita ora · mediana **£${medOtm.toLocaleString('en-GB')}** → questa è ${l.price < medOtm ? '**sotto** ✅' : '**sopra**'} (${l.price < medOtm ? '−' : '+'}${Math.abs(Math.round((l.price - medOtm) / medOtm * 100))}%)`)
      lines.push('')
    }
  } catch { /* second opinion is optional */ }
}

// ---- 4. Sold/withdrawn nearby ----
const gone = (db.sold || []).filter((s) => s.lat && hav(l.lat, l.lng, s.lat, s.lng) < 8)
if (gone.length) {
  lines.push('### 🔴 Uscite dal mercato in zona (nostro archivio)')
  for (const s of gone.slice(0, 4)) {
    const dd = s.firstSeen && s.removed ? Math.round((new Date(s.removed) - new Date(s.firstSeen)) / 864e5) : null
    lines.push(`- ${s.addr.split(',').slice(0, 2).join(',')} — ${fmtGBP(s.price, s.currency === 'EUR' ? '€' : '£')}${dd != null ? ` · via in ~${dd}+ gg` : ''} (${s.status})`)
  }
  lines.push('')
}

// ---- 5. Purchase costs + verdict ----
if (l.currency === 'GBP') {
  const p = l.price
  const bands = [[145000, 0], [250000, 0.02], [325000, 0.05], [750000, 0.10], [Infinity, 0.12]]
  let lbtt = 0, prev = 0
  for (const [cap, rate] of bands) { const amt = Math.min(p, cap) - prev; if (amt > 0) lbtt += amt * rate; prev = cap; if (p <= cap) break }
  const ads = p >= 40000 ? p * 0.08 : 0
  lines.push(`### 💷 Costo reale d'acquisto (seconda casa)`)
  lines.push(`- ${fmtGBP(p, '£')} + LBTT ${fmtGBP(lbtt, '£')} + ADS 8% ${fmtGBP(ads, '£')} = **${fmtGBP(p + lbtt + ads, '£')}** (≈ €${Math.round((p + lbtt + ads) * fx).toLocaleString('it-IT')})`)
} else {
  const sd = l.price <= 1e6 ? l.price * 0.01 : 10000 + (l.price - 1e6) * 0.02
  lines.push(`### 💶 Costo reale d'acquisto`)
  lines.push(`- €${l.price.toLocaleString('it-IT')} + imposta di registro €${Math.round(sd).toLocaleString('it-IT')} = **€${Math.round(l.price + sd).toLocaleString('it-IT')}**`)
}
lines.push('', '_Analisi automatica su fonti live — non è una perizia né consulenza fiscale._')

writeFileSync(ROOT + 'analisi-report.md', lines.join('\n') + '\n')
out('status', 'ok')
