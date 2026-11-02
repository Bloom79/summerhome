// PVP — Portale delle Vendite Pubbliche (pvp.giustizia.it), the Ministry of
// Justice portal where every judicial sale must be published. An open JSON
// API sits behind its Angular front end (no login, no captcha, Nov 2026).
//
// Courts: Ovindoli → Tribunale di Avezzano; Rocca di Mezzo and Rocca di
// Cambio → Tribunale dell'Aquila. Free-text search matches only the street
// and the radius search misses lots without coordinates, so we page through
// both courts (newest sale first) and filter on the lot's comune, plus one
// radius query for lots handled by other courts.

import { getJSON, postJSON, sleep, clip, num, typeOf, Gone, TODAY } from '../lib.mjs'

const HOST = 'https://pvp.giustizia.it'
const FILES = 'https://resource-pvp.giustizia.it'
// Microservice paths carry a build hash; read them from the front-end
// config, falling back to the ones seen in Nov 2026.
let MS = { ricerca: '/ric-496b258c-986a1b71/ric-ms', vendite: '/ve-3f723b85-986a1b71/ve-ms' }
const discover = async () => {
  try {
    const c = await getJSON(`${HOST}/bo-5897bc47-986a1b71/bo-ms/fe-config/area-annunci`)
    const u = c?.body?.msUrl || c?.msUrl || {}
    for (const k of ['ricerca', 'vendite']) if (typeof u[k] === 'string' && u[k].startsWith('/')) MS[k] = u[k].replace(/\/$/, '')
  } catch { /* keep the known paths */ }
}

const COMUNI = new Map([['ovindoli', 'Ovindoli'], ['rocca di mezzo', 'Rocca di Mezzo']])
const QUERIES = [
  { tribunale: 'Tribunale di AVEZZANO', tipoLotto: 'IMMOBILI' },
  { tribunale: "Tribunale di L'AQUILA", tipoLotto: 'IMMOBILI' },
  { flagRicerca: 0, coordIndirizzo: '42.18, 13.50', raggioIndirizzo: '15' },
]

const search = async (body) => {
  const out = []
  for (let page = 0; page < 8; page++) {
    const r = await postJSON(`${HOST}${MS.ricerca}/ricerca/vendite?language=it&page=${page}&size=100&sort=dataOraVendita,desc`, body)
    const items = r?.body?.content || []
    out.push(...items)
    // Newest sale first: once sales are in the past, the rest is history.
    if (r?.body?.last || !items.length || items[items.length - 1].dataVendita < TODAY) break
    await sleep(1200)
  }
  return out.filter((l) => l.dataVendita >= TODAY)
}

// The lot's comune decides; coordinates only when no comune is given (the
// bounding box also covers the edge of Celano, below Santa Jona).
const inArea = (l, b) => {
  const c = (l.indirizzo?.citta || '').toLowerCase()
  if (c) return COMUNI.has(c)
  const { latitudine: la, longitudine: lo } = l.indirizzo?.coordinate || {}
  return la >= b.minLat && la <= b.maxLat && lo >= b.minLng && lo <= b.maxLng
}

