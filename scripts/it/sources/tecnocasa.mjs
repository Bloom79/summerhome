// Tecnocasa / Tecnorete (Immobiliare Le Rocche, Rocca di Mezzo). Search
// pages carry the results as HTML-escaped JSON in the Vue attribute
// :estates="[…]"; each detail page carries :estate="{…}" with exact
// coordinates, bedrooms, energy class, build year and publish date.
// Removed listings answer 404. robots.txt allows crawling (Nov 2026).

import { get, sleep, clip, num, typeOf, Gone } from '../lib.mjs'

const COMUNI = ['ovindoli', 'rocca-di-mezzo']
const PER_PAGE = 15
const searchUrl = (c, p) => `https://www.tecnocasa.it/annunci/immobili/abruzzo/aquila/${c}${p > 1 ? `/pag-${p}` : ''}.html`
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attrJson = (html, name) => {
  const m = new RegExp(`:${name}="([\\s\\S]*?)"\\s`).exec(html)
  try { return m ? JSON.parse(unescape(m[1])) : null } catch { return null }
}
const NOT_HOME = /\b(garage|box|magazzino|negozio|ufficio|capannone|terreno|locale commerciale|laboratorio)\b/i

const normalise = (e) => {
  const f = e.features || {}
  const text = `${e.title || ''} ${e.subtitle || ''} ${e.type?.slug || ''} ${e.description || ''}`
  const feats = []
  if (f.garden) feats.push('Giardino')
  if (f.box > 0) feats.push('Garage')
  if (f.car_places > 0) feats.push('Posto auto')
  if (f.balconies > 0 || f.terraces > 0) feats.push('Terrazzo')
  if (/^s[iì]|arredat/i.test(f.furnitured || '') && !/assente/i.test(f.furnitured || '')) feats.push('Arredato')
  if (/autonomo/i.test(f.heating_immo || '')) feats.push('Riscaldamento autonomo')
  const date = String(e.last_published_at || '').slice(0, 10)
  return {
    title: e.title || '',
    // The title IS Tecnocasa's type label ("Trilocale", "Casa indipendente",
    // "Villa a schiera", "Rustico"…); the description would mislead.
    type: typeOf(e.title || text),
    price: e.numeric_price || num(e.price),
    size: Math.round(+e.numeric_surface) || num(e.surface),
    rooms: f.bedrooms > 0 ? f.bedrooms : null, // bedrooms, not "locali"
    baths: num(e.bathrooms),
    floor: f.floor || null,
    year: f.build_year > 1700 ? f.build_year : null,
    energy: e.energy_data?.class ? String(e.energy_data.class).toUpperCase() : null,
    addr: [e.address, e.district?.title, e.city?.title].filter(Boolean).join(', '),
    town: e.district?.title || e.city?.title || '',
    lat: +e.latitude, lng: +e.longitude, approx: e.media?.map?.exact === false,
    imgs: (e.media?.images || []).map((i) => i.url?.detail).filter((u) => typeof u === 'string' && u.startsWith('https://cdn-media.medialabtc.it/')),
    feats, desc: clip(e.description),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    url: e.detail_url,
  }
}

export default {
  id: 'tecnocasa',
  label: 'Tecnocasa',
  hosts: /^https:\/\/www\.tecnocasa\.it\//,
  imgHosts: /^https:\/\/cdn-media\.medialabtc\.it\//,
  async search() {
    const out = []
    for (const c of COMUNI) {
      for (let p = 1; p <= 6; p++) {
        let list
        try { list = attrJson(await get(searchUrl(c, p)), 'estates') || [] } catch (e) { if (p === 1) throw e; break }
        await sleep(1200)
        for (const it of list) {
          if (!it.detail_url || /affitto/i.test(it.detail_url) || NOT_HOME.test(it.title || '')) continue
          try {
            const e = attrJson(await get(it.detail_url), 'estate')
            if (e && e.contract?.slug_estate === 'vendita') out.push(normalise(e))
          } catch { /* removed meanwhile, or a flaky page: retried tomorrow */ }
          await sleep(1200)
        }
        if (list.length < PER_PAGE) break
      }
    }
    return out
  },
  async verify(l) {
    try { return !!attrJson(await get(l.url), 'estate') } catch (e) { if (e instanceof Gone) return false; throw e }
  },
}
