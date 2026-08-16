// Quality gate for public/data.json — run before every publish (instant
// workflow and daily agent alike). Exits non-zero on any hard violation so
// bad data never reaches the portal. Also spot-checks a sample of the newest
// listings against their live source pages.
//
// Usage: node scripts/validate-data.mjs [--spot-check N]

import { readFileSync } from 'fs'
import { execFile } from 'child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const ROOT = new URL('..', import.meta.url).pathname
const SPOT = +(process.argv[process.argv.indexOf('--spot-check') + 1] || 0) || 0

const errors = []
const warn = []
const err = (m) => errors.push(m)

let db
try { db = JSON.parse(readFileSync(ROOT + 'public/data.json', 'utf8')) }
catch (e) { console.error('FATAL: data.json non leggibile:', e.message); process.exit(1) }

// ---- Structure ----
for (const k of ['updated', 'zones', 'features', 'sold', 'listings'])
  if (!(k in db)) err(`campo mancante: ${k}`)
if (!/^\d{4}-\d{2}-\d{2}$/.test(db.updated || '')) err(`updated non valido: ${db.updated}`)
if (!Array.isArray(db.zones) || db.zones.length < 6) err('zones: attese almeno le 6 di serie')
if (!Array.isArray(db.listings) || db.listings.length < 50)
  err(`listings sospettosamente pochi: ${db.listings?.length} (mai pubblicare un portale svuotato)`)

// ---- Per-listing invariants ----
const ids = new Set(), urls = new Set(), addrPrice = new Set()
const HOSTS = /^(https:\/\/www\.rightmove\.co\.uk\/|https:\/\/www\.myhome\.ie\/|https:\/\/www\.s1homes\.com\/|https:\/\/www\.onthemarket\.com\/|https:\/\/tspc\.co\.uk\/)/
const IMGHOSTS = /^(https:\/\/media\.rightmove\.co\.uk\/|https:\/\/photos-[a-z]\.propertyimages\.ie\/|https:\/\/cdn\.s1homes\.com\/|https:\/\/media\.onthemarket\.com\/|https:\/\/docs\.tspc\.co\.uk\/)/
const TYPES = new Set(['Casa indipendente', 'Cottage', 'Villa', 'Appartamento', 'Bungalow'])
const zoneCounts = {}
for (const l of db.listings || []) {
  const tag = `#${l.id} ${String(l.addr || '').slice(0, 40)}`
  if (!Number.isInteger(l.id) || ids.has(l.id)) err(`id mancante o duplicato: ${tag}`)
  ids.add(l.id)
  if (typeof l.price !== 'number' || l.price < 10000 || l.price > 20e6) err(`prezzo implausibile: ${tag} → ${l.price}`)
  if (!['EUR', 'GBP'].includes(l.currency)) err(`valuta non valida: ${tag}`)
  if ((l.currency === 'EUR') !== /myhome\.ie/.test(l.url || '')) warn.push(`valuta/portale incoerenti: ${tag}`)
  if (typeof l.lat !== 'number' || typeof l.lng !== 'number' ||
      l.lat < 49.5 || l.lat > 61.2 || l.lng < -11.5 || l.lng > 1.9)
    err(`coordinate fuori UK/Irlanda (finirebbe fuori mappa): ${tag} → ${l.lat},${l.lng}`)
  if (!l.url || !HOSTS.test(l.url)) err(`url sorgente mancante o host sconosciuto: ${tag}`)
  if (urls.has(l.url)) err(`url duplicato: ${tag}`)
  urls.add(l.url)
  if (!db.zones.includes(l.zone)) err(`zona non in ZONES: ${tag} → ${l.zone}`)
  if (!TYPES.has(l.type)) err(`tipo sconosciuto: ${tag} → ${l.type}`)
  if (!Array.isArray(l.imgs)) err(`imgs mancante: ${tag}`)
  else for (const im of l.imgs) if (!IMGHOSTS.test(im)) err(`foto da host sconosciuto: ${tag} → ${im.slice(0, 60)}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date || '')) err(`date non valida: ${tag}`)
  if (l.rooms != null && (l.rooms < 1 || l.rooms > 12)) warn.push(`camere implausibili (${l.rooms}): ${tag}`)
  if (l.date > db.updated) err(`date nel futuro rispetto a updated: ${tag}`)
  const key = `${String(l.addr).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)}|${l.price}`
  if (addrPrice.has(key)) warn.push(`possibile doppione indirizzo+prezzo: ${tag}`)
  addrPrice.add(key)
  zoneCounts[l.zone] = (zoneCounts[l.zone] || 0) + 1
}
for (const z of db.zones) if (!zoneCounts[z]) warn.push(`zona senza annunci: ${z}`)

// ---- Sold archive ----
for (const s of db.sold || [])
  if (!['sold', 'sale_agreed', 'removed'].includes(s.status)) err(`sold: status non valido (${s.status})`)

// ---- Live spot-check of the newest listings ----
if (SPOT > 0 && !errors.length) {
  const newest = [...db.listings].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, SPOT)
  const curl = (url) => new Promise((resolve) =>
    execFile('curl', ['-sf', '--max-time', '20', '-A', UA, url], { maxBuffer: 32e6 },
      (e, so) => resolve(e ? null : so.toString())))
  for (const l of newest) {
    const page = await curl(l.url)
    if (page == null) { warn.push(`spot-check: pagina non raggiungibile ora (${l.url})`); continue }
    const gone = /removed|no longer (available|on the market)/i.test(page.slice(0, 4000)) ||
      /^<title>\s*(Sold|Sale Agreed|Property Unavailable)/i.test(page)
    if (gone) err(`spot-check: l'annuncio risulta rimosso/venduto sul portale: ${l.url}`)
    else if (!page.includes(String(l.price)) && !page.includes(l.price.toLocaleString('en-GB')))
      warn.push(`spot-check: prezzo ${l.price} non trovato nella pagina (${l.url})`)
  }
}

console.log(`data.json: ${db.listings.length} annunci · ${db.zones.length} zone · ${db.sold.length} in archivio`)
console.log(`zone: ${Object.entries(zoneCounts).map(([z, n]) => `${z}=${n}`).join(' · ')}`)
if (warn.length) console.log(`⚠️  ${warn.length} avvisi:\n - ` + warn.slice(0, 15).join('\n - '))
if (errors.length) {
  console.error(`❌ ${errors.length} errori bloccanti:\n - ` + errors.slice(0, 25).join('\n - '))
  process.exit(1)
}
console.log('✅ validazione superata')
