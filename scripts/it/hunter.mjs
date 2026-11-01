// Cacciatore di occasioni — Altopiano delle Rocche. Run daily after the
// refresh (it-refresh.yml); runnable by hand: node scripts/it/hunter.mjs
//
// 1. Hard filter, no AI: independent houses only (no flats, no condominiums,
//    no residences), no bare ownership / timeshare / shares / building rights.
// 2. Score, no AI: €/m² against the comune's OMI range and against similar
//    houses on the plateau (after adding the cost of works when the ad says
//    it needs renovating), tracked price cuts, time on the market, private
//    seller, land, garden, garage, lifts, view. Auction lots are judged on
//    the price they usually fetch here (~79% of the base).
// 3. Claude reviews the shortlist (new or re-priced homes only; verdicts are
//    cached by url + price for 30 days): "vera occasione" / "interessante" /
//    "no", a fair price range, pros, cons, and what to ask the agency.
//    Without ANTHROPIC_API_KEY the deterministic picks are published alone.
//
// Writes public/it/hunter.json and hunter-report.md; $GITHUB_OUTPUT gets
// new_true (new "vera occasione" picks) and summary.

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { TODAY, out } from './lib.mjs'
import { AREA } from './area.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const DIR = ROOT + 'public/it/'
const db = JSON.parse(readFileSync(DIR + 'data.json', 'utf8'))
const prev = existsSync(DIR + 'hunter.json') ? JSON.parse(readFileSync(DIR + 'hunter.json', 'utf8')) : { picks: [], cache: {} }
const MODEL = 'claude-opus-5-5'
const SHORTLIST = 20
const RENO_EUR_M2 = 700 // full renovation of a mountain house, rough €/m² (finishes, systems, roof excluded)
const AUCTION_SOLD_PCT = 0.79 // median sold price / base on the plateau since 2020 (astegiudiziarie.it)
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)
const eur = (n) => '€' + Math.round(n).toLocaleString('it-IT')
const daysSince = (d) => Math.max(0, Math.round((new Date(TODAY) - new Date(d)) / 864e5))

// ---- 1. Hard filter ----
const HOUSE_TYPES = new Set(['Casa indipendente', 'Villa', 'Villetta a schiera', 'Baita', 'Rustico'])
const CONDO = /\bcondomin|\bspese condominiali|\bresidence\b|\bcomplesso residenziale|\bin palazzina|\bpalazzina di|\bappartament[oi] (al|posto al|sito al) piano/i
const LEGAL = /\bnuda propriet|\bmultipropriet|\bquota (di|del|pari)|\bdiritto di superficie|\busufrutto|\b1\/2 di propriet|\bpropriet[aà] (per|pari a) (1\/|il 50)/i
const text = (l) => `${l.title || ''} ${l.desc || ''}`
const eligible = db.listings.filter((l) => l.contract !== 'rent' && HOUSE_TYPES.has(l.type) &&
  !CONDO.test(text(l)) && !LEGAL.test(text(l)) && l.price >= 15000)

// ---- 2. Score ----
// Comparable €/m² of independent houses (not auctions), per zone and plateau-wide.
const unitOf = (l) => (l.size >= 30 ? l.price / l.size : null)
const comps = {}
for (const l of eligible) if (!l.feats.includes('Asta') && unitOf(l)) (comps[l.zone] ||= []).push(unitOf(l))
const allComps = Object.values(comps).flat()
const compMedian = (zone) => median((comps[zone] || []).length >= 5 ? comps[zone] : allComps)

