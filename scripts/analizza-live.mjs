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
// Other auction lots are teaser-priced: never let them into the comps.
const zoneComps = db.listings.filter((x) => x.zone === l.zone && x.contract !== 'rent' && x.url !== l.url && !x.feats.includes('Asta'))
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

// ---- 2b. Auction lots: three-stage pipeline ----
// Stage 1 builds a machine-readable DOSSIER from the sources, stage 2
// derives every indicator with plain functions (no LLM in the numbers),
// stage 3 hands dossier+indicators to an LLM agent for the reasoned
// verdict only. Numbers never come from the model.
const isAuction = l.feats.includes('Asta') || /futurepropertyauctions|auctionhouse\.co\.uk|primepropertyauctions/.test(l.url)
if (isAuction) {
  // -- Stage 1: dossier (facts only) --
  const flags = []
  if (/without possession|no access|no viewings?/i.test(text)) flags.push('senza_possesso_no_visite')
  if (/no home report/i.test(text)) flags.push('nessun_home_report')
  if (/cash (buyers? )?only/i.test(text)) flags.push('solo_contanti')
  if (/tenanted|sitting tenant/i.test(text)) flags.push('locata')
  if (/structural|subsidence|damp\b/i.test(text)) flags.push('possibili_problemi_strutturali')
  const rentHint = (/£\s?([\d,]+)\s*(?:per|a)\s*(?:month|pcm|night|week)/i.exec(text) || [])[0] || null
  const giorni = l.auction ? Math.round((new Date(l.auction) - Date.now()) / 864e5) : null
  const stima = l.rooms && sameRooms.length >= 4 ? Math.round(median(sameRooms.map(eur))) : null
  const dossier = {
    lotto: { indirizzo: l.addr, zona: l.zone, tipo: l.type, camere: l.rooms, guide_gbp: l.price, data_asta: l.auction, giorni_all_asta: giorni, caratteristiche: l.feats, vista_mare: l.seaView },
    fonte_live: { bandiere_rosse: flags, indizio_reddito: rentHint },
    mercato: { comparabili_stesse_camere: sameRooms.length, stima_valore_mercato_eur: stima, vendute_o_ritirate_entro_8km: (db.sold || []).filter((s) => s.lat && hav(l.lat, l.lng, s.lat, s.lng) < 8).length },
  }

  // -- Stage 2: indicators as plain functions --
  const lbttOf = (p) => { const B = [[145000, 0], [250000, 0.02], [325000, 0.05], [750000, 0.10], [Infinity, 0.12]]; let t = 0, prev = 0; for (const [cap, r] of B) { const a = Math.min(p, cap) - prev; if (a > 0) t += a * r; prev = cap; if (p <= cap) break } return Math.round(t) }
  const FEES = 3000 // stima prudente: buyer's premium + legali
  const totale = (hammer) => hammer + lbttOf(hammer) + Math.round(hammer * 0.08) + FEES
  const scenari = [1, 1.2, 1.35, 1.5].map((k) => { const h = Math.round(l.price * k); return { rilancio: `${Math.round((k - 1) * 100)}%`, aggiudicazione_gbp: h, costo_totale_gbp: totale(h), margine_eur: stima ? Math.round(stima - totale(h) * fx) : null } })
  // max sensible bid: highest hammer whose ALL-IN cost stays ≤90% of value
  let offertaMax = null
  if (stima) { let h = l.price; while (totale(h + 1000) * fx <= stima * 0.9) h += 1000; offertaMax = totale(h) * fx <= stima * 0.9 ? h : null }
  const rischio = flags.reduce((s, f) => s + ({ senza_possesso_no_visite: 3, solo_contanti: 2, locata: 2, possibili_problemi_strutturali: 2, nessun_home_report: 1 }[f] || 0), 0)
  dossier.indicatori = {
    sconto_guide_su_stima_pct: stima ? Math.round((1 - (l.price * fx) / stima) * 100) : null,
    scenari, offerta_massima_consigliata_gbp: offertaMax,
    deposito_10pct_gbp: Math.round(l.price * 0.1),
    rischio_punti: rischio, rischio: rischio >= 4 ? 'alto' : rischio >= 2 ? 'medio' : 'basso',
  }

  // -- deterministic report from the indicators --
  lines.push("### 🔨 Specifiche d'asta")
  if (l.auction) lines.push(`- Asta il **${l.auction.slice(8, 10)}/${l.auction.slice(5, 7)}/${l.auction.slice(0, 4)}**` + (giorni >= 0 ? ` — tra **${giorni} giorni**: legal pack da leggere PRIMA di offrire` : ' — **già passata**: verifica se il lotto è ancora disponibile'))
  else lines.push('- Vendita "offer now" senza data fissa: le offerte possono chiudersi in qualunque momento')
  lines.push("- Il prezzo esposto è la **base d'asta**, non il valore: in Scozia il realizzo tipico la supera del 20–50%")
  if (stima) {
    lines.push(`- Valore di mercato stimato (${sameRooms.length} comparabili da ${l.rooms} camere in zona): **€${stima.toLocaleString('it-IT')}**`)
    lines.push('- Scenari di aggiudicazione (tutto incluso: LBTT+ADS+~£3k spese):')
    for (const s of scenari) lines.push(`  - base +${s.rilancio}: £${s.aggiudicazione_gbp.toLocaleString('en-GB')} → costo totale £${s.costo_totale_gbp.toLocaleString('en-GB')}${s.margine_eur != null ? ` · margine ${s.margine_eur >= 0 ? '+' : '−'}€${Math.abs(s.margine_eur).toLocaleString('it-IT')}` : ''}`)
    if (offertaMax) lines.push(`- 🎯 **Offerta massima sensata: £${offertaMax.toLocaleString('en-GB')}** (oltre, il costo totale supera il 90% del valore stimato)`)
    else lines.push('- ⚠️ Già alla base il costo totale è vicino al valore stimato: **poco o nessun margine**')
  }
  const FLAG_IT = { senza_possesso_no_visite: '**venduto senza possesso / nessuna visita** — stato non verificabile', nessun_home_report: '**nessun home report**', solo_contanti: '**solo contanti** — mutuo non praticabile', locata: '**locata** — verifica contratto in essere', possibili_problemi_strutturali: '**menzioni di problemi strutturali/umidità**' }
  for (const f of flags) lines.push(`- 🚩 ${FLAG_IT[f]}`)
  lines.push(`- Rischio complessivo: **${dossier.indicatori.rischio}** · deposito 10% all'aggiudicazione (£${dossier.indicatori.deposito_10pct_gbp.toLocaleString('en-GB')} alla base) · saldo in 28 giorni (mutuo difficile nei tempi)`)
  lines.push('')

  // -- Stage 3: the agent reasons ON the dossier. Primary channel: the
  // Anthropic API (repo secret ANTHROPIC_API_KEY). Fallback: GitHub
  // Models — free in Actions but in scheduled retirement, so expect
  // brownouts. Either way the numbers above never come from the model.
  const SYS = "Sei un analista immobiliare scozzese. Ricevi un dossier JSON su un lotto d'asta: TUTTI i numeri sono già calcolati, non inventarne. Rispondi in italiano, 120-180 parole, markdown con al massimo 4 bullet: 1) verdetto secco (occasione sì/no/dipende e perché), 2) strategia d'offerta concreta, 3) il rischio che pesa di più, 4) per chi ha senso questo lotto (es. investimento, casa vacanze, da evitare)."
  const post = (url, headers, body) => new Promise((resolve, reject) => execFile('curl',
    ['-s', '--max-time', '60', '-X', 'POST', url, '-H', 'Content-Type: application/json',
      ...headers.flatMap((h) => ['-H', h]), '-d', body], { maxBuffer: 4e6 },
    (e, so) => (e ? reject(e) : resolve(so.toString()))))
  let verdict = null
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const resp = await post('https://api.anthropic.com/v1/messages',
        [`x-api-key: ${process.env.ANTHROPIC_API_KEY}`, 'anthropic-version: 2023-06-01'],
        JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, system: SYS, messages: [{ role: 'user', content: JSON.stringify(dossier) }] }))
      verdict = JSON.parse(resp)?.content?.[0]?.text || null
      if (!verdict) console.log('Anthropic response:', resp.slice(0, 300))
    } catch (e) { console.log('Anthropic call failed:', e.message) }
  }
  if (!verdict && process.env.OPENAI_API_KEY) {
    try {
      const resp = await post('https://api.openai.com/v1/chat/completions',
        [`Authorization: Bearer ${process.env.OPENAI_API_KEY}`],
        JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 400, messages: [{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(dossier) }] }))
      verdict = JSON.parse(resp)?.choices?.[0]?.message?.content || null
      if (!verdict) console.log('OpenAI response:', resp.slice(0, 300))
    } catch (e) { console.log('OpenAI call failed:', e.message) }
  }
  if (verdict) { lines.push("### 🧠 Valutazione ragionata dell'agente"); lines.push(verdict.trim()); lines.push('') }
  else lines.push('_Valutazione LLM non disponibile in questo run — sopra trovi comunque tutti gli indicatori calcolati._', '')
  lines.push('<details><summary>📊 Dossier dati (per trasparenza)</summary>', '', '```json', JSON.stringify(dossier, null, 1), '```', '</details>', '')
}

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
