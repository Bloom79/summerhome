// Live per-house analysis — run by the analizza GitHub Action the moment an
// "Analizza:" issue lands (filed from the detail sheet via the worker).
//
// Unlike the static portal analysis, this goes to the LIVE sources at the
// moment the user asks: the original ad page (current price, qualifier,
// tenure, council tax, EPC, real time-on-market), prices actually PAID
// nearby (Rightmove house-prices, i.e. Registers of Scotland data), a
// second-opinion live search and the rental market on OnTheMarket, portal
// comparables, the sold archive, and — for coastal homes — distance to the
// shoreline and elevation. Everything feeds a deterministic offer strategy
// and a dossier the agent reasons on for the verdict. Numbers never come
// from the model. Output is an Italian markdown report written to
// analisi-report.md; the workflow posts it as the issue comment the portal
// polls for.

import { readFileSync, writeFileSync, appendFileSync } from 'fs'
import { execFile } from 'child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const ROOT = new URL('..', import.meta.url).pathname
const PORTAL = 'https://bloom79.github.io/summerhome/'
const out = (k, v) => {
  console.log(`${k}=${v}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
}
const get = (url) => new Promise((resolve, reject) =>
  execFile('curl', ['-sf', '--max-time', '25', '-A', UA, url], { maxBuffer: 64e6 },
    (e, so) => (e ? reject(new Error(`curl ${url}`)) : resolve(so.toString()))))
const post = (url, headers, body) => new Promise((resolve, reject) => execFile('curl',
  ['-s', '--max-time', '60', '-X', 'POST', url, '-H', 'Content-Type: application/json',
    ...headers.flatMap((h) => ['-H', h]), '-d', body], { maxBuffer: 4e6 },
  (e, so) => (e ? reject(e) : resolve(so.toString()))))
const median = (a) => (a.length ? [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] : null)
const fmtGBP = (n, sym) => sym + Math.round(n).toLocaleString(sym === '€' ? 'it-IT' : 'en-GB')
const fmtEUR = (n) => '€' + Math.round(n).toLocaleString('it-IT')
const k1 = (n) => Math.round(n / 1000) * 1000
const pct = (a, b) => Math.round((a - b) / b * 100)
const signed = (n) => (n >= 0 ? '+' : '−') + Math.abs(n)
const hav = (a, b, c, d) => {
  const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r
  const s = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(s))
}
const stripHtml = (h) => h.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')
const textLines = (h) => h.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, '\n').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n\s*\n+/g, '\n')

const fail = (msg) => { writeFileSync(ROOT + 'analisi-report.md', `⚠️ Analisi non riuscita: ${msg}`); out('status', 'error'); process.exit(0) }

const m = /```json\s*([\s\S]*?)```/.exec(process.env.ISSUE_BODY || '')
if (!m) fail('richiesta senza blocco JSON')
let req
try { req = JSON.parse(m[1]) } catch { fail('JSON non valido') }
const db = JSON.parse(readFileSync(ROOT + 'public/data.json', 'utf8'))
const l = db.listings.find((x) => x.url === req.url) || db.listings.find((x) => x.id === req.id)
if (!l) fail('casa non trovata nel portale (forse rimossa)')

const sym = l.currency === 'EUR' ? '€' : '£'
const isGBP = l.currency === 'GBP'
const fx = db.gbpEur || 1.15
const eur = (x) => (x.currency === 'GBP' ? x.price * fx : x.price)
const toEur = (gbp) => (isGBP ? gbp * fx : gbp)
const lines = [`## 🤖 Analisi live — ${l.addr}`, `_${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · prezzi live dalle fonti_`, '']
// TL;DR block: when populated, it goes right under the header and the
// full sections collapse into a <details> — summary first, details on tap.
const sintesi = []
let dossierLines = []
// Facts collected along the way; they become the agent's dossier and the
// inputs of the offer strategy.
const fonte = {}
const mercato = {}

// ---- Agent channels (verdict only — every number is computed here) ----
// Primary: the Anthropic API (repo secret). Fallback: OpenAI. Last resort:
// a marker the workflow fills via the Copilot CLI, or a "no LLM" note.
const askAgent = async (SYS, dossier) => {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const resp = await post('https://api.anthropic.com/v1/messages',
        [`x-api-key: ${process.env.ANTHROPIC_API_KEY}`, 'anthropic-version: 2023-06-01'],
        JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, system: SYS, messages: [{ role: 'user', content: JSON.stringify(dossier) }] }))
      const v = JSON.parse(resp)?.content?.[0]?.text
      if (v) return v
      console.log('Anthropic response:', resp.slice(0, 300))
    } catch (e) { console.log('Anthropic call failed:', e.message) }
  }
  if (process.env.OPENAI_API_KEY) {
    try {
      const resp = await post('https://api.openai.com/v1/chat/completions',
        [`Authorization: Bearer ${process.env.OPENAI_API_KEY}`],
        JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 500, messages: [{ role: 'system', content: SYS }, { role: 'user', content: JSON.stringify(dossier) }] }))
      const v = JSON.parse(resp)?.choices?.[0]?.message?.content
      if (v) return v
      console.log('OpenAI response:', resp.slice(0, 300))
    } catch (e) { console.log('OpenAI call failed:', e.message) }
  }
  return null
}
const copilotFallback = (SYS, dossier) => {
  try { writeFileSync(ROOT + 'analisi-prompt.txt', SYS + '\n\nRispondi direttamente in markdown, senza usare strumenti e senza premesse.\n\nDOSSIER:\n' + JSON.stringify(dossier)) } catch { /* marker stays inert */ }
}

