import { createContext, useContext, useState } from 'react'
import { hostOf } from './utils.js'

// Property type labels IT -> EN
const TYPES = {
  'Casa indipendente': 'Detached house',
  'Cottage': 'Cottage',
  'Villa': 'Villa',
  'Appartamento': 'Apartment',
  'Bungalow': 'Bungalow',
}

// Feature tag labels IT -> EN
const FEATS = {
  'Garage': 'Garage', 'Giardino': 'Garden', 'Terreno': 'Land', 'Da ammodernare': 'Needs modernisation',
  'Vista mare': 'Sea view', 'Fronte porto': 'Harbour front', 'Vicino spiaggia': 'Near beach',
  'Vicino golf': 'Near golf', 'Centro storico': 'Historic centre',
}

const STR = {
  it: {
    search_ph: 'Cerca zona o indirizzo… (es. Burtonport, North Berwick, Crail)',
    near_me: '📍 Vicino a me',
    banner: '🌊 Annunci reali con foto dai portali (MyHome.ie · Rightmove) — coste di Donegal e Scozia: Burtonport · North Berwick · Rosemarkie · East Neuk · aggiornato {date}',
    all_zones: 'Tutte le zone', sale_rent: 'Vendita e affitto', for_sale: 'In vendita', for_rent: 'In affitto',
    all_types: 'Tutti i tipi', adv_filters: 'Filtri avanzati', favourites: 'Preferiti',
    f_price: 'Prezzo', f_area: 'Superficie (m²)', f_rooms: 'Camere (min)', f_baths: 'Bagni (min)',
    f_features: 'Caratteristiche', any: 'Qualsiasi', reset: 'Azzera', apply: 'Applica filtri', min: 'Min', max: 'Max',
    found_one: '{n} immobile trovato', found_many: '{n} immobili trovati',
    sort_rel: 'Rilevanza', sort_pasc: 'Prezzo ↑', sort_pdesc: 'Prezzo ↓', sort_sdesc: 'Superficie ↓', sort_new: 'Più recenti', sort_dist: 'Distanza',
    empty1: 'Nessun immobile trovato con questi criteri.', empty2: "Prova ad allargare l'area sulla mappa o ad azzerare i filtri.",
    tag_sale: 'Vendita', tag_rent: 'Affitto',
    bed_one: '{n} camera', bed_many: '{n} camere',
    bath_one: '{n} bagno', bath_many: '{n} bagni',
    dist_from_you: 'a {d} da te', view_on: 'Vedi su {host}',
    map_search_area: "🗺️ Cerca in quest'area", map_see_all: '⛶ Vedi tutto', pop_full: 'Scheda completa →',
    src_label: 'Fonte', st_area: 'Superficie', st_rooms: 'Camere', st_baths: 'Bagni', st_floor: 'Piano', st_year: 'Anno', st_epc: 'Classe energ.',
    loc_title: '📌 Localizzazione precisa', loc_gmaps: 'Apri in Google Maps', loc_street: 'Street View', loc_show_map: 'Mostra sulla mappa',
    view_original: '🔗 Vedi annuncio originale (foto e dettagli)', save: '🤍 Salva', saved: '❤️ Salvato',
    gal_ph: 'Le foto sono nell\'annuncio originale', gal_open: '📷 Apri l\'annuncio con le foto →',
    vt_list: '☰ Lista', vt_map: '🗺️ Mappa',
    t_geo_no: 'Geolocalizzazione non supportata', t_geo_locating: 'Rilevo la tua posizione…', t_geo_sorted: 'Ordinati per distanza da te', t_geo_fail: 'Impossibile rilevare la posizione',
    t_fav_added: 'Aggiunto ai preferiti ❤️', t_dist_hint: 'Prima attiva "Vicino a me" 📍', here: '📍 Sei qui',
    desc: (l, tl) => `${tl(l.type)}${l.rooms ? ` di ${l.rooms} camere` : ''} a ${l.town}. Annuncio reale su ${hostOf(l.url)} — apri la fonte per foto e dettagli.`,
  },
  en: {
    search_ph: 'Search area or address… (e.g. Burtonport, North Berwick, Crail)',
    near_me: '📍 Near me',
    banner: '🌊 Real listings with photos from the portals (MyHome.ie · Rightmove) — Donegal & Scotland coasts: Burtonport · North Berwick · Rosemarkie · East Neuk · updated {date}',
    all_zones: 'All areas', sale_rent: 'Sale & rent', for_sale: 'For sale', for_rent: 'To rent',
    all_types: 'All types', adv_filters: 'Advanced filters', favourites: 'Favourites',
    f_price: 'Price', f_area: 'Area (m²)', f_rooms: 'Bedrooms (min)', f_baths: 'Bathrooms (min)',
    f_features: 'Features', any: 'Any', reset: 'Reset', apply: 'Apply filters', min: 'Min', max: 'Max',
    found_one: '{n} property found', found_many: '{n} properties found',
    sort_rel: 'Relevance', sort_pasc: 'Price ↑', sort_pdesc: 'Price ↓', sort_sdesc: 'Area ↓', sort_new: 'Newest', sort_dist: 'Distance',
    empty1: 'No properties match these filters.', empty2: 'Try widening the map area or resetting the filters.',
    tag_sale: 'Sale', tag_rent: 'Rent',
    bed_one: '{n} bedroom', bed_many: '{n} bedrooms',
    bath_one: '{n} bathroom', bath_many: '{n} bathrooms',
    dist_from_you: '{d} from you', view_on: 'View on {host}',
    map_search_area: '🗺️ Search this area', map_see_all: '⛶ See all', pop_full: 'Full details →',
    src_label: 'Source', st_area: 'Area', st_rooms: 'Bedrooms', st_baths: 'Bathrooms', st_floor: 'Floor', st_year: 'Year', st_epc: 'EPC',
    loc_title: '📌 Exact location', loc_gmaps: 'Open in Google Maps', loc_street: 'Street View', loc_show_map: 'Show on map',
    view_original: '🔗 View original listing (photos & details)', save: '🤍 Save', saved: '❤️ Saved',
    gal_ph: 'Photos are on the original listing', gal_open: '📷 Open the listing with photos →',
    vt_list: '☰ List', vt_map: '🗺️ Map',
    t_geo_no: 'Geolocation not supported', t_geo_locating: 'Finding your location…', t_geo_sorted: 'Sorted by distance from you', t_geo_fail: 'Could not get your location',
    t_fav_added: 'Added to favourites ❤️', t_dist_hint: 'Turn on "Near me" first 📍', here: '📍 You are here',
    desc: (l, tl) => `${tl(l.type)}${l.rooms ? ` with ${l.rooms} bedroom${l.rooms > 1 ? 's' : ''}` : ''} in ${l.town}. Real listing on ${hostOf(l.url)} — open the source for photos and details.`,
  },
}

const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLang] = useState('it')
  const t = (k, vars) => {
    let s = STR[lang][k] ?? STR.it[k] ?? k
    if (typeof s === 'string' && vars) for (const [kk, vv] of Object.entries(vars)) s = s.replaceAll('{' + kk + '}', vv)
    return s
  }
  const typeLabel = (ty) => (lang === 'en' ? (TYPES[ty] || ty) : ty)
  const featLabel = (f) => (lang === 'en' ? (FEATS[f] || f) : f)
  const listingDesc = (l) => STR[lang].desc(l, typeLabel)
  return (
    <LangContext.Provider value={{ lang, setLang, t, typeLabel, featLabel, listingDesc }}>
      {children}
    </LangContext.Provider>
  )
}

export const useI18n = () => useContext(LangContext)
