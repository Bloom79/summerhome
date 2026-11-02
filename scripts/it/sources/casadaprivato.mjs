// CasaDaPrivato.it (owner-direct portal, no agency fees). The search page per
// comune (/annunci-vendita/immobili/aquila-<comune>) lists the homes as
// "item" cards that link to a detail page; the detail page has a "DATI
// PRINCIPALI" definition list (type, m², locali, bagni, floor, energy class,
// price) and "Aggiornato al <date>". Coordinates exist only on some pages
// (data-position-latitude); otherwise we place the home at the frazione or
// comune named in its title and mark it approx. The search also lists homes of
// neighbouring comuni ("a 5 km da Rocca di Cambio"); those are dropped.
// Many private ads have no price (trattabile): skipped. A removed listing
// answers 404. robots.txt allows crawling (Disallow: /handler/ only, Nov 2026).

import { get, sleep, clip, num, typeOf, featsOf, energyOf, Gone } from '../lib.mjs'

const BASE = 'https://www.casadaprivato.it'
const COMUNI = ['ovindoli', 'rocca_di_mezzo']
const MAX_DETAILS = 30
const NOT_HOME = /\b(terren[oi]|garage|box|posto auto|negozio|ufficio|magazzino|capannone|locale commerciale|laboratorio|fabbricato rurale)\b/i
const MONTHS = { gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12 }

const ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€', middot: '·', agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù' }
const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z0-9]+);/gi, (m, n) => ENT[n] ?? m)
const text = (html) => decode(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')

// Frazioni first (longest name first), then the bare comune, from the title
// ("… da Privato a Rocca di Mezzo, Frazione Rovere, Via …") and the address.
const locate = (area, where) => {
  const t = ` ${norm(where)} `
  const has = (name) => t.includes(` ${norm(name)} `)
  const places = [...area.places].sort((a, b) => b.name.length - a.name.length)
  const isComune = (p) => p.name === p.comune
  const hit = places.find((p) => !isComune(p) && has(p.name)) || places.find((p) => isComune(p) && has(p.name))
  return hit ? { lat: hit.lat, lng: hit.lng, town: hit.name, zone: hit.comune } : null
}

const dl = (html) => {
  const o = {}
  for (const m of html.matchAll(/<dt[^>]*>([^<]*)<\/dt>\s*<dd[^>]*>([^<]*)/g)) o[text(m[1]).toLowerCase()] = text(m[2])
  return o
}

const normalise = (html, url, area) => {
  const d = dl(html)
  if (!/vendita/i.test(d.contratto || '')) return null
  const h1 = text((/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || [])[1])
  const sub = text((/<h1[\s\S]*?<\/h1>\s*<span>([\s\S]*?)<\/span>/i.exec(html) || [])[1])
  const tip = d.tipologia || ''
  const price = num((d.prezzo || '').replace(/,00$/, '')) || num((/Privato Vende\s*<span>\s*&euro;\s*([\d.]+)/i.exec(html) || [])[1])
  const dm = /<div class="text-justify[^"]*">([\s\S]*?)<\/div>/i.exec(html)
  const desc = text(dm && dm[1])
  const title = text((/<h2 class="desc-headline">([^<]*)<\/h2>\s*<strong>([^<]*)/i.exec(html) || [])[2]) || h1
  if (!price || NOT_HOME.test(`${tip} ${h1}`)) return null

  // The page's own place wins over a neighbour named in free text: title + address only.
  const loc = locate(area, `${h1} ${sub}`)
  if (!loc) return null
  const pos = /data-position-latitude="([\d.]+)"\s+data-position-longitude="([\d.]+)"/.exec(html)
  const exact = pos && +pos[1] >= area.bounds.minLat && +pos[1] <= area.bounds.maxLat && +pos[2] >= area.bounds.minLng && +pos[2] <= area.bounds.maxLng
  const dt = /Aggiornato al (\d{1,2}) ([a-z]{3}) (\d{4})/i.exec(html)
  const date = dt && MONTHS[dt[2].toLowerCase()] ? `${dt[3]}-${String(MONTHS[dt[2].toLowerCase()]).padStart(2, '0')}-${dt[1].padStart(2, '0')}` : null
  const energy = (d['classe energetica'] || '').toUpperCase()
  const all = `${h1} ${tip} ${desc}`
  const street = (/in vendita a [^,]+(?:,\s*Frazione [^,]+)?,\s*(.+?)\s*$/i.exec(h1) || [])[1]
  const via = street && !/^frazione /i.test(street) ? street : ''

  return {
    title: h1 ? h1.replace(/ da Privato /i, ' ').replace(/\s+/g, ' ') : `${tip} in vendita`,
    type: /^(appartamento|bilocale|trilocale|quadrilocale|attico|mansarda|monolocale)/i.test(tip) ? 'Appartamento' : typeOf(`${tip} ${h1} ${desc}`),
    price,
    size: num(d.superficie),
    rooms: null, // the site gives "locali", not bedrooms
    baths: num(d.bagni),
    floor: d.piano || null,
    energy: /^[A-G][1-4]?$/.test(energy) ? energy : energyOf(desc),
    addr: [via, loc.town, loc.zone].filter((v, i, a) => v && a.indexOf(v) === i).join(', '),
    town: loc.town,
    lat: exact ? +pos[1] : loc.lat, lng: exact ? +pos[2] : loc.lng, approx: !exact,
    imgs: [...new Set([...html.matchAll(/https:\/\/static\.casadaprivato\.it\/images\/properties\/largethumbs\/(\d+)\/[a-f0-9]+\.jpg/g)].filter((m) => url.endsWith(`-${m[1]}`)).map((m) => m[0]))],
    feats: [...featsOf(all), 'Privato'], // owner-direct portal: every ad is a private seller
    desc: clip(desc),
    date,
    url,
  }
}

export default {
  id: 'casadaprivato',
  label: 'CasaDaPrivato',
  hosts: /^https:\/\/www\.casadaprivato\.it\//,
  imgHosts: /^https:\/\/static\.casadaprivato\.it\/images\/properties\//,
  async search(area) {
    const links = []
    for (const c of COMUNI) {
      const html = await get(`${BASE}/annunci-vendita/immobili/aquila-${c}`)
      await sleep(1200)
      for (const m of html.matchAll(/<div class="item col-md-12">[\s\S]*?<a href="(\/[a-z-]+\/[^"]+-\d+)"[\s\S]*?<small class="subtitle">([^<]*)/g)) {
        if (/ da \d+ km /i.test(m[2]) || /&middot; a \d+ km/i.test(m[2])) continue // neighbouring comune
        const url = BASE + m[1]
        if (!links.includes(url)) links.push(url)
      }
    }
    const out = []
    for (const url of links.slice(0, MAX_DETAILS)) {
      try {
        const n = normalise(await get(url), url, area)
        if (n) out.push(n)
      } catch { /* removed meanwhile, or a flaky page: retried tomorrow */ }
      await sleep(1200)
    }
    return out
  },
  async verify(l) {
    try {
      const d = dl(await get(l.url))
      return /vendita/i.test(d.contratto || '')
    } catch (e) { if (e instanceof Gone) return false; throw e }
  },
}