// ---- 1. The source page, right now ----
let page = ''
try { page = await get(l.url) } catch { /* handled below */ }
const text = stripHtml(page)
// Council tax: Scottish bands are fixed ratios of band D (A 240/360 … H
// 882/360); the 2025/26 Scottish average band D is ~£1,500, so the yearly
// figure is an estimate (councils differ by ±10%).
const CT_RATIO = { A: 240, B: 280, C: 320, D: 360, E: 473, F: 585, G: 705, H: 882 }
const ctYear = (band) => Math.round(1500 * CT_RATIO[band] / 360)
const EPC_HINT = { A: 'ottimo isolamento, bollette basse', B: 'ottimo isolamento, bollette basse', C: 'buon isolamento', D: 'isolamento medio', E: 'riscaldamento costoso: preventivare isolamento/caldaia', F: 'riscaldamento molto costoso: interventi necessari', G: 'riscaldamento molto costoso: interventi necessari' }
if (!page) {
  lines.push(`⚠️ **La pagina originale non risponde** — l'annuncio potrebbe essere stato appena rimosso. Verifica: ${l.url}`)
  fonte.pagina = 'non raggiungibile'
} else if (/this property has been removed|no longer (available|on the market)|<title>\s*(Sold|Sale Agreed|Property Unavailable)/i.test(page)) {
  lines.push('🔴 **ATTENZIONE: la fonte segnala l\'annuncio come rimosso/venduto in questo momento.** Il portale lo archivierà al prossimo aggiornamento.')
  fonte.pagina = 'rimosso'
} else {
  fonte.pagina = 'attiva'
  const priceNow = (() => {
    const mm = page.match(isGBP ? /£\s?([\d,]+)/ : /€\s?([\d,]+)/)
    return mm ? +mm[1].replace(/,/g, '') : null
  })()
  lines.push('### 📄 La fonte, adesso')
  if (priceNow && Math.abs(priceNow - l.price) > l.price * 0.005) {
    lines.push(`- 🚨 **Prezzo cambiato**: la pagina dice ${fmtGBP(priceNow, sym)} (il portale aveva ${fmtGBP(l.price, sym)})`)
    fonte.prezzo_live = priceNow
  } else { lines.push(`- Prezzo confermato: **${fmtGBP(l.price, sym)}**`); fonte.prezzo_live = l.price }
  const qual = (/Offers [Oo]ver|Fixed [Pp]rice|Guide [Pp]rice|Offers [Ii]n [Rr]egion [Oo]f|OIRO|POA/.exec(text) || [])[0]
  if (qual) {
    fonte.formula = qual
    lines.push(`- Formula di prezzo: **${qual}**` + (/fixed/i.test(qual)
      ? ' — in Scozia è il prezzo effettivo: spesso indice di volontà di chiudere in fretta'
      : /offers over/i.test(qual) ? ' — in Scozia le chiusure tipiche superano la base del 5–15%'
      : /region|OIRO|guide/i.test(qual) ? ' — il venditore accetta offerte sotto la cifra esposta' : ''))
  }
  const tenure = (/\bFreehold\b|\bLeasehold\b|\bFeuhold\b/.exec(text) || [])[0]
  if (tenure) { fonte.tenure = tenure; lines.push(`- Proprietà: **${tenure}**${/Leasehold/.test(tenure) ? ' ⚠️ verificare durata e canoni' : ''}`) }
  const ct = /[Cc]ouncil [Tt]ax(?:[^A-H]{0,20})[Bb]and:?\s*([A-H])\b/.exec(text)
  if (ct) { fonte.council_tax_band = ct[1]; fonte.council_tax_anno_gbp = ctYear(ct[1]); lines.push(`- Council tax: banda **${ct[1]}** ≈ £${ctYear(ct[1]).toLocaleString('en-GB')}/anno (stima sulla media scozzese; il comune può variare del ±10%)`) }
  const epc = /EPC [Rr]ating[^A-G]{0,15}([A-G])\b/.exec(text)
  if (epc) { fonte.epc = epc[1]; lines.push(`- EPC: **${epc[1]}** — ${EPC_HINT[epc[1]]}`) }
  const addedOn = /(?:Added|Reduced) on (\d{2}\/\d{2}\/\d{4})/.exec(text)
  const reduced = /Reduced on (\d{2}\/\d{2}\/\d{4})/.exec(text)
  const dmy = (s) => { const [d, mo, y] = s.split('/'); return new Date(`${y}-${mo}-${d}`) }
  if (addedOn) fonte.giorni_sul_mercato = Math.round((Date.now() - dmy(addedOn[1])) / 864e5)
  // A cut with no buyer at the table means the seller already moved first:
  // real negotiating room, and a floor lower than the asking price.
  if (reduced) { fonte.ribassata_il = reduced[1]; lines.push(`- 📉 **Ribassata** il ${reduced[1]} (dato della fonte): il venditore ha già tagliato il prezzo senza un'offerta sul tavolo — c'è margine di trattativa e il prezzo pieno non è il suo minimo`) }
  else if (addedOn) lines.push(`- Sul mercato dal ${addedOn[1]} (**${fonte.giorni_sul_mercato} giorni** reali, dalla fonte)`)
  if (/closing date/i.test(text)) { fonte.closing_date = true; lines.push('- ⏰ **Closing date menzionata** nell\'annuncio: tempi stretti, muoversi subito') }
  if (/no (onward )?chain|chain[- ]free/i.test(text)) { fonte.senza_catena = true; lines.push('- ✅ Senza catena: tempi di rogito rapidi') }
  if (/motivated seller|priced (for|to) (a )?(quick|fast|swift) sale|reduced for (a )?quick sale|priced to sell|keen to sell|quick sale/i.test(text)) { fonte.venditore_motivato = true; lines.push('- 🏃 **Venditore motivato / vendita rapida** dichiarata nell\'annuncio') }
  // Full postcode from the ad (Rightmove/OTM embed it): key to the sold-prices lookup.
  const pcm = /"outcode"\s*:\s*"([A-Z0-9]+)"\s*,\s*"incode"\s*:\s*"([A-Z0-9]+)"/.exec(page) || /"postcode"\s*:\s*"([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})"/.exec(page)
  if (pcm) fonte.postcode = `${pcm[1]} ${pcm[2]}`
  lines.push('')
}
if (fonte.giorni_sul_mercato == null && l.date) fonte.giorni_sul_mercato = Math.round((Date.now() - new Date(l.date)) / 864e5)
if (Array.isArray(l.hist) && l.hist.length > 1) {
  fonte.ribassi = l.hist.length - 1
  fonte.ribasso_totale_pct = pct(l.price, l.hist[0].p)
}

