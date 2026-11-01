// Quality gate for public/it/data.json, run before every publish: bad data
// never goes live (a failed check keeps the previously deployed site).
// Hosts allowed for listing and photo urls come from the source adapters.

import { readFileSync } from 'fs'
import { AREA } from './area.mjs'
import { SOURCES } from './sources/index.mjs'

const ROOT = new URL('../../', import.meta.url).pathname
const errors = [], warn = []
const err = (m) => errors.push(m)

let db
try { db = JSON.parse(readFileSync(ROOT + 'public/it/data.json', 'utf8')) }
catch (e) { console.error('FATAL: it/data.json non leggibile:', e.message); process.exit(1) }

for (const k of ['updated', 'zones', 'features', 'sold', 'listings'])
  if (!(k in db)) err(`campo mancante: ${k}`)
if (!/^\d{4}-\d{2}-\d{2}$/.test(db.updated || '')) err(`updated non valido: ${db.updated}`)
if (!Array.isArray(db.listings) || db.listings.length < 10)
  err(`listings sospettosamente pochi: ${db.listings?.length} (mai pubblicare un portale svuotato)`)

const TYPES = new Set(['Appartamento', 'Casa indipendente', 'Villa', 'Villetta a schiera', 'Baita', 'Rustico'])
const srcById = Object.fromEntries(SOURCES.map((s) => [s.id, s]))
const b = AREA.bounds
const ids = new Set(), urls = new Set(), zoneCounts = {}
for (const l of db.listings || []) {
  const tag = `#${l.id} ${String(l.addr || '').slice(0, 40)}`
  if (!Number.isInteger(l.id) || l.id <= 1_000_000 || ids.has(l.id)) err(`id mancante, fuori range o duplicato: ${tag}`)
  ids.add(l.id)
  if (typeof l.price !== 'number' || l.price < 10000 || l.price > 5e6) err(`prezzo implausibile: ${tag} → ${l.price}`)
  if (l.currency !== 'EUR' || l.country !== 'IT') err(`valuta/paese non validi: ${tag}`)
  if (!(l.lat >= b.minLat && l.lat <= b.maxLat && l.lng >= b.minLng && l.lng <= b.maxLng))
    err(`coordinate fuori dall'altopiano: ${tag} → ${l.lat},${l.lng}`)
  const src = srcById[l.src]
  if (!src) err(`sorgente sconosciuta: ${tag} → ${l.src}`)
  else {
    if (!src.hosts.test(l.url || '')) err(`url fuori dagli host di ${l.src}: ${tag} → ${l.url}`)
    for (const im of l.imgs || []) if (!src.imgHosts.test(im)) err(`foto da host sconosciuto: ${tag} → ${im.slice(0, 70)}`)
  }
  if (urls.has(l.url)) err(`url duplicato: ${tag}`)
  urls.add(l.url)
  if (!db.zones.includes(l.zone)) err(`zona non in zones: ${tag} → ${l.zone}`)
  if (!TYPES.has(l.type)) err(`tipo sconosciuto: ${tag} → ${l.type}`)
  if (!Array.isArray(l.imgs)) err(`imgs mancante: ${tag}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l.date || '') || l.date > db.updated) err(`date non valida: ${tag}`)
  if (l.rooms != null && (l.rooms < 1 || l.rooms > 15)) warn.push(`locali implausibili (${l.rooms}): ${tag}`)
  if (l.size != null && (l.size < 15 || l.size > 2000)) warn.push(`superficie implausibile (${l.size}): ${tag}`)
  zoneCounts[l.zone] = (zoneCounts[l.zone] || 0) + 1
}
for (const s of db.sold || [])
  if (!['sold', 'sale_agreed', 'removed'].includes(s.status)) err(`sold: status non valido (${s.status})`)

console.log(`it/data.json: ${db.listings.length} annunci · ${db.sold.length} in archivio`)
console.log(`zone: ${Object.entries(zoneCounts).map(([z, n]) => `${z}=${n}`).join(' · ')}`)
if (warn.length) console.log(`⚠️  ${warn.length} avvisi:\n - ` + warn.slice(0, 15).join('\n - '))
if (errors.length) {
  console.error(`❌ ${errors.length} errori bloccanti:\n - ` + errors.slice(0, 25).join('\n - '))
  process.exit(1)
}
console.log('✅ validazione superata')
