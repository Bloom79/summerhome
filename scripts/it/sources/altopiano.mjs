// Altopiano Immobiliare (Piazza Principe di Piemonte 2, Rocca di Mezzo).
// A small PHP site: the sales list (index.php?pagina=immobili&categoria=
// Vendite) links one detail page per home, "NNN-Vendita residenziale-
// <title>.html". The pages are declared iso-8859-1 but carry accents as HTML
// entities or raw latin1 bytes, so we read them as latin1 and decode both.
// No coordinates (the map LatLng is empty): we place each home at the frazione or comune named in its title/zone and mark it approx.
// An unknown or withdrawn id still answers 200, with a page that has no
// characteristics table. robots.txt is a 404, i.e. no restrictions (Nov 2026).

import { execFile } from 'child_process'
import { UA, sleep, clip, num, typeOf, featsOf, energyOf, Gone } from '../lib.mjs'

// lib `get` decodes bodies as UTF-8, which turns this site's latin1 accents
// into U+FFFD. Same curl call (UA, timeout, 404/410 -> Gone), decoded latin1.
const get = (url) => new Promise((resolve, reject) =>
  execFile('curl', ['-s', '--compressed', '--max-time', '25', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 64e6, encoding: 'latin1' }, (e, so) => {
    if (e) return reject(new Error(`curl ${e.code}`))
    const i = so.lastIndexOf('\n'), code = +so.slice(i + 1)
    if (code === 404 || code === 410) return reject(new Gone(`HTTP ${code}`))
    if (!code || code >= 400) return reject(new Error(`HTTP ${code}`))
    resolve(so.slice(0, i))
  }))

const BASE = 'https://www.altopianoimmobiliare.it/'
const LIST = `${BASE}index.php?pagina=immobili&categoria=Vendite`
const MAX_DETAILS = 28
const NOT_HOME = /\b(magazzino|negozio|ufficio|capannone|terreno|terreni|locale commerciale|laboratorio|albergo|alberghier\w*|hotel)\b/i
const NOT_HOME_TIP = /\b(garage|box|posto auto|autorimessa)\b/i // only the stated type: "…con garage" in a title is a home