// ---- 2. Comparables in the portal (fresh today) ----
// Other auction lots are teaser-priced: never let them into the comps.
const zoneComps = db.listings.filter((x) => x.zone === l.zone && x.contract !== 'rent' && x.url !== l.url && !x.feats.includes('Asta'))
const sameRooms = zoneComps.filter((x) => x.rooms === l.rooms)
const zoneName = l.zone.replace(/ \(.*/, '')
lines.push(`### 🏘 Confronto zona (${zoneName}, dati di oggi)`)
if (l.rooms && sameRooms.length >= 3) {
  const med = median(sameRooms.map(eur))
  const rank = sameRooms.filter((x) => eur(x) < eur(l)).length + 1
  mercato.portale = { comparabili_stesse_camere: sameRooms.length, mediana_chiesta_eur: Math.round(med), posizione: rank, scarto_vs_mediana_pct: pct(eur(l), med) }
  lines.push(`- Tra le **${sameRooms.length + 1} case da ${l.rooms} camere** in zona questa è la **${rank}ª più economica** (mediana ${fmtEUR(med)}, questa ${signed(pct(eur(l), med))}%)`)
} else lines.push(`- Poche case da ${l.rooms || '?'} camere in zona per un confronto affidabile (${sameRooms.length})`)
if (l.size > 15) {
  const units = zoneComps.filter((x) => x.size > 15).map((x) => eur(x) / x.size)
  if (units.length >= 5) {
    const mu = median(units)
    const mine = eur(l) / l.size
    mercato.eur_m2 = { casa: Math.round(mine), zona: Math.round(mu), scarto_pct: pct(mine, mu) }
    lines.push(`- €/m²: **${Math.round(mine).toLocaleString('it-IT')}** contro mediana di zona ${Math.round(mu).toLocaleString('it-IT')} (${signed(pct(mine, mu))}%)`)
  }
} else {
  const pc = fonte.postcode || (/\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/.exec(l.addr) || [])[0]
  lines.push(`- Superficie non pubblicata: l'€/m² non è calcolabile. ${isGBP ? `In Scozia la trovi nell'Home Report o nel registro EPC (cerca ${pc ? `il CAP **${pc}**` : "l'indirizzo"}): https://www.scottishepcregister.org.uk/` : "Chiedila all'agenzia: in Irlanda è nel BER."}`)
}
const alternatives = sameRooms.filter((x) => eur(x) < eur(l)).sort((a, b) => eur(a) - eur(b)).slice(0, 3)
if (alternatives.length) {
  lines.push('- Alternative più economiche con le stesse camere (apri nel portale):')
  for (const a of alternatives) lines.push(`  - ${a.addr.split(',').slice(0, 2).join(',')} — ${fmtGBP(a.price, a.currency === 'EUR' ? '€' : '£')}${a.seaView ? ' 🌊' : ''}${a.feats.includes('Giardino') ? ' 🌳' : ''} → ${PORTAL}?casa=${a.id}`)
}
lines.push('')

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
// ---- 2c. Prices actually PAID nearby (Rightmove house-prices = Registers of Scotland) ----
// Asking prices are opinions; sold prices are facts. Full postcode → 800 m
// radius, last 3 years; outcode only → the whole outcode, last 2 years.
if (isGBP) {
  const full = fonte.postcode || (/\b([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})\b/.exec(l.addr) || []).slice(1).join(' ') || null
  const outcode = full ? full.split(' ')[0] : (/\b([A-Z]{1,2}\d[A-Z\d]?)\b\s*$/.exec(l.addr.trim()) || [])[1] || null
  const slug = full ? full.toLowerCase().replace(' ', '-') : outcode ? outcode.toLowerCase() : null
  if (slug) {
    try {
      const html = await get(`https://www.rightmove.co.uk/house-prices/${slug}.html?${full ? 'radius=0.5&soldIn=3' : 'soldIn=2'}`)
      const rows = textLines(html).split('\n').map((s) => s.trim())
      const sold = []
      for (let i = 0; i < rows.length; i++) {
        if (!/[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/.test(rows[i]) || /^House Prices in/i.test(rows[i])) continue
        const type = /^(Detached|Semi[- ]Detached|Terraced|Flat|Flats|Other|Bungalow)/i.test(rows[i + 1] || '') ? rows[i + 1] : ''
        // first (most recent) transaction after the address
        for (let j = i + 1; j < Math.min(i + 8, rows.length); j++) {
          const d = /^(\d{1,2}) ([A-Z][a-z]{2}) (20\d\d)$/.exec(rows[j])
          const p = /^£([\d,]+)$/.exec(rows[j + 1] || '')
          if (d && p) { sold.push({ addr: rows[i], type, date: `${d[3]}-${MONTHS[d[2]] || '01'}-${d[1].padStart(2, '0')}`, y: +d[3], price: +p[1].replace(/,/g, '') }); break }
        }
      }
      const recent = sold.filter((s) => s.y >= new Date().getFullYear() - 3)
      if (recent.length >= 3) {
        const flats = (t) => /flat/i.test(t)
        const mine = l.type === 'Appartamento'
        const sameKind = recent.filter((s) => s.type && flats(s.type) === mine)
        const med = median(recent.map((s) => s.price))
        const medKind = sameKind.length >= 4 ? median(sameKind.map((s) => s.price)) : null
        mercato.venduti = { fonte: 'Rightmove house-prices (Registers of Scotland)', area: full ? `entro 800 m da ${full}` : `CAP ${outcode}`, anni: full ? 3 : 2, n: recent.length, mediana_gbp: med, n_stesso_tipo: sameKind.length, mediana_stesso_tipo_gbp: medKind, chiesto_vs_venduti_pct: pct(l.price, medKind || med) }
        lines.push(`### 💷 Prezzi realmente pagati (${mercato.venduti.area}, ultimi ${mercato.venduti.anni} anni)`)
        lines.push(`- **${recent.length} vendite registrate**, mediana **£${med.toLocaleString('en-GB')}**${medKind ? ` · ${mine ? 'appartamenti' : 'case'}: mediana **£${medKind.toLocaleString('en-GB')}** (${sameKind.length})` : ''}`)
        lines.push(`- Questa è chiesta a ${signed(pct(l.price, medKind || med))}% rispetto ai venduti${medKind ? ' dello stesso tipo' : ''} — ${pct(l.price, medKind || med) > 15 ? '**ben sopra** i prezzi pagati: margine di trattativa' : pct(l.price, medKind || med) < -10 ? '**sotto** i prezzi pagati: attesa concorrenza' : 'in linea con i prezzi pagati'}`)
        const last = [...recent].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5)
        lines.push('- Ultime vendite:')
        for (const s of last) lines.push(`  - ${s.addr.replace(/ [A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/, '')}${s.type ? ` (${s.type})` : ''} — £${s.price.toLocaleString('en-GB')} · ${s.date.slice(8, 10)}/${s.date.slice(5, 7)}/${s.date.slice(0, 4)}`)
        lines.push(`- Fonte: https://www.rightmove.co.uk/house-prices/${slug}.html`)
        lines.push('')
      }
    } catch { /* sold prices are optional */ }
  }
} else {
  lines.push('### 💶 Prezzi realmente pagati')
  lines.push(`- In Irlanda i prezzi pagati sono pubblici nel Property Price Register: cerca "${l.town || l.addr.split(',')[1] || ''}" su https://www.propertypriceregister.ie/`)
  lines.push('')
}

// ---- 2d. Rental market (OnTheMarket to-rent, same town) → gross yield ----
if (isGBP && l.town && !l.feats.includes('Asta')) {
  try {
    const slug = l.town.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ +/g, '-')
    const html = await get(`https://www.onthemarket.com/to-rent/property/${slug}/`)
    const list = JSON.parse(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1]).props.initialReduxState.results.list || []
    const pcm = (o) => { const mm = /£([\d,]+)\s*pcm/i.exec(String(o.price || '')); return mm ? +mm[1].replace(/,/g, '') : null }
    const same = list.filter((o) => o.bedrooms === l.rooms).map(pcm).filter((p) => p > 200)
    const all = list.map(pcm).filter((p) => p > 200)
    const pool = same.length >= 3 ? same : all.length >= 3 ? all : []
    if (pool.length) {
      const rent = median(pool)
      const yieldPct = +(rent * 12 / l.price * 100).toFixed(1)
      mercato.affitti = { citta: l.town, n: pool.length, stesse_camere: same.length >= 3, canone_mediano_pcm_gbp: rent, rendimento_lordo_pct: yieldPct }
      lines.push(`### 🏠 Affitto (OnTheMarket, ${l.town}, adesso)`)
      lines.push(`- ${pool.length} case in affitto${same.length >= 3 ? ` da ${l.rooms} camere` : ' (tutte le taglie: poche con le stesse camere)'} · canone mediano **£${rent.toLocaleString('en-GB')}/mese**`)
      lines.push(`- Rendimento lordo a lungo termine: **${yieldPct}%** l'anno${yieldPct >= 6 ? ' — alto per la Scozia' : yieldPct >= 4.5 ? ' — nella norma' : ' — basso: la casa vale per l\'uso, non come investimento'}. L'affitto turistico rende di più ma serve la licenza short-term let del comune.`)
      lines.push('')
    }
  } catch { /* rentals are optional */ }
}

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
  const verdict = await askAgent(SYS, dossier)
  sintesi.push(`**Base £${l.price.toLocaleString('en-GB')}**${stima ? ` · valore stimato **€${stima.toLocaleString('it-IT')}**` : ''}${offertaMax ? ` · 🎯 offerta max **£${offertaMax.toLocaleString('en-GB')}**` : ''} · rischio **${dossier.indicatori.rischio}**${l.auction ? ` · asta **${l.auction.slice(8, 10)}/${l.auction.slice(5, 7)}**` : ''}`, '')
  if (verdict) { sintesi.push("### 🧠 In sintesi (agente)", verdict.trim(), '') }
  else {
    // No API key produced a verdict: hand over to the workflow, which can
    // run the official Copilot CLI (billed to the owner's subscription)
    // and replace this marker with the reasoned verdict — or with the
    // no-LLM note if that fails too.
    sintesi.push('<!--VERDETTO_QUI-->', '')
    copilotFallback(SYS, dossier)
  }
  dossierLines = ['<details><summary>📊 Dossier dati (per trasparenza)</summary>', '', '```json', JSON.stringify(dossier, null, 1), '```', '</details>', '']
}