const scored = eligible.map((l) => {
  const checks = [], flags = []
  const add = (k, pts, t) => checks.push({ k, pts: Math.round(pts), t })
  const isAuction = l.feats.includes('Asta')
  const reno = l.feats.includes('Da ammodernare')
  // The price a buyer will really pay: auctions usually close below the base.
  const price = isAuction ? l.price * AUCTION_SOLD_PCT : l.price
  const unit = l.size >= 30 ? price / l.size : null
  const effUnit = unit && reno ? unit + RENO_EUR_M2 : null
  const u = effUnit || unit
  const omi = Array.isArray(l.omi) ? l.omi : AREA.omi[l.zone]?.villini || null
  const cm = compMedian(l.zone)
  if (u && omi) {
    const below = (omi[0] - u) / omi[0]
    if (below > 0) add('omi', Math.min(below, 0.5) / 0.5 * 35, `${eur(u)}/m²${effUnit ? ' con i lavori' : ''}: ${Math.round(below * 100)}% sotto il minimo OMI (${eur(omi[0])})`)
  }
  if (u && cm) {
    const below = (cm - u) / cm
    if (below >= 0.1) add('comps', Math.min(below, 0.5) / 0.5 * 25, `${Math.round(below * 100)}% sotto la mediana delle case simili (${eur(cm)}/m²)`)
  }
  if (Array.isArray(l.hist) && l.hist.length > 1 && l.hist[0].p > l.price) {
    const cut = (l.hist[0].p - l.price) / l.hist[0].p
    add('cuts', Math.min(cut, 0.2) / 0.2 * 15, `prezzo ridotto del ${Math.round(cut * 100)}% da ${eur(l.hist[0].p)}`)
  }
  const dd = daysSince(l.date)
  if (dd >= 90) add('days', dd >= 240 ? 5 : 3, `in vendita da ${dd} giorni: margine di trattativa`)
  if (l.feats.includes('Privato')) add('private', 5, 'venditore privato: niente provvigione d\'agenzia')
  if (l.feats.includes('Terreno')) add('land', 6, 'con terreno')
  else if (l.feats.includes('Giardino')) add('garden', 4, 'con giardino')
  if (l.feats.includes('Garage')) add('garage', 3, 'con garage')
  if (l.feats.includes('Vicino piste')) add('ski', 3, `a ${(l.ski?.m / 1000).toFixed(1)} km dagli impianti`)
  if (l.feats.includes('Vista panoramica')) add('view', 2, 'vista panoramica')
  if (reno) flags.push(`Da ristrutturare: lavori stimati ~${eur(RENO_EUR_M2 * (l.size || 80))} (${RENO_EUR_M2} €/m², stima grezza)`)
  if (isAuction) flags.push(`Asta: base ${eur(l.price)}${l.minOffer ? `, offerta minima ${eur(l.minOffer)}` : ''}; qui si aggiudica in media al ~79% della base`)
  if (!l.size) flags.push('Superficie non indicata: confronto di prezzo impossibile')
  if (l.approx) flags.push('Posizione approssimativa (centro della frazione)')
  const score = Math.min(100, checks.reduce((s, c) => s + c.pts, 0))
  return { l, score, unit: unit && Math.round(unit), effUnit: effUnit && Math.round(effUnit), omi, comps: cm && Math.round(cm), checks, flags }
})

// A real price signal is required (OMI, comps or a cut), not just features.
const priceSignal = (s) => s.checks.some((c) => ['omi', 'comps', 'cuts'].includes(c.k))
const short = scored.filter((s) => priceSignal(s) && s.score >= 25).sort((a, b) => b.score - a.score).slice(0, SHORTLIST)
console.log(`cacciatore: ${db.listings.length} annunci → ${eligible.length} case indipendenti → ${short.length} in lista`)

// ---- 3. Claude review ----
const cache = { ...(prev.cache || {}) }
const key = (l) => `${l.url}|${l.price}`
const fresh = (v) => v && daysSince(v.date) <= 30
const toReview = short.filter((s) => !fresh(cache[key(s.l)]))