// Coordinates: the lot's own (Google-geocoded, street level) when present,
// else the street via Nominatim, else the comune centre marked approximate.
const geocode = async (addr) => {
  try {
    await sleep(1100) // Nominatim policy: ≤ 1 request/second
    const r = await getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=it&q=${encodeURIComponent(addr)}`,
      { 'User-Agent': 'casatrova/1.0 (github.com/Bloom79/summerhome)' })
    return r[0] ? { lat: +r[0].lat, lng: +r[0].lon } : null
  } catch { return null }
}

const eur = (n) => '€' + Math.round(n).toLocaleString('it-IT')

export default {
  id: 'pvp',
  label: 'Aste giudiziarie (PVP)',
  hosts: /^https:\/\/pvp\.giustizia\.it\//,
  imgHosts: /^https:\/\/resource-pvp\.giustizia\.it\//,
  async search(area) {
    await discover()
    const byId = new Map()
    for (const q of QUERIES) {
      for (const l of await search(q)) byId.set(l.id, l)
      await sleep(1200)
    }
    const out = []
    for (const l of byId.values()) {
      if (!inArea(l, area.bounds) || l.categoriaLotto !== 'IMMOBILE_RESIDENZIALE') continue
      let d = null
      try { await sleep(1200); d = (await getJSON(`${HOST}${MS.vendite}/vendite/${l.id}/restricted`))?.body } catch { /* list data suffices */ }
      if (d?.codEsito) continue // already sold or deserted
      const comune = COMUNI.get((l.indirizzo?.citta || '').toLowerCase()) || l.indirizzo?.citta || ''
      let { latitudine: lat, longitudine: lng } = l.indirizzo?.coordinate || {}
      let approx = false
      if (!(lat && lng)) {
        const g = l.indirizzo?.via ? await geocode(l.indirizzo.via) : null
        const c = area.comuni.find((x) => x.name === comune)
        if (g) ({ lat, lng } = g)
        else if (c) { lat = c.lat; lng = c.lng; approx = true }
      }
      const beni = d?.beni || []
      const text = [l.descLotto, ...beni.map((b) => b.descrizione)].filter(Boolean).join(' ')
      const mq = /(\d{2,4})(?:[.,]\d+)?\s*(?:mq|m2|m²|metri quadr)/i.exec(text)
      const perizia = (d?.allegati || []).find((a) => a.codiceTipoAllegato === 'PERIZ')
      const imgs = beni.flatMap((b) => (b.allegati || []).filter((a) => /immagine/i.test(a.descrizione || '') || /\.(jpe?g|png)(\?|$)/i.test(a.nomeFile || '')))
        .map((a) => FILES + a.linkAllegato)
      const occ = beni[0]?.disponibilitaDesc || ''
      const head = [
        `Asta giudiziaria ${l.tribunale.replace(/^Tribunale di /, 'Trib. ')} · proc. ${d?.procedura?.numeRg ? `${d.procedura.numeRg}/${d.procedura.numeAnnoRg}` : l.procedura} · ${l.numeroLotto}`,
        `base ${eur(l.prezzoBaseAsta)} · offerta minima ${eur(l.offertaMinima)}${d?.impoStima > l.prezzoBaseAsta ? ` · stima ${eur(d.impoStima)}` : ''}`,
        occ && `immobile ${occ.toLowerCase()}`,
        d?.dataTermPresOff && `offerte entro il ${d.dataTermPresOff}`,
      ].filter(Boolean).join(' — ')
      out.push({
        title: `${beni[0]?.descTipologiaBene || 'Immobile'} all'asta`,
        type: typeOf(text),
        price: l.prezzoBaseAsta,
        size: num(beni[0]?.superficie) || (mq ? +mq[1] : null),
        rooms: null, baths: null,
        floor: beni[0]?.piano || null,
        addr: String(l.indirizzo?.via || comune).replace(/,?\s*Italia$/, ''),
        town: comune, lat, lng, approx,
        imgs, feats: ['Asta'],
        desc: clip(`${head}. ${text}`, 1400),
        date: /^\d{4}-\d{2}-\d{2}$/.test(l.dataPubblicazione || '') ? l.dataPubblicazione : null,
        auction: l.dataVendita,
        url: `${HOST}/pvp/it/detail_annuncio.page?idAnnuncio=${l.id}`,
        extra: {
          minOffer: l.offertaMinima,
          ...(perizia ? { perizia: FILES + perizia.linkAllegato } : {}),
          proc: `${l.codiceTribunale}|${d?.procedura ? `${d.procedura.numeRg}/${d.procedura.numeAnnoRg}` : l.procedura}|${String(l.numeroLotto).replace(/\D/g, '') || 'U'}`,
        },
      })
    }
    return out
  },
  async verify(l) {
    const id = /idAnnuncio=(\d+)/.exec(l.url)?.[1]
    try {
      const d = (await getJSON(`${HOST}${MS.vendite}/vendite/${id}/restricted`))?.body
      return !!d && !d.codEsito
    } catch (e) { if (e instanceof Gone) return false; throw e }
  },
}