// ---- 3. Second opinion: live OnTheMarket search for the same town ----
if (isGBP && l.town) {
  try {
    const slug = l.town.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/ +/g, '-')
    const html = await get(`https://www.onthemarket.com/for-sale/property/${slug}/`)
    const list = JSON.parse(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1]).props.initialReduxState.results.list || []
    const same = list.filter((o) => o.bedrooms === l.rooms).map((o) => +String(o.price || '').replace(/[^0-9]/g, '')).filter((p) => p > 10000)
    if (same.length >= 3) {
      const medOtm = median(same)
      mercato.onthemarket = { citta: l.town, n_stesse_camere: same.length, mediana_chiesta_gbp: medOtm, scarto_pct: pct(l.price, medOtm) }
      lines.push(`### 🔎 Controprova live (OnTheMarket, ${l.town}, in questo istante)`)
      lines.push(`- ${same.length} case da ${l.rooms} camere in vendita ora · mediana **£${medOtm.toLocaleString('en-GB')}** → questa è ${l.price < medOtm ? '**sotto** ✅' : '**sopra**'} (${signed(pct(l.price, medOtm))}%)`)
      lines.push('')
    }
  } catch { /* second opinion is optional */ }
}

// ---- 4. Sold/withdrawn nearby (our archive), interpreted ----
const gone = (db.sold || []).filter((s) => s.lat && hav(l.lat, l.lng, s.lat, s.lng) < 8)
if (gone.length) {
  const days = gone.map((s) => (s.firstSeen && s.removed ? Math.round((new Date(s.removed) - new Date(s.firstSeen)) / 864e5) : null)).filter((d) => d != null)
  const medDays = median(days)
  const recent90 = gone.filter((s) => s.removed && (Date.now() - new Date(s.removed)) / 864e5 <= 90).length
  mercato.uscite = { entro_8km: gone.length, ultimi_90_giorni: recent90, giorni_mediani_prima_di_sparire: medDays, ritmo: medDays == null ? null : medDays <= 45 ? 'veloce' : medDays <= 120 ? 'normale' : 'lento' }
  lines.push('### 🔴 Uscite dal mercato in zona (nostro archivio)')
  lines.push(`- **${gone.length} case** entro 8 km sono sparite dal mercato${recent90 ? `, ${recent90} negli ultimi 90 giorni` : ''}${medDays != null ? ` · in media dopo **~${medDays} giorni** (dal nostro primo avvistamento) → mercato **${mercato.uscite.ritmo}**${medDays <= 45 ? ': le case buone vanno via in poche settimane, non aspettare' : medDays > 120 ? ': c\'è tempo per trattare' : ''}` : ''}`)
  for (const s of gone.slice(0, 4)) {
    const dd = s.firstSeen && s.removed ? Math.round((new Date(s.removed) - new Date(s.firstSeen)) / 864e5) : null
    lines.push(`  - ${s.addr.split(',').slice(0, 2).join(',')} — ${fmtGBP(s.price, s.currency === 'EUR' ? '€' : '£')}${dd != null ? ` · via in ~${dd}+ gg` : ''} (${{ sold: 'venduta', sale_agreed: 'offerta accettata', removed: 'ritirata' }[s.status] || s.status})`)
  }
  lines.push('')
}

