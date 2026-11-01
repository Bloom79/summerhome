// Regions: each one is a separate set of data files and a separate map.
// Picked once per page load from ?r=<id> (shareable link), else the last
// region used on this device, else the original Scotland & Ireland portal.
// Switching reloads the page, so every module can read REGION as a constant.

const REGIONS = {
  uk: {
    id: 'uk',
    name: 'Scozia e Irlanda',
    nameEn: 'Scotland & Ireland',
    flag: '🇬🇧',
    dir: '', // files at the site root, as before
    // Airports relevant to the coasts; the detail shows driving time from
    // the closest one.
    gates: [
      ['Edimburgo', 55.9508, -3.3615],
      ['Glasgow', 55.8642, -4.4331],
      ['Inverness', 57.5425, -4.0475],
      ['Aberdeen', 57.2019, -2.1978],
      ['Dublino', 53.4264, -6.2499],
      ['Donegal', 55.0442, -8.3410],
    ],
    travelSteps: [90, 150, 240],
    types: ['Cottage', 'Casa indipendente', 'Villa', 'Appartamento', 'Bungalow'],
    sea: true, // sea-view and beach chips, beach POI
    ski: false,
    nearFeat: 'Spiaggia', // tag behind the beach/ski chip
    cercaQui: true, // "Trova nuove case qui" agent (UK/IE only)
    push: true, // push alerts via the Cloudflare Worker
    gbp: true, // £/€ toggle
  },
  it: {
    id: 'it',
    name: 'Altopiano delle Rocche',
    nameEn: 'Altopiano delle Rocche',
    flag: '🇮🇹',
    dir: 'it/',
    // Driving time from Rome, where weekend trips start. Every home on the
    // plateau is ~1h30–1h45 away, so there is no drive-time filter.
    gates: [['Roma', 41.9028, 12.4964]],
    travelSteps: [],
    types: ['Appartamento', 'Casa indipendente', 'Villa', 'Villetta a schiera', 'Baita', 'Rustico'],
    sea: false,
    ski: true, // ⛷ near-the-lifts chip and distance to the lifts
    nearFeat: 'Vicino piste', // ≤ 3 km from a ski-lift base (scripts/it)
    cercaQui: false,
    push: false,
    gbp: false,
  },
}

const pick = () => {
  let id = null
  try { id = new URLSearchParams(location.search).get('r') } catch { /* no location */ }
  if (!REGIONS[id]) { try { id = localStorage.getItem('ct_region') } catch { /* blocked */ } }
  if (!REGIONS[id]) id = 'uk'
  try { localStorage.setItem('ct_region', id) } catch { /* blocked */ }
  return REGIONS[id]
}

export const REGION = pick()
export const REGION_LIST = Object.values(REGIONS)

// URL of a data file of the current region (data.json, deals.json, trends.json).
export const dataUrl = (file) => `${import.meta.env.BASE_URL}${REGION.dir}${file}`

// localStorage key for per-region state (filters, alerts, snapshots). The
// UK region keeps the original keys, so nothing is lost for existing users.
export const rk = (key) => (REGION.id === 'uk' ? key : `${key}_${REGION.id}`)

export const switchRegion = (id) => {
  if (!REGIONS[id] || id === REGION.id) return
  try { localStorage.setItem('ct_region', id) } catch { /* blocked */ }
  const u = new URL(location.href)
  u.searchParams.set('r', id)
  u.searchParams.delete('q') // a shared search belongs to the region it came from
  location.href = u.toString()
}
