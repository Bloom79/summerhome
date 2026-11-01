// Subito.it (private sellers and agencies). One call to the app's own search
// API (hades.subito.it) per comune and 50 ads: the items already carry the
// body text, structured features and photos, so there is no per-ad fetch.
// Coordinates are the town centroid only, so a frazione named in the ad
// overrides them. `/room` is "locali" (all rooms), not bedrooms. Removed ads
// answer 410. robots.txt discourages bots; scraping approved by the owner
// for this personal project, kept small (one request per 1.5 s).

import { getJSON, get, sleep, clip, num, typeOf, featsOf, energyOf, Gone } from '../lib.mjs'

const LIM = 50
const apiUrl = (istat, start) => `https://hades.subito.it/v1/search/items?c=6&t=s&r=13&ci=1&to=${istat}&lim=${LIM}&start=${start}`
const SKIP_CATS = new Set(['Garage e box', 'Uffici e Locali commerciali'])
const AUCTION = /\basta\b|\bin asta\b|vendita giudiziaria|\bvendite? giudiziari|\bprocedura esecutiva\b/i
const NOT_HOME = /\b(garage|box|posto auto|cantina|magazzino|negozio|ufficio|capannone|terreno|terreni|locale commerciale|locale multiuso|laboratorio|ristorante|pizzeria|multipropriet[a-zà]*|affitto|affittasi|camera singola|stanza)\b/i
const ALIASES = { 'santa iona': 'Santa Jona', 'fonteavignone': 'Fontavignone' }

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, ' ')
const feat = (ad, uri) => ad.features?.find((f) => f.uri === uri)?.values?.[0]

// First frazione named in the title, else in the body (only those of the
// ad's own comune; the comune-named places are the centroid anyway).
const placeIn = (area, comune, title, body) => {
  const cands = area.places.filter((p) => p.comune === comune.name && p.name !== comune.name)
  for (const text of [title, body]) {
    const t = ` ${fold(text)} `
    let best = null
    for (const p of cands) {
      const names = [fold(p.name), ...Object.entries(ALIASES).filter(([, v]) => v === p.name).map(([k]) => k)]
      for (const n of names) {
        const i = t.search(new RegExp(`[^a-z]${n}[^a-z]`))
        if (i >= 0 && (!best || i < best.i)) best = { i, p }
      }
    }
    if (best) return best.p
  }
  return null
}

// Subito's own category first (the body text often mentions "casa" or
// "villa" for a flat); the title, then the whole text, refine it.
const typeOfAd = (ad, title, text) => {
  const cat = ad.category?.value || ''
  if (cat === 'Appartamenti') return /\b(baita|chalet)\b/i.test(title) ? 'Baita' : 'Appartamento'
  if (cat === 'Terreni e rustici') return 'Rustico'
  if (cat === 'Ville singole e a schiera') {
    const t = typeOf(title)
    return t === 'Appartamento' ? (typeOf(text) === 'Appartamento' ? 'Casa indipendente' : typeOf(text)) : t
  }
  return typeOf(text)
}

const normalise = (ad, comune, area) => {
  const title = String(ad.subject || '').trim()
  const body = String(ad.body || '')
  const text = `${title} ${body}`
  const rooms = num(feat(ad, '/room')?.value)
  const ec = String(feat(ad, '/energy_class')?.value || '').toUpperCase()
  const feats = featsOf(text)
  const add = (f) => { if (!feats.includes(f)) feats.push(f) }
  if (feat(ad, '/garden')?.key === '1') add('Giardino')
  if (feat(ad, '/furnished')?.key === '1') add('Arredato')
  if (ad.advertiser?.company === false) add('Privato')
  const pl = placeIn(area, comune, title, body)
  const date = String(ad.dates?.display_iso8601 || '').slice(0, 10)
  const desc = clip(body)
  return {
    title,
    type: typeOfAd(ad, title, text),
    price: num(feat(ad, '/price')?.key),
    size: num(feat(ad, '/size')?.key),
    rooms: null, // Subito's /room is locali, not bedrooms
    baths: num(feat(ad, '/bathrooms')?.value),
    floor: feat(ad, '/floor')?.value || null,
    energy: /^[A-G][1-4]?$/.test(ec) ? ec : energyOf(text),
    addr: [pl?.name, comune.name].filter(Boolean).join(', '),
    town: pl?.name || comune.name,
    lat: pl?.lat ?? comune.lat, lng: pl?.lng ?? comune.lng, approx: true,
    imgs: (ad.images || []).map((i) => i.cdn_base_url).filter((u) => typeof u === 'string' && u.startsWith('https://images.sbito.it/')).map((u) => `${u}?rule=fullscreen-1x-auto`).slice(0, 40),
    feats,
    desc: rooms ? `${rooms} locali · ${desc}` : desc,
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    url: ad.urls?.default,
  }
}

export default {
  id: 'subito',
  label: 'Subito.it',
  hosts: /^https:\/\/www\.subito\.it\//,
  imgHosts: /^https:\/\/images\.sbito\.it\//,
  async search(area) {
    const out = []
    for (const comune of area.comuni) {
      for (let start = 0; ; start += LIM) {
        let d
        try { d = await getJSON(apiUrl(comune.istat, start)) } catch (e) { if (start === 0) throw e; break }
        await sleep(1500)
        for (const ad of d.ads || []) {
          const title = ad.subject || '', text = `${title} ${ad.body || ''}`
          if (!ad.urls?.default || SKIP_CATS.has(ad.category?.value) || ad.type?.key !== 's') continue
          if (ad.category?.value === 'Terreni e rustici' && !/rustic|casale|baita|fabbricato/i.test(text)) continue
          if (AUCTION.test(title) || /\bimmobile in asta\b|\bvendita giudiziaria\b/i.test(text) || NOT_HOME.test(title)) continue
          const l = normalise(ad, comune, area)
          if (l.price >= 10000 && l.url) out.push(l) // placeholder prices (1, 860, 1500 €) are not sales
        }
        if (start + LIM >= (d.count_all || 0) || !(d.ads || []).length) break
      }
    }
    return out
  },
  async verify(l) {
    try { await get(l.url); return true } catch (e) { if (e instanceof Gone) return false; throw e }
  },
}