// ---- 4b. Coast and elevation: the two numbers behind "sea view" ----
// Distance to the OSM coastline within 1.5 km (Overpass, geometry) and
// the elevation from the EU 25 m DEM: a sea view at 3 m above the tide is
// a different purchase from one at 30 m.
const coastal = l.seaView || l.feats.includes('Spiaggia')
{
  let coastM = null, elev = null
  try {
    const q = `[out:json][timeout:10];(way(around:1500,${l.lat},${l.lng})["natural"="coastline"];);out geom;`
    const j = await new Promise((resolve, reject) => execFile('curl', ['-sf', '--max-time', '15', '-A', 'casatrova-agent/1.0', 'https://overpass-api.de/api/interpreter', '--data-urlencode', `data=${q}`], { maxBuffer: 8e6 }, (e, so) => (e ? reject(e) : resolve(JSON.parse(so.toString())))))
    for (const w of j.elements || []) for (const g of w.geometry || []) { const d = hav(l.lat, l.lng, g.lat, g.lon) * 1000; if (coastM == null || d < coastM) coastM = d }
  } catch { /* optional */ }
  try {
    const j = JSON.parse(await get(`https://api.opentopodata.org/v1/eudem25m?locations=${l.lat},${l.lng}`))
    elev = j?.results?.[0]?.elevation
    if (typeof elev !== 'number') { const j2 = JSON.parse(await get(`https://api.open-elevation.com/api/v1/lookup?locations=${l.lat},${l.lng}`)); elev = j2?.results?.[0]?.elevation }
  } catch { /* optional */ }
  if (coastal || (coastM != null && coastM < 1500)) {
    mercato.costa = { distanza_costa_m: coastM != null ? Math.round(coastM) : null, quota_m: typeof elev === 'number' ? Math.round(elev) : null }
    lines.push('### 🌊 Costa e rischio')
    if (coastM != null) lines.push(`- Costa a **~${Math.round(coastM / 10) * 10} m** (linea di costa OSM)${coastM < 150 ? ' — fronte mare' : coastM < 500 ? ' — a due passi dal mare' : ''}`)
    else if (coastal) lines.push('- Nessuna linea di costa entro 1,5 km sulla mappa OSM: la "vista mare" dell\'annuncio è da verificare di persona')
    if (typeof elev === 'number') lines.push(`- Quota **~${Math.round(elev)} m** s.l.m.${elev < 5 && coastM != null && coastM < 300 ? ' ⚠️ **bassa e vicina al mare: verificare alluvione costiera e mareggiate prima di offrire**' : elev < 10 && coastM != null && coastM < 300 ? ' — bassa: controlla le mappe di alluvione' : ' — al sicuro dalle mareggiate'}`)
    if (isGBP) lines.push(`- Mappe ufficiali (inserisci il CAP o le coordinate ${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}): alluvione SEPA https://map.sepa.org.uk/floodmaps/ · erosione Dynamic Coast https://www.dynamiccoast.com/`)
    else lines.push(`- Mappe ufficiali (coordinate ${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}): alluvione OPW https://www.floodinfo.ie/map/floodmaps/`)
    lines.push('')
  }
}

