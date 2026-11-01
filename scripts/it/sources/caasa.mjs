// Caasa.it: an aggregator that mirrors Immobiliare.it, Idealista and
// Wikicasa (the portals that block scripts) plus small portals (Clickcase,
// Casadaprivato, Trovacasa, PCase…). Plain curl works from datacenter IPs
// (no anti-bot wall seen, Nov 2026). Search pages
// /l-aquila/<comune>/<tipo>/in-vendita.html?page=N carry 18 cards each with
// price, m², floor, baths, energy class, a snippet, one photo and a Google
// Maps link holding lat,lng (the portal's own, usually rounded: approx).
// Each card links out through /ClickTag?url=<original>: we only DECODE that
// parameter, never request /ClickTag (robots.txt disallows it). The adapter
// emits the ORIGINAL listing URL, so the same ad found on another source
// dedupes by URL. Only the Caasa search pages are fetched; the originals
// are blocked, so `verify` re-checks presence in a fresh search (an ad
// that left the portal drops out of Caasa's index within days). No
// per-ad page, hence no rooms/bedrooms (the card has none) and a short
// description. robots.txt allows /l-aquila/… ; Crawl-delay 2 is
// honoured (one request per 2 s).

import { get, sleep, clip, num, typeOf, featsOf, Gone } from '../lib.mjs'
import { AREA } from '../area.mjs'

const COMUNI = [
  ['ovindoli', 'Ovindoli'],
  ['rocca-di-mezzo', 'Rocca di Mezzo'],
  ['rocca-di-cambio', 'Rocca di Cambio'],
]
// "appartamento" already contains bilocali/trilocali/attici/monolocali.
const TYPES = ['appartamento', 'casa-indipendente', 'villa', 'villetta-a-schiera', 'baita']
const MAX_PAGES = 20 // Ovindoli flats alone fill 8 pages; the loop stops at the first page with nothing new
const searchUrl = (c, t, p) => `https://www.caasa.it/l-aquila/${c}/${t}/in-vendita.html${p > 1 ? `?page=${p}` : ''}`
const ALIASES = { 'santa iona': 'Santa Jona', 'fonteavignone': 'Fontavignone' }
const MONTHS = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 }
const NOT_HOME = /\b(garage|box|posto auto|magazzino|negozio|ufficio|capannone|terreno|locale commerciale|laboratorio|ristorante|pizzeria)\b/i
const AUCTION = /\basta\b|\bin asta\b|vendita giudiziaria|\bvendite? giudiziari|\bprocedura esecutiva\b/i

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ')
const unescape = (s) => s.replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&igrave;/g, 'ì').replace(/&ograve;/g, 'ò').replace(/&ugrave;/g, 'ù')
  .replace(/&eacute;/g, 'é').replace(/&hellip;/g, '…').replace(/&rsquo;|&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&sup2;/g, '²').replace(/&euro;/g, '€').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const text = (s) => unescape(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

// Original URL out of the ClickTag link, without the tracking fragment.
const originalUrl = (card) => {
  const m = /ClickTag\?url=([^&'"]+)/.exec(card)
  if (!m) return null
  try {
    const u = new URL(decodeURIComponent(m[1]))
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    u.hash = ''
    u.protocol = 'https:'
    // Tracking parameters vary between scans; the same ad must keep one url.
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|xtor|ref$|source$)/i.test(k)) u.searchParams.delete(k)
    return u.href
  } catch { return null }
}

const placeIn = (area, comuneName, addr) => {
  const t = ` ${fold(addr)} `
  for (const p of area.places.filter((x) => x.comune === comuneName && x.name !== comuneName)) {
    const names = [fold(p.name), ...Object.entries(ALIASES).filter(([, v]) => v === p.name).map(([k]) => k)]
    if (names.some((n) => t.includes(` ${n} `) || t.includes(` ${n},`))) return p
  }
  return null
}

const normalise = (card, comune, area) => {
  const title = text(/<h2 class="result-item__title">\s*<a[^>]*>([\s\S]*?)<\/a>/.exec(card)?.[1])
  const url = originalUrl(card)
  const priceBox = /result-item__price">([\s\S]*?)<\/div>/.exec(card)?.[1] || ''
  const price = num(/title="prezzo">([^<]*)/.exec(priceBox)?.[1])
  const size = num(/m(?:&sup2;|²)\s*([\d.,]+)/.exec(priceBox)?.[1])
  const loc = /maps\.google\.[a-z]+\/\?q=([-\d.]+)%2C([-\d.]+)">([^<]*)</.exec(card)
  const addr = text(loc?.[3] || '')
  const details = text(/result-item__details">([\s\S]*?)<\/div>/.exec(card)?.[1])
  const descRaw = /class="main-description">([\s\S]*?)<\/p>/.exec(card)?.[1] || ''
  const desc = clip(text(descRaw.replace(/<a [^>]*badge[\s\S]*?<\/a>/g, '')))
  const all = `${title} ${desc}`
  const pl = placeIn(area, comune.name, addr || all)
  const floor = /piano:\s*([^\s]+(?: \([^)]*\))?)/i.exec(details)?.[1]
  const energy = /C\.E\.\s*([A-G][1-4]?)\b/.exec(details)?.[1]
  const baths = num(/bagni:\s*(\d+)/.exec(details)?.[1])
  const feats = featsOf(all)
  const add = (f) => { if (!feats.includes(f)) feats.push(f) }
  if (/con balcone|con terrazza/.test(details)) add('Terrazzo')
  if (/caminetto/.test(details)) add('Camino')
  if (/cantina/.test(details)) add('Cantina')
  const d = /title='Pubblicato \w+ (\d+) (\w+) (\d{4})'/.exec(card)
  const date = d && MONTHS[d[2]] ? `${d[3]}-${String(MONTHS[d[2]]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}` : null
  const imgs = [/<img[^>]+src="(https:\/\/cdn\.caasa\.it\/s3\/[^"]+)"/.exec(card)?.[1]].filter(Boolean)
  const lat = loc ? +loc[1] : (pl?.lat ?? comune.lat), lng = loc ? +loc[2] : (pl?.lng ?? comune.lng)
  return {
    title,
    type: typeOf(title || all),
    price, size,
    rooms: null, // the card carries no room count
    baths,
    floor: floor || null,
    energy: energy || null,
    addr: [pl?.name, comune.name].filter(Boolean).join(', '),
    town: pl?.name || comune.name,
    lat, lng, approx: true,
    imgs, feats, desc,
    date,
    url,
    _text: all,
    _id: /^(\d+)/.exec(card)?.[1],
  }
}

