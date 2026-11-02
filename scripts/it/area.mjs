// The Altopiano delle Rocche: the three comuni of the plateau, their
// frazioni and hamlets (OSM place nodes via Nominatim, Nov 2026), the
// ski-lift bases (OSM aerialway + EU-DEM elevations) and the gates that
// drive times are measured from.

import { haversineM } from './lib.mjs'

const PLACES = [
  // [name, comune, lat, lng]
  ['Ovindoli', 'Ovindoli', 42.13703, 13.5161],
  ['Santa Jona', 'Ovindoli', 42.09932, 13.50966],
  ['San Potito', 'Ovindoli', 42.12131, 13.51538],
  ['Aia Decina', 'Ovindoli', 42.1441, 13.50728],
  ['Campagnolo', 'Ovindoli', 42.149, 13.50504],
  ['Magnola', 'Ovindoli', 42.1454, 13.49713],
  ['Vado del Ceraso', 'Ovindoli', 42.16543, 13.48599],
  ['Rovere', 'Rocca di Mezzo', 42.17616, 13.51609],
  ['Colle Belvedere', 'Rocca di Mezzo', 42.16352, 13.51306],
  ['Piani di Pezza', 'Rocca di Mezzo', 42.18269, 13.46852],
  ['Terranera', 'Rocca di Mezzo', 42.23491, 13.53462],
  ['Fontavignone', 'Rocca di Mezzo', 42.25574, 13.5111],
  ['Colle Ciaccio', 'Rocca di Mezzo', 42.21699, 13.51973],
  ['Colle Marino', 'Rocca di Mezzo', 42.21446, 13.52389],
  ['Rocca di Mezzo', 'Rocca di Mezzo', 42.21302, 13.52812],
  ['Rocca di Cambio', 'Rocca di Cambio', 42.23504, 13.48996],
  ['Campo Felice', 'Rocca di Cambio', 42.2129, 13.45821],
  ['Cavigliara', 'Rocca di Cambio', 42.23435, 13.46137],
].map(([name, comune, lat, lng]) => ({ name, comune, lat, lng }))

// Hamlets too small to be a "town" of their own: a home there is shown
// under its comune.
const HAMLETS = new Set(['Aia Decina', 'Campagnolo', 'Magnola', 'Vado del Ceraso', 'Colle Belvedere', 'Colle Ciaccio', 'Colle Marino', 'Cavigliara'])

export const AREA = {
  zones: ['Ovindoli', 'Rocca di Mezzo'],
  comuni: [
    { name: 'Ovindoli', istat: '066065', lat: 42.13703, lng: 13.5161 },
    { name: 'Rocca di Mezzo', istat: '066082', lat: 42.21302, lng: 13.52812 },
  ],
  places: PLACES,
  bounds: { minLat: 42.08, maxLat: 42.28, minLng: 13.43, maxLng: 13.56 },
  ski: [
    { name: 'Monte Magnola', lat: 42.14991, lng: 13.49475 }, // Dolce Vita lower station, 1438 m
    { name: 'Campo Felice', lat: 42.2135, lng: 13.47943 }, // Brecciara, 1428 m
  ],
  // Drive time is measured from Rome, where weekend trips start (L'Aquila
  // is always closer, which would say nothing about the trip).
  gates: [
    { name: 'Roma', lat: 41.9028, lng: 12.4964 },
  ],
  // OMI (Agenzia delle Entrate), 1st semester 2026, residential sales in
  // "normal" condition, €/m²: [min, max] for the central zone (B1) of each
  // comune. Reference for the deals analysis.
  omi: {
    'Ovindoli': { civili: [1000, 1400], villini: [1100, 1600] },
    'Rocca di Mezzo': { civili: [1250, 1850], villini: [1450, 2100] },
    'Rocca di Cambio': { civili: [930, 1350], villini: [970, 1450] },
  },
}

// Frazioni the owner doesn't want (Nov 2026): homes there are left out of
// the portal, whatever the source calls the comune.
export const EXCLUDED = new Set(['Santa Jona', 'San Potito'])
// Whole comuni left out (Nov 2026). Their places stay listed above so a home
// there is recognised and dropped, not pinned to the nearest other village.
export const EXCLUDED_COMUNI = new Set(['Rocca di Cambio'])

// Ads spell Santa Jona as "Santa Iona" too.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\bsanta iona\b/g, 'santa jona')
const NAMED = [...PLACES].sort((a, b) => b.name.length - a.name.length) // "Rocca di Mezzo" before "Rocca"

// Zone (comune) and town (frazione) of a home, or null when outside the
// plateau. The address text wins when it names a place (portal coordinates
// are often just the comune centroid); otherwise the closest place within
// 4 km of the coordinates.
export const zoneOf = (lat, lng, text) => {
  const b = AREA.bounds
  if (!(lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng)) return null
  const t = ` ${norm(text)} `
  const named = NAMED.find((p) => t.includes(` ${norm(p.name)} `) || (p.name === 'Fontavignone' && t.includes(' fonteavignone ')))
  const place = named || PLACES.reduce((best, p) => {
    const d = haversineM({ lat, lng }, p)
    return d < 4000 && (!best || d < best.d) ? { ...p, d } : best
  }, null)
  if (!place || EXCLUDED.has(place.name) || EXCLUDED_COMUNI.has(place.comune)) return null
  return { zone: place.comune, town: HAMLETS.has(place.name) ? place.comune : place.name }
}