// ---- 5. Purchase costs ----
const lbttOf = (p) => { const B = [[145000, 0], [250000, 0.02], [325000, 0.05], [750000, 0.10], [Infinity, 0.12]]; let t = 0, prev = 0; for (const [cap, r] of B) { const a = Math.min(p, cap) - prev; if (a > 0) t += a * r; prev = cap; if (p <= cap) break } return Math.round(t) }
const costi = {}
if (isGBP) {
  const p = l.price
  const lbtt = lbttOf(p)
  const ads = p >= 40000 ? Math.round(p * 0.08) : 0
  Object.assign(costi, { prezzo_gbp: p, lbtt_gbp: lbtt, ads_gbp: ads, totale_gbp: p + lbtt + ads, totale_eur: Math.round((p + lbtt + ads) * fx) })
  lines.push(`### 💷 Costo reale d'acquisto (seconda casa)`)
  lines.push(`- ${fmtGBP(p, '£')} + LBTT ${fmtGBP(lbtt, '£')} + ADS 8% ${fmtGBP(ads, '£')} = **${fmtGBP(p + lbtt + ads, '£')}** (≈ ${fmtEUR(costi.totale_eur)})`)
  if (fonte.council_tax_anno_gbp) lines.push(`- Costi ricorrenti: council tax ≈ £${fonte.council_tax_anno_gbp.toLocaleString('en-GB')}/anno${fonte.epc ? ` · EPC ${fonte.epc}: ${EPC_HINT[fonte.epc]}` : ''}`)
} else {
  const sd = l.price <= 1e6 ? l.price * 0.01 : 10000 + (l.price - 1e6) * 0.02
  Object.assign(costi, { prezzo_eur: l.price, imposta_registro_eur: Math.round(sd), totale_eur: Math.round(l.price + sd) })
  lines.push(`### 💶 Costo reale d'acquisto`)
  lines.push(`- €${l.price.toLocaleString('it-IT')} + imposta di registro €${Math.round(sd).toLocaleString('it-IT')} = **€${Math.round(l.price + sd).toLocaleString('it-IT')}**`)
}
lines.push('')

