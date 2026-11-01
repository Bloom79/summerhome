// Gabetti (Gabetti L'Aquila 3, Via IV Novembre 8, Rocca di Mezzo, plus the
// Gabetti listings of Ovindoli and Rocca di Cambio). A Next.js site: every
// list page (/vendita/<comune>?page=N, 9 homes per page) and every detail page
// embeds the property objects as RSC JSON in self.__next_f.push chunks, with
// exact coordinates, bedrooms, floor, year, photos and (long) descriptions
// as "$hex" references to text chunks in the same payload. No publish date.
// A removed listing answers 404. robots.txt allows crawling (Nov 2026).

import { get, sleep, clip, num, typeOf, featsOf, energyOf, Gone } from '../lib.mjs'
import { zoneOf } from '../area.mjs'

const COMUNI = ['ovindoli', 'rocca-di-mezzo', 'rocca-di-cambio']
const BASE = 'https://www.gabetti.it'
const listUrl = (c, p) => `${BASE}/vendita/${c}${p > 1 ? `?page=${p}` : ''}`
const NOT_HOME = /\b(ufficio|negozio|box|garage|magazzino|capannone|laboratorio|terreno|locale commerciale|albergo)\b/i
const IMG_HOST = /^https:\/\/api\.gabettigroup\.com\/images-web\//

// All the RSC text chunks of a page, joined, and the "<hex>:T<len>," text blocks.
const payload = (html) => {
  let s = ''
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) { try { s += JSON.parse(m[1]) } catch { /* skip */ } }
  const refs = {}
  const b = Buffer.from(s, 'utf8')
  for (const m of s.matchAll(/(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/g)) {
    const start = Buffer.byteLength(s.slice(0, m.index + m[0].length), 'utf8')
    refs[m[1]] = b.subarray(start, start + parseInt(m[2], 16)).toString('utf8')
  }
  return { s, refs }
}

// Brace-matched JSON object starting at index i of s.
const objectAt = (s, i) => {
  let depth = 0, inStr = false
  for (let k = i; k < s.length; k++) {
    const c = s[k]
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(i, k + 1)) } catch { return null } }
  }
  return null
}
const propertiesOf = (html) => {
  const { s, refs } = payload(html)
  const out = new Map()
  for (const m of s.matchAll(/\{"id":"(\d+)","agencyId":\d+,"category":"vendita"/g)) {
    const p = objectAt(s, m.index)
    if (!p) continue
    const d = /^\$([0-9a-f]+)$/.exec(p.description || '')
    if (d) p.description = refs[d[1]] || ''
    out.set(p.id, p)
  }
  return { props: [...out.values()], pages: +((/"totalPages":(\d+)/.exec(s) || [])[1]) || 1 }
}

const normalise = (p) => {
  const f = p.features || {}
  const desc = p.description || ''
  const type = `${p.type || ''} ${p.typeSlug || ''}`
  if (!p.price || NOT_HOME.test(type)) return null
  const lead = desc.split(/\s[–-]\s/)[0].slice(0, 60) // descriptions open with the place: "Rovere – …"
  const z = zoneOf(+p.lat, +p.lon, `${p.address || ''} ${lead}`)
  if (!z) return null
  const feats = featsOf(`${type} ${desc}`)
  const add = (t) => { if (!feats.includes(t)) feats.push(t) }
  if (f.terraces > 0 || f.balconies > 0) add('Terrazzo')
  if (f.garden) add('Giardino')
  if (f.garage > 0) add('Garage')
  else if (f.parking_spaces > 0) add('Posto auto')
  if (f.basement_surface) add('Cantina')
  if (/autonomo/i.test(f.heating || '')) add('Riscaldamento autonomo')
  const ec = String(f.energy_class || '').toUpperCase()
  return {
    title: `${p.type || 'Immobile'} in vendita`,
    type: typeOf(type),
    price: p.price,
    size: Math.round(+p.squareMeters || +f.surface) || null,
    rooms: f.bedrooms > 0 ? f.bedrooms : null, // bedrooms, not "locali"
    baths: num(p.bathrooms || f.bathrooms),
    floor: f.floor ? String(f.floor) : null,
    year: f.year_of_construction > 1700 ? f.year_of_construction : null,
    energy: /^[A-G][1-4]?$/.test(ec) ? ec : energyOf(desc),
    addr: [String(p.address || '').replace(/\s+/g, ' ').trim(), z.town, z.zone].filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
    town: z.town,
    lat: +p.lat, lng: +p.lon, approx: false,
    imgs: (p.images || []).filter((u) => typeof u === 'string' && IMG_HOST.test(u)),
    feats, desc: clip(desc),
    date: null,
    url: `${BASE}/vendita/${p.citySlug}/${p.typeSlug}/${p.id}`,
  }
}

export default {
  id: 'gabetti',
  label: 'Gabetti',
  hosts: /^https:\/\/www\.gabetti\.it\//,
  imgHosts: /^https:\/\/api\.gabettigroup\.com\/images-web\//,
  async search() {
    const out = [], seen = new Set()
    for (const c of COMUNI) {
      let pages = 1
      for (let p = 1; p <= Math.min(pages, 5); p++) {
        let r
        try { r = propertiesOf(await get(listUrl(c, p))) } catch (e) { if (p === 1) throw e; break }
        pages = r.pages
        await sleep(1200)
        for (const prop of r.props) {
          if (seen.has(prop.id)) continue
          seen.add(prop.id)
          const n = normalise(prop)
          if (n) out.push(n)
        }
      }
    }
    return out
  },
  async verify(l) {
    try { return propertiesOf(await get(l.url)).props.length > 0 } catch (e) { if (e instanceof Gone) return false; throw e }
  },
}