const cardsOf = (html) => html.split('<div class="result-item" id="ID_').slice(1).map((c) => c.split('<div id="PID_')[0])
const inArea = (l, area) => {
  const b = area.bounds
  return l.lat >= b.minLat && l.lat <= b.maxLat && l.lng >= b.minLng && l.lng <= b.maxLng
}

let lastSeen = null // Set of every original URL (incl. cross-posts) of the last search
let failed = 0 // pages that errored in the last search (not 404s)

export default {
  id: 'caasa',
  label: 'Caasa.it',
  // Originals worth keeping: whatever the aggregator links out to, or its own page.
  hosts: /^https:\/\/www\.(caasa|immobiliare|idealista|wikicasa|casa|gate-away|clickcase|casadaprivato|trovacasa|pcase|bancadellecase|bachecacase|annunci|subito)\.(it|com|net)\//,
  imgHosts: /^https:\/\/cdn\.caasa\.it\//,
  async search(area) {
    const byUrl = new Map(), seen = new Set()
    const byKey = new Map()
    let okRequests = 0
    failed = 0
    for (const [slug, name] of COMUNI) {
      const comune = area.comuni.find((c) => c.name === name)
      for (const t of TYPES) {
        for (let p = 1; p <= MAX_PAGES; p++) {
          let html
          try { html = await get(searchUrl(slug, t, p)); okRequests++ } catch (e) {
            if (p === 1 && !okRequests && slug === COMUNI[0][0] && t === TYPES[0]) throw e
            // A 404 just means no such page; anything else leaves a gap in
            // today's scan, and verify() must not read the gap as "sold".
            if (!(e instanceof Gone)) failed++
            break
          }
          await sleep(2000)
          const cards = cardsOf(html)
          let fresh = 0
          for (const c of cards) {
            const l = normalise(c, comune, area)
            if (!l.url || !l._id) continue
            seen.add(l.url)
            if (byUrl.has(l.url)) continue
            fresh++
            byUrl.set(l.url, l)
          }
          if (!fresh || cards.length < 10) break
        }
      }
    }
    lastSeen = seen
    const out = []
    // Stable pick among copies of one flat on several portals: the same
    // copy every day (Immobiliare, then Idealista, then the rest by url),
    // or the chosen url would flip and read as "sold" + "new".
    const rank = (u) => (/immobiliare\.it/.test(u) ? 0 : /idealista\.it/.test(u) ? 1 : 2)
    const ordered = [...byUrl.values()].sort((a, b) => rank(a.url) - rank(b.url) || a.url.localeCompare(b.url))
    for (const l of ordered) {
      if (AUCTION.test(l.title) || AUCTION.test(l._text) || NOT_HOME.test(l.title)) continue
      if (!(l.price >= 10000) || !inArea(l, area)) continue
      // The same flat is often listed on several portals: one record per
      // price + size + place.
      const key = `${l.price}|${l.size}|${l.town}`
      if (byKey.has(key)) continue
      byKey.set(key, l)
      const { _text, _id, ...rest } = l
      out.push(rest)
    }
    return out
  },
  async verify(l) {
    if (!lastSeen) await this.search(AREA)
    if (lastSeen.has(l.url)) return true
    // Missing from an incomplete scan proves nothing: keep it, check tomorrow.
    if (failed) throw new Error(`scansione Caasa incompleta (${failed} pagine in errore)`)
    return false
  },
}