// ---- 6. Offer strategy + verdict (non-auction homes) ----
// Deterministic levers, each with its reason, so the numbers are
// explainable; the agent only reasons on top of them.
if (!isAuction) {
  const P = l.price
  const leve = []
  let open = 1.0, max = 1.0
  const f = fonte.formula || ''
  if (/fixed/i.test(f)) { open = 1.0; max = 1.0; leve.push('Fixed price: si offre il prezzo pieno (o poco sotto se ferma da tempo)') }
  else if (/offers over/i.test(f)) { open = 1.0; max = 1.08; leve.push('Offers over: la cifra è la base, le chiusure tipiche stanno +5–15%: apertura al prezzo, tetto +8%') }
  else if (/region|OIRO|guide/i.test(f)) { open = 0.92; max = 1.0; leve.push('OIRO/guide: il venditore accetta offerte sotto la cifra: apertura −8%') }
  else { open = 0.95; max = 1.0; leve.push('Formula non dichiarata: apertura prudente −5%') }
  const days = fonte.giorni_sul_mercato ?? 0
  if (days > 180) { open -= 0.05; max -= 0.03; leve.push(`Sul mercato da ${days} giorni: −5% in apertura`) }
  else if (days > 90) { open -= 0.03; max -= 0.02; leve.push(`Sul mercato da ${days} giorni: −3% in apertura`) }
  if (fonte.ribassata_il || fonte.ribassi) { open -= 0.02; leve.push('Già ribassata senza offerte: −2%, il venditore ha mostrato il suo margine') }
  if (fonte.senza_catena || fonte.venditore_motivato) { open -= 0.02; leve.push('Venditore motivato / senza catena: −2%, vuole chiudere') }
  if (fonte.closing_date) { open += 0.03; leve.push('Closing date: c\'è concorrenza, apertura più vicina alla richiesta (+3%)') }
  const ask = mercato.portale?.scarto_vs_mediana_pct
  if (ask != null && ask > 10) { open -= 0.03; leve.push(`Chiesta ${signed(ask)}% sopra la mediana delle case simili in zona: −3%`) }
  if (ask != null && ask < -10) { open += 0.03; max = Math.max(max, 1.05); leve.push(`Chiesta ${signed(ask)}% sotto la mediana di zona: attesa concorrenza, apertura +3% e tetto non sotto +5%`) }
  const paid = mercato.venduti?.chiesto_vs_venduti_pct
  if (paid != null && paid > 15) { open -= 0.03; leve.push(`Chiesta ${signed(paid)}% sopra i prezzi realmente pagati vicino: −3%`) }
  if (paid != null && paid < -10) { max = Math.max(max, 1.05); leve.push(`Chiesta ${signed(paid)}% sotto i prezzi pagati vicino: vale spingere fino a +5%`) }
  if (mercato.uscite?.ritmo === 'veloce') { open += 0.02; leve.push('Mercato veloce in zona: +2% in apertura per non perdere la casa') }
  open = Math.max(0.85, Math.min(open, max))
  const apertura = k1(P * open), massima = k1(P * Math.max(open, max))
  const posizione = (ask ?? paid ?? 0) <= -10 ? 'sotto mercato' : (ask ?? paid ?? 0) >= 10 ? 'sopra mercato' : 'in linea col mercato'
  const indicatori = { posizione, offerta_apertura: apertura, offerta_massima: massima, apertura_pct: Math.round((open - 1) * 100), massima_pct: Math.round((Math.max(open, max) - 1) * 100), leve }
  lines.push("### 🎯 Strategia d'offerta (calcolo automatico)")
  lines.push(`- Apertura suggerita: **${fmtGBP(apertura, sym)}** (${signed(indicatori.apertura_pct)}%) · tetto: **${fmtGBP(massima, sym)}** (${signed(indicatori.massima_pct)}%)${isGBP ? ` → costo totale al tetto ≈ **${fmtGBP(massima + lbttOf(massima) + Math.round(massima * 0.08), '£')}**` : ''}`)
  for (const s of leve) lines.push(`  - ${s}`)
  if (isGBP) lines.push('- In Scozia l\'offerta passa dal tuo solicitor ed è vincolante una volta conclusa la "missive": fissa il tetto prima, non durante')
  lines.push('')

  const dossier = {
    casa: { indirizzo: l.addr, zona: l.zone, tipo: l.type, camere: l.rooms, bagni: l.baths, superficie_m2: l.size, prezzo: l.price, valuta: l.currency, caratteristiche: l.feats, vista_mare: !!l.seaView, nel_portale_dal: l.date },
    fonte, mercato, costi, indicatori,
  }
  const SYS = `Sei un consulente immobiliare indipendente che aiuta una coppia italiana a comprare una seconda casa sulla costa ${isGBP ? 'scozzese' : 'irlandese'}. Ricevi un dossier JSON: TUTTI i numeri sono già calcolati (comparabili, prezzi pagati, affitti, costi, strategia d'offerta), non inventarne e non ricalcolarli. Rispondi in italiano, 130-190 parole, markdown con esattamente 4 bullet: 1) verdetto secco (prezzo giusto / da trattare / da evitare, e perché in una frase), 2) come muoversi: usa offerta_apertura e offerta_massima del dossier e spiega quando fermarsi, 3) il rischio o la verifica che pesa di più (es. quota bassa, EPC, leasehold, mercato lento), 4) per chi ha senso questa casa (vacanze, trasferimento, investimento) o per chi no.`
  const verdict = await askAgent(SYS, dossier)
  const paidTxt = mercato.venduti?.mediana_stesso_tipo_gbp || mercato.venduti?.mediana_gbp
  sintesi.push(`**${fmtGBP(l.price, sym)}**${fonte.formula ? ` (${fonte.formula})` : ''} · **${posizione}**${mercato.portale ? ` · mediana chiesta in zona ${fmtEUR(mercato.portale.mediana_chiesta_eur)}` : ''}${paidTxt ? ` · venduti recenti £${paidTxt.toLocaleString('en-GB')}` : ''} · 🎯 apertura **${fmtGBP(apertura, sym)}**, tetto **${fmtGBP(massima, sym)}**${costi.totale_gbp ? ` · tutto incluso **£${costi.totale_gbp.toLocaleString('en-GB')}**` : ''}${mercato.affitti ? ` · resa lorda ${mercato.affitti.rendimento_lordo_pct}%` : ''}`, '')
  if (verdict) sintesi.push('### 🧠 In sintesi (agente)', verdict.trim(), '')
  else { sintesi.push('<!--VERDETTO_QUI-->', ''); copilotFallback(SYS, dossier) }
  dossierLines = ['<details><summary>📊 Dossier dati (per trasparenza)</summary>', '', '```json', JSON.stringify(dossier, null, 1), '```', '</details>', '']
}

lines.push('_Analisi automatica su fonti live — non è una perizia né consulenza fiscale._')
// With a TL;DR, the header stays, the summary leads, and every detailed
// section folds away — readable at a glance, complete on demand.
const outLines = sintesi.length
  ? [...lines.slice(0, 3), ...sintesi, '<details><summary>📋 Tutti i dettagli e gli indicatori</summary>', '', ...lines.slice(3), '</details>', '', ...dossierLines]
  : [...lines, ...dossierLines]
writeFileSync(ROOT + 'analisi-report.md', outLines.join('\n') + '\n')
out('status', 'ok')
