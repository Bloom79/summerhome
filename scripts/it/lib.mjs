// Shared helpers for the Altopiano delle Rocche pipeline (scripts/it/).
// Same fetching style as the UK scripts: curl via execFile, desktop Chrome UA.

import { execFile } from 'child_process'
import { appendFileSync } from 'fs'

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
export const TODAY = new Date().toISOString().slice(0, 10)

export const out = (k, v) => {
  console.log(`${k}=${v}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
}

// 404/410 reject with Gone (the listing is off the market); other failures
// reject with the HTTP code or curl exit code as the message.
export class Gone extends Error {}
const curl = (args, url) => new Promise((resolve, reject) =>
  execFile('curl', ['-s', '--compressed', '--max-time', '25', '-A', UA, ...args, '-w', '\n%{http_code}', url], { maxBuffer: 64e6 }, (e, so) => {
    if (e) return reject(new Error(`curl ${e.code}`))
    const s = so.toString(), i = s.lastIndexOf('\n'), code = +s.slice(i + 1)
    if (code === 404 || code === 410) return reject(new Gone(`HTTP ${code}`))
    if (!code || code >= 400) return reject(new Error(`HTTP ${code}`))
    resolve(s.slice(0, i))
  }))
export const get = (url, headers = {}) =>
  curl(Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), url)
export const getJSON = async (url, headers = {}) => JSON.parse(await get(url, { Accept: 'application/json', ...headers }))
export const postJSON = async (url, body, headers = {}) => JSON.parse(await curl([
  '-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json',
  ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), '--data', JSON.stringify(body),
], url))

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const pmap = async (items, fn, limit = 4) => {
  const res = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k], k) }
  }))
  return res
}

// ---- Geography ----
export const haversineM = (a, b) => {
  const R = 6371e3, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// ---- Text → structured fields (Italian listing wording) ----
export const clip = (s, n = 900) => {
  const t = String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n).replace(/\s\S*$/, '') + '…' : t
}

// Feature tags, matched on title + description. Names are the app's tag
// vocabulary (i18n FEATS has their English labels).
const FEAT_RULES = [
  ['Giardino', /\bgiardin|\bcorte (privata|esclusiva)|\bprato\b/i],
  ['Garage', /\bgarage\b|\bbox auto\b|\bautorimessa\b/i],
  ['Posto auto', /\bposto auto\b|\bposti auto\b/i],
  ['Camino', /\bcamin(o|etto)\b|\bstufa a (legna|pellet)\b/i],
  ['Terrazzo', /\bterrazz[oi]\b|\bbalcon[ei]\b/i],
  ['Cantina', /\bcantin[ae]\b|\btavern[ae]\b/i],
  ['Mansarda', /\bmansard/i],
  ['Arredato', /\barredat[oa]\b|\bcompletamente arredat|\bammobiliat/i],
  ['Riscaldamento autonomo', /\briscaldamento autonomo\b/i],
  ['Vista panoramica', /\bvista (panoramica|sulle montagne|sui monti|sul(la)? (velino|sirente|magnola|altopiano|piana))|\bpanoramic[oa]\b/i],
  ['Terreno', /\bterreno (di|circostante|annesso|agricolo)|\bettari\b|\bmq di terreno\b/i],
  ['Da ammodernare', /\bda ristrutturare\b|\bda ammodernare\b|\bda rimodernare\b|\bristrutturazione (totale|completa)\b/i],
]
export const featsOf = (text) => FEAT_RULES.filter(([, re]) => re.test(text || '')).map(([f]) => f)

// Property type → the app's type vocabulary (region.js `types`).
export const typeOf = (text) => {
  const s = String(text || '').toLowerCase()
  if (/baita|chalet/.test(s)) return 'Baita'
  if (/rustic|casale|cascina|masseria|fienile/.test(s)) return 'Rustico'
  if (/villetta a schiera|schiera|bifamiliare|trifamiliare/.test(s)) return 'Villetta a schiera'
  if (/villa\b|villino|villetta/.test(s)) return 'Villa'
  if (/casa indipendente|casa semindipendente|terratetto|casa di paese|casa singola|stabile|palazz/.test(s)) return 'Casa indipendente'
  // Auction wording: a whole "fabbricato" is a house, a unit or a
  // "porzione" inside one is a flat.
  if (/\bfabbricato\b/.test(s) && !/porzione|unit[aà] immobiliare|appartament|al piano (primo|secondo|terzo|quarto)/.test(s)) return 'Casa indipendente'
  return 'Appartamento' // monolocale, bilocale, attico, mansarda, loft…
}

// APE energy class (A4…G) from free text.
export const energyOf = (text) => {
  const m = /classe energetica[:\s]*([A-G][1-4]?)\b/i.exec(text || '') || /\bAPE[:\s]+([A-G][1-4]?)\b/.exec(text || '')
  return m ? m[1].toUpperCase() : null
}

export const num = (v) => {
  if (v == null) return null
  const n = +String(v).replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  return Number.isFinite(n) && n > 0 ? n : null
}