const NAMED_ENT = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', euro: '€', agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', Agrave: 'À', Egrave: 'È', Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù', ordm: 'º', deg: '°', sup2: '²', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' }
const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&([a-z0-9]+);/gi, (m, n) => NAMED_ENT[n] ?? m)
const text = (html) => decode(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ')

// "Label:</strong> … <span>value</span>" rows of the characteristics table.
const field = (html, label) => {
  const re = new RegExp(`${label}:\\s*</strong>[\\s\\S]*?<span[^>]*>([\\s\\S]*?)</span>`, 'i')
  const m = re.exec(html)
  return m ? text(m[1]) : ''
}

const WORDS = { un: 1, uno: 1, due: 2, doppio: 2, doppi: 2, tre: 3, quattro: 4, cinque: 5 }
const bathsOf = (s) => {
  const m = /\b(\d|un|uno|due|tre|quattro|cinque)\s+bagn[io]\b/i.exec(s) || /\b(doppio) bagno\b/i.exec(s) || /\b(doppi) servizi\b/i.exec(s)
  if (m) return WORDS[m[1].toLowerCase()] || +m[1] || null
  return /\bbagno\b/i.test(s) ? 1 : null
}

// Frazioni first (longest name first), then places named like their comune,
// then the bare comune. `where` is title + zone + address, not the long
// description, which mentions neighbours.
const locate = (area, where) => {
  const t = ` ${norm(where)} `
  const has = (name) => t.includes(` ${norm(name)} `)
  const places = [...area.places].sort((a, b) => b.name.length - a.name.length)
  const isComune = (p) => p.name === p.comune
  const hit = places.find((p) => !isComune(p) && has(p.name)) || places.find((p) => isComune(p) && has(p.name))
  if (hit) return { lat: hit.lat, lng: hit.lng, town: hit.name, comune: hit.comune }
  const c = area.comuni.find((x) => has(x.name))
  return c ? { lat: c.lat, lng: c.lng, town: c.name, comune: c.name } : null
}

const images = (html) => {
  const seen = new Set()
  for (const m of html.matchAll(/pannello\/fotoannunci\/([^"'\s<>)]+?\.(?:jpe?g|png))/gi)) seen.add(m[1])
  return [...seen].map((f) => BASE + 'pannello/fotoannunci/' + encodeURI(decode(f)))
}

const normalise = (html, url, area) => {
  const tip = field(html, 'Tipologia')
  const zona = field(html, 'Citt(?:à|&agrave;|&#224;|a)/Zona')
  const via = field(html, 'Indirizzo')
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  const title = text(h1 && h1[1]) || text((/<meta name="description" content="([^"]*)"/i.exec(html) || [])[1]) || `${tip.replace(/\s*-\s*Vendita.*/i, '')} ${zona}`.trim()
  const dm = /<b>Descrizione<\/b>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(html)
  const desc = text(dm && dm[1])
  if (!/vendita/i.test(tip) || NOT_HOME.test(`${title} ${tip}`) || NOT_HOME_TIP.test(tip)) return null

  const loc = locate(area, `${title} ${zona} ${via}`)
  if (!loc) return null

  const pm = /€\s*([\d.,]+)(?:\s*-\s*Mq\s*([\d.,]+))?/i.exec(field(html, 'Prezzo/Mq'))
  const price = pm ? num(pm[1]) : null
  if (!price) return null
  const size = (pm && num(pm[2])) || num((/(\d{2,4})\s*mq\b/i.exec(desc) || [])[1])
  const camere = num(field(html, 'Numero Camere'))
  const floor = field(html, 'Piano')
  const all = `${title} ${tip} ${desc}`

  const feats = featsOf(all)
  if (/autonomo/i.test(field(html, 'Riscaldamento')) && !feats.includes('Riscaldamento autonomo')) feats.push('Riscaldamento autonomo')
  if (/posto auto|garage|posto macchina/i.test(field(html, 'Garage/posto macchina') + ' ' + all) && !feats.some((f) => f === 'Garage' || f === 'Posto auto')) feats.push(/garage|box/i.test(all) ? 'Garage' : 'Posto auto')

  return {
    title,
    // "stile baita" or "palazzo" in the title of a flat does not make it a baita or a house
    type: /^(appartamento|bilocale|trilocale|quadrilocale|attico|monolocale)/i.test(tip) ? 'Appartamento' : typeOf(`${title} ${tip}`),
    price,
    size,
    rooms: camere, // "Numero Camere" = bedrooms; null when the page omits it
    baths: bathsOf(`${title} ${desc}`),
    floor: floor || null,
    energy: energyOf(desc),
    addr: [via, loc.town].filter(Boolean).join(', '),
    town: loc.town,
    lat: loc.lat, lng: loc.lng, approx: true,
    imgs: images(html),
    feats, desc: clip(desc),
    date: null,
    url,
  }
}

export default {
  id: 'altopiano',
  label: 'Altopiano Immobiliare',
  hosts: /^https:\/\/www\.altopianoimmobiliare\.it\//,
  imgHosts: /^https:\/\/www\.altopianoimmobiliare\.it\/pannello\/fotoannunci\//,
  async search(area) {
    const list = await get(LIST)
    await sleep(1200)
    const links = [...new Set([...list.matchAll(/href="(\d+-Vendita residenziale-[^"]*\.html)"/gi)].map((m) => decode(m[1])))]
    const out = []
    for (const rel of links.slice(0, MAX_DETAILS)) {
      const url = BASE + encodeURI(rel)
      try {
        const c = normalise(await get(url), url, area)
        if (c) out.push(c)
      } catch { /* removed meanwhile, or a flaky page: retried tomorrow */ }
      await sleep(1200)
    }
    return out
  },
  async verify(l) {
    // Withdrawn ids answer 200 with a page that lacks the characteristics table.
    const html = await get(l.url)
    return /scheda_caratteristiche/.test(html) && /Prezzo\/Mq/i.test(html)
  },
}