const SYSTEM = `Sei un consulente immobiliare che lavora per un acquirente, non per chi vende. Conosci a fondo l'Altopiano delle Rocche in Abruzzo (Ovindoli, Rocca di Mezzo, Rocca di Cambio e frazioni: Santa Jona, San Potito, Rovere, Terranera, Fontavignone, Campo Felice), un mercato di seconde case a 1.300 m con gli impianti di Monte Magnola e Campo Felice, a circa 1h30 da Roma. Conosci bene come funziona: tanti appartamenti in residence anni '70-'80, poche case indipendenti; inverni nevosi (accesso, tetti, isolamento e riscaldamento contano: legna, GPL, metano non ovunque); molte case da ristrutturare; agenzie che spesso gonfiano i prezzi rispetto alle quotazioni OMI.

L'acquirente cerca una CASA INDIPENDENTE (niente condominio, niente appartamento in residence o palazzina) a un prezzo davvero buono. Per ogni annuncio decidi:
- "vera occasione": il costo totale (prezzo + lavori necessari) è chiaramente sotto il valore di mercato di una casa indipendente comparabile, e non ci sono segnali gravi;
- "interessante": vale una visita o una trattativa, ma il prezzo non è eccezionale o mancano informazioni importanti;
- "no": prezzo in linea o alto, oppure è in realtà un appartamento/condominio, una quota, una multiproprietà, un rudere senza titoli, o ha altri problemi seri.

Regole:
- Sii scettico: "vera occasione" deve essere raro. Le parole del venditore ("affare", "occasione") non contano.
- Usa solo i dati che ti do; non inventare fatti sulla casa. Se la descrizione è ambigua, dillo e mettilo nelle domande.
- Le quotazioni OMI sono per stato "normale": una casa da ristrutturare vale meno, una ristrutturata può valere un po' di più del massimo.
- Per le aste il prezzo indicato è la base; qui si aggiudica in media al 79% della base, ma servono perizia, liberazione e tempi.
- "fair_min"/"fair_max": la tua stima in euro del prezzo giusto per QUESTA casa nel suo stato, come numeri interi; usa 0 e 0 se non hai abbastanza dati.
- "is_condominio": true se dalla descrizione risulta un appartamento in condominio, residence o palazzina anche se il tipo dice altro.
- Scrivi in italiano, frasi brevi e concrete. "why" in 2-3 frasi; "pro" e "contro" con 2-4 punti ciascuno; "domande": 3 domande precise da fare all'agenzia o al venditore prima di visitarla.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'verdict', 'is_condominio', 'fair_min', 'fair_max', 'why', 'pro', 'contro', 'domande'],
        properties: {
          id: { type: 'integer' },
          verdict: { type: 'string', enum: ['vera occasione', 'interessante', 'no'] },
          is_condominio: { type: 'boolean' },
          fair_min: { type: 'integer' },
          fair_max: { type: 'integer' },
          why: { type: 'string' },
          pro: { type: 'array', items: { type: 'string' } },
          contro: { type: 'array', items: { type: 'string' } },
          domande: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

const dossier = (s) => {
  const l = s.l
  return {
    id: l.id, tipo: l.type, comune: l.zone, frazione: l.town, indirizzo: l.addr,
    prezzo: l.price, superficie_m2: l.size || null, camere: l.rooms || null, bagni: l.baths || null,
    anno: l.year || null, classe_energetica: l.energy || null, piano: l.floor || null,
    eur_m2: s.unit, eur_m2_con_lavori: s.effUnit, omi_villini_eur_m2: s.omi, mediana_case_simili_eur_m2: s.comps,
    storico_prezzi: l.hist || null, in_vendita_da_giorni: daysSince(l.date),
    venditore_privato: l.feats.includes('Privato'), asta: l.feats.includes('Asta') ? { data: l.auction, offerta_minima: l.minOffer || null } : null,
    caratteristiche: l.feats, impianti_sci_m: l.ski?.m ?? null, auto_da_roma_min: l.travel?.min ?? null,
    segnali_calcolati: s.checks.map((c) => c.t), avvertenze: s.flags,
    fonte: new URL(l.url).host, descrizione: l.desc || '',
  }
}

// Raw HTTP through curl, like the other scripts here: the pipeline runs
// with plain `node`, no npm install. The body goes through stdin.
const callClaude = (body) => new Promise((resolve, reject) => {
  const p = execFile('curl', ['-sS', '--max-time', '600', 'https://api.anthropic.com/v1/messages',
    '-H', `x-api-key: ${process.env.ANTHROPIC_API_KEY}`, '-H', 'anthropic-version: 2023-06-01',
    // Server-side fallback if a request is ever declined (routes by refusal category).
    '-H', 'anthropic-beta: server-side-fallback-2026-07-01',
    '-H', 'content-type: application/json', '--data-binary', '@-'], { maxBuffer: 32e6 },
  (e, so) => {
    if (e) return reject(new Error(`curl ${e.code}`))
    try { resolve(JSON.parse(so.toString())) } catch { reject(new Error('risposta non JSON')) }
  })
  p.stdin.end(JSON.stringify(body))
})

// The repo's GitHub Copilot subscription (secret G_COPILOT) already runs the
// UK live analysis with Claude: same route here when there is no API key.
// No structured outputs there, so the JSON is asked for and validated.
const COPILOT_MODELS = ['claude-opus-5.5', 'claude-opus-5', 'auto']
const runCopilot = (prompt, model) => new Promise((resolve, reject) =>
  execFile('copilot', ['-p', prompt, '--model', model], { maxBuffer: 32e6, timeout: 600e3 },
    (e, so, se) => (e ? reject(new Error(String(se || e.message).slice(0, 200))) : resolve(so.toString()))))
let copilotModel = null
const callCopilot = async (prompt) => {
  for (const m of copilotModel ? [copilotModel] : COPILOT_MODELS) {
    try { const txt = await runCopilot(prompt, m); copilotModel = m; return txt } catch (e) { console.log(`cacciatore: copilot ${m} non disponibile (${e.message.split('\n')[0]})`) }
  }
  throw new Error('nessun modello Copilot disponibile')
}
const extractJson = (txt) => {
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}')
  return a >= 0 && b > a ? JSON.parse(txt.slice(a, b + 1)) : null
}
const validResult = (v) => v && Number.isInteger(v.id) && ['vera occasione', 'interessante', 'no'].includes(v.verdict) &&
  typeof v.why === 'string' && ['pro', 'contro', 'domande'].every((k) => Array.isArray(v[k]))

// Claude Code on the owner's Mac (their Claude plan, no API key): headless,
// no tools, no MCP, our own system prompt, schema-validated JSON back. Run
// by tools/hunter-relay.sh after the morning refresh.
const runClaudeCli = (ask) => new Promise((resolve, reject) =>
  execFile('claude', ['-p', ask, '--model', MODEL, '--system-prompt', SYSTEM, '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA), '--tools', '', '--strict-mcp-config', '--no-session-persistence'],
  { maxBuffer: 32e6, timeout: 900e3, cwd: tmpdir() }, (e, so, se) => {
    if (e) return reject(new Error(String(se || e.message).slice(0, 200)))
    try {
      const j = JSON.parse(so.toString())
      if (j.is_error || !j.structured_output) return reject(new Error(`claude: ${j.subtype || 'nessun risultato strutturato'}`))
      resolve(j)
    } catch { reject(new Error('claude: output non JSON')) }
  }))

const backend = process.env.HUNTER_LLM === 'off' ? null
  : process.env.HUNTER_LLM === 'claude' ? 'claude'
  : process.env.ANTHROPIC_API_KEY ? 'api'
  : process.env.COPILOT_GITHUB_TOKEN || process.env.HUNTER_LLM === 'copilot' ? 'copilot' : null
let reviewed = 0, cost = 0
if (backend && toReview.length) {
  const context = {
    oggi: TODAY,
    omi_per_comune: AREA.omi,
    mediana_case_indipendenti_eur_m2: Object.fromEntries(Object.entries(comps).map(([z, a]) => [z, Math.round(median(a))])),
    storico_aste_altopiano: 'dal 2020: 157 tentativi su 71 immobili, 57% deserti, aggiudicati in media al 79% della base, di solito al 2° tentativo',
  }
  for (let i = 0; i < toReview.length; i += 8) {
    const chunk = toReview.slice(i, i + 8)
    const ask = `Contesto del mercato:\n${JSON.stringify(context)}\n\nValuta questi ${chunk.length} annunci (rispondi per ognuno, con il suo id):\n${JSON.stringify(chunk.map(dossier))}`
    let parsed
    if (backend === 'api') {
      let r
      try {
        r = await callClaude({
          model: MODEL,
          max_tokens: 16000,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
          fallbacks: 'default',
          messages: [{ role: 'user', content: ask }],
        })
      } catch (e) { console.log(`cacciatore: chiamata fallita (${e.message}), riprovo domani`); continue }
      if (r.type === 'error') { console.log(`cacciatore: errore API ${r.error?.type}: ${r.error?.message}`); continue }
      if (r.stop_reason !== 'end_turn') { console.log(`cacciatore: risposta incompleta (${r.stop_reason})`); continue }
      const u = r.usage || {}
      cost += ((u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) * 1.25 + (u.cache_read_input_tokens || 0) * 0.1) * 4e-6 + (u.output_tokens || 0) * 20e-6
      try { parsed = JSON.parse(r.content.find((b) => b.type === 'text')?.text || '') } catch { console.log('cacciatore: JSON non valido'); continue }
    } else if (backend === 'claude') {
      try {
        const j = await runClaudeCli(ask)
        parsed = j.structured_output
        cost += j.total_cost_usd || 0 // list-price equivalent; billed to the Claude plan
      } catch (e) { console.log(`cacciatore: Claude Code fallito (${e.message}), riprovo domani`); break }
    } else {
      const prompt = `${SYSTEM}\n\nRispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza usare strumenti, con questa forma:\n{"results":[{"id":123,"verdict":"vera occasione|interessante|no","is_condominio":false,"fair_min":70000,"fair_max":85000,"why":"…","pro":["…"],"contro":["…"],"domande":["…","…","…"]}]}\n\n${ask}`
      try { parsed = extractJson(await callCopilot(prompt)) } catch (e) { console.log(`cacciatore: Copilot fallito (${e.message}), riprovo domani`); break }
      if (!parsed) { console.log('cacciatore: Copilot non ha restituito JSON'); continue }
    }
    for (const v of (parsed.results || []).filter(validResult)) {
      const s = chunk.find((x) => x.l.id === v.id)
      if (!s) continue
      cache[key(s.l)] = {
        verdict: v.is_condominio ? 'no' : v.verdict,
        condo: v.is_condominio,
        fair: v.fair_min > 0 && v.fair_max >= v.fair_min ? [v.fair_min, v.fair_max] : null,
        why: v.why, pro: v.pro, contro: v.contro, domande: v.domande, date: TODAY,
      }
      reviewed++
    }
  }
}
// Forget verdicts for homes no longer listed (or re-priced).
const liveKeys = new Set(db.listings.map(key))
for (const k of Object.keys(cache)) if (!liveKeys.has(k)) delete cache[k]

// ---- 4. Publish ----
const RANK = { 'vera occasione': 0, interessante: 1, null: 2, no: 3 }
const picks = short.map((s) => {
  const v = cache[key(s.l)] || null
  return {
    id: s.l.id, url: s.l.url, score: s.score, unit: s.unit, effUnit: s.effUnit, omi: s.omi, comps: s.comps,
    checks: s.checks, flags: s.flags,
    ai: v && { verdict: v.verdict, fair: v.fair, why: v.why, pro: v.pro, contro: v.contro, domande: v.domande, date: v.date },
  }
}).sort((a, b) => RANK[a.ai?.verdict ?? 'null'] - RANK[b.ai?.verdict ?? 'null'] || b.score - a.score)

const prevTrue = new Set((prev.picks || []).filter((p) => p.ai?.verdict === 'vera occasione').map((p) => p.url))
const newTrue = picks.filter((p) => p.ai?.verdict === 'vera occasione' && !prevTrue.has(p.url))
writeFileSync(DIR + 'hunter.json', JSON.stringify({
  updated: TODAY, model: backend === 'api' || backend === 'claude' ? MODEL : backend === 'copilot' ? `copilot:${copilotModel || 'n/d'}` : null,
  stats: { eligible: eligible.length, shortlisted: short.length, reviewed }, picks, cache,
}))

const byId = new Map(db.listings.map((l) => [l.id, l]))
const line = (p) => {
  const l = byId.get(p.id)
  return `- ${p.ai ? `**${p.ai.verdict}**` : '_da valutare_'} · ${l.type} ${l.town} — ${eur(l.price)}${l.size ? `, ${l.size} m²` : ''} · punti ${p.score}${p.ai?.fair ? ` · prezzo giusto ${eur(p.ai.fair[0])}–${eur(p.ai.fair[1])}` : ''}\n  ${p.ai?.why || p.checks.map((c) => c.t).join('; ')}\n  ${l.url}`
}
writeFileSync(ROOT + 'hunter-report.md', [
  `# 🎯 Cacciatore Altopiano ${TODAY}`, '',
  `${eligible.length} case indipendenti su ${db.listings.length} annunci; ${short.length} in lista; ${reviewed} valutate oggi da Claude${cost ? ` (~$${cost.toFixed(2)})` : ''}.`, '',
  ...(newTrue.length ? ['## Nuove vere occasioni', '', ...newTrue.map(line), ''] : []),
  '## Lista completa', '', ...picks.filter((p) => p.ai?.verdict !== 'no').map(line),
].join('\n') + '\n')

console.log(`cacciatore: ${reviewed} valutate da Claude${cost ? ` (~$${cost.toFixed(2)})` : ''}; vere occasioni: ${picks.filter((p) => p.ai?.verdict === 'vera occasione').length} (${newTrue.length} nuove)`)
out('new_true', newTrue.length)
out('summary', `${short.length} in lista, ${picks.filter((p) => p.ai?.verdict === 'vera occasione').length} vere occasioni (${newTrue.length} nuove)`)
