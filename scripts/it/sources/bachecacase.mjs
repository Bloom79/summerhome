// BachecaCase.com (agency feed portal). Plain curl works from datacenter
// IPs (no anti-bot wall, Nov 2026). The search page
// /case-appartamenti-in-vendita/<comune>?pag=N lists 10 cards each with
// title (type, place, bedrooms, baths, m²), price, m², a snippet, the
// agency and a photo; the card is enough, so there is no per-ad fetch
// (the detail page only adds the comune centroid as coordinates). The
// portal does fuzzy matching ("Rocca di Mezzo" returns Rocca di Papa…),
// so a card is kept only if its title names a comune of the plateau. No
// per-ad coordinates: the comune or frazione centroid is used (approx).
// Removed ads answer 301 to the generic search (an empty body for our
// curl, which does not follow redirects). robots.txt allows
// /scheda-immobile/ and the search pages (it disallows /immobile/,
// /view-immobile/, /ck/, /upload/).

import { get, sleep, clip, num, typeOf, featsOf } from '../lib.mjs'

const COMUNI = [
  ['ovindoli', 'Ovindoli'],
  ['rocca-di-mezzo', 'Rocca di Mezzo'],
  ['rocca-di-cambio', 'Rocca di Cambio'],
]
const MAX_PAGES = 6
const searchUrl = (c, p) => `https://www.bachecacase.com/case-appartamenti-in-vendita/${c}${p > 1 ? `?pag=${p}` : ''}`
const ALIASES = { 'santa iona': 'Santa Jona', 'fonteavignone': 'Fontavignone' }
const NOT_HOME = /\b(garage|box|posto auto|magazzino|negozio|ufficio|capannone|terreno|locale commerciale|laboratorio)\b/i

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ')
const unescape = (s) => s.replace(/&euro;/g, '€').replace(/&egrave;/g, 'è').replace(/&agrave;/g, 'à').replace(/&igrave;/g, 'ì').replace(/&ograve;/g, 'ò')
  .replace(/&ugrave;/g, 'ù').replace(/&#0?39;|&rsquo;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
const text = (s) => unescape(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

const normalise = (card, comune, area) => {
  const href = /<h4><a href="(\/scheda-immobile\/(\d+)\/[^"]+)"/.exec(card)
  if (!href) return null
  const title = text(/<h4><a [^>]*>([\s\S]*?)<\/a>/.exec(card)?.[1])
  const parts = title.split(',').map((s) => s.trim())
  // "Casa indipendente, Ovindoli, 3 camere, 60mq" / "…, Santa Jona, Ovindoli, 2 bagni, …"
  const where = parts.slice(1).filter((p) => !/^\d+\s*(camer|bagn|local)|^\d+\s*mq$/i.test(p))
  const whereTxt = ` ${fold(where.join(' , '))} `
  const names = COMUNI.map(([, n]) => n)
  const inComune = names.find((n) => whereTxt.includes(` ${fold(n)} `) || whereTxt.includes(` ${fold(n)} ,`))
  const pl = area.places.find((p) => p.comune === (inComune || comune.name) && p.name !== p.comune &&
    [fold(p.name), ...Object.entries(ALIASES).filter(([, v]) => v === p.name).map(([k]) => k)].some((n) => whereTxt.includes(` ${n} `)))
  if (!inComune) return null
  const home = area.comuni.find((c) => c.name === inComune)
  const price = num(/class="price">([^<]*)/.exec(card)?.[1])
  const size = num(/class="value">([\d.,]+)\s*m<sup>/.exec(card)?.[1]) || num(/(\d+)\s*mq/.exec(title)?.[1])
  const val = (label) => num(new RegExp(`<span class="value">([^<]*)</span>\\s*<label class="label">${label}`).exec(card)?.[1])
  const bedrooms = val('camere')
  const baths = val('bagni')
  const desc = clip(text(/class="annuncio-desc[^"]*">([\s\S]*?)<\/p>/.exec(card)?.[1]))
  const agency = /class="lazyload agency-logo" alt="([^"]*)"/.exec(card)?.[1]
  const img = /data-src="(?:https:)?\/\/(images\.bachecacase\.com\/resources\/)xs(\/[^"]+)"/.exec(card)
  const all = `${title} ${desc}`
  const feats = featsOf(all)
  return {
    title: parts.slice(0, 1).concat(where).join(', ') || title,
    type: typeOf(parts[0] || all),
    price, size,
    rooms: bedrooms,
    baths,
    floor: null,
    energy: null,
    addr: [pl?.name, inComune].filter(Boolean).join(', '),
    town: pl?.name || inComune,
    lat: pl?.lat ?? home.lat, lng: pl?.lng ?? home.lng, approx: true,
    imgs: img ? [`https://${img[1]}xl${img[2]}`] : [],
    feats,
    desc: agency && desc ? `${desc} (${agency})` : desc,
    date: null,
    url: `https://www.bachecacase.com${href[1]}`,
    _id: href[2],
  }
}

export default {
  id: 'bachecacase',
  label: 'BachecaCase',
  hosts: /^https:\/\/www\.bachecacase\.com\//,
  imgHosts: /^https:\/\/images\.bachecacase\.com\//,
  async search(area) {
    const out = [], ids = new Set()
    for (const [slug, name] of COMUNI) {
      const comune = area.comuni.find((c) => c.name === name)
      for (let p = 1; p <= MAX_PAGES; p++) {
        let html
        try { html = await get(searchUrl(slug, p)) } catch (e) { if (p === 1 && slug === COMUNI[0][0]) throw e; break }
        await sleep(1500)
        const cards = html.split('<div class="annunci_content" id="im_').slice(1)
        let kept = 0
        for (const c of cards) {
          const l = normalise(c, comune, area)
          if (!l || ids.has(l._id)) continue
          kept++
          ids.add(l._id)
          const { _id, ...rest } = l
          if (NOT_HOME.test(l.title) || !(l.price >= 10000)) continue
          out.push(rest)
        }
        // Fuzzy matches fill the later pages: stop at the first page without a hit.
        if (cards.length < 10 || !kept) break
      }
    }
    return out
  },
  async verify(l) {
    // A removed ad answers 301 to the generic search: no body for curl.
    const id = /scheda-immobile\/(\d+)\//.exec(l.url)?.[1]
    const html = await get(l.url)
    return !!id && html.includes(`"im_id":"${id}"`)
  },
}
