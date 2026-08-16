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
    banner: '🌊 Annunci reali con foto da MyHome.ie e Rightmove — coste e laghi di Scozia + Donegal (Irlanda) · usa il filtro Zona · aggiornato {date}',
    all_zones: 'Tutte le zone', sale_rent: 'Vendita e affitto', for_sale: 'In vendita', for_rent: 'In affitto',
    all_types: 'Tutti i tipi', adv_filters: 'Filtri avanzati', favourites: 'Preferiti', sea_view: '🌊 Vista mare',
    garden: '🌳 Giardino', seen_badge: 'Vista', new_badge: 'Nuovo',
    sold_chip: 'Vendute', sold_found: '{n} vendute o ritirate', st_sold: 'Venduta', st_sale_agreed: 'Offerta accettata', st_removed: 'Ritirata', sold_meta: 'rimossa il {d} · in vendita ≥{n} giorni',
    price_any: '💶 Prezzo', price_label: 'Prezzo', price_upto: 'Fino a {v}', price_over: 'Oltre {v}', price_clear: 'Azzera',
    fresh_all: '📅 Aggiunte: tutte', fresh_1: 'Aggiunte oggi', fresh_3: 'Aggiunte: ultimi 3 giorni', fresh_7: 'Aggiunte: ultima settimana', fresh_visit: 'Dalla mia ultima visita',
    added_title: 'Data di ingresso nel portale', st_added: 'Nel portale dal',
    f_price: 'Prezzo', f_area: 'Superficie (m²)', f_rooms: 'Camere (min)', f_baths: 'Bagni (min)',
    f_features: 'Caratteristiche', any: 'Qualsiasi', reset: 'Azzera', apply: 'Applica filtri', min: 'Min', max: 'Max',
    found_one: '{n} immobile trovato', found_many: '{n} immobili trovati',
    sort_rel: 'Rilevanza', sort_pasc: 'Prezzo ↑', sort_pdesc: 'Prezzo ↓', sort_sdesc: 'Superficie ↓', sort_new: 'Più recenti', sort_dist: 'Distanza',
    empty1: 'Nessun immobile trovato con questi criteri.', empty2: "Prova ad allargare l'area sulla mappa o ad azzerare i filtri.",
    tag_sale: 'Vendita', tag_rent: 'Affitto',
    bed_one: '{n} camera', bed_many: '{n} camere',
    bath_one: '{n} bagno', bath_many: '{n} bagni',
    dist_from_you: 'a {d} da te', view_on: 'Vedi su {host}',
    map_search_area: '🔗 La lista segue la mappa', map_see_all: '⛶ Vedi tutto', pop_full: 'Scheda completa →',
    al_chip: 'Avvisi', al_title: 'Avvisi sulle case',
    al_news: 'Novità per i tuoi avvisi', al_read: 'Segna letti',
    al_new_alert: 'Nuovo avviso — avvisami quando esce qualcosa così:',
    al_all_zones: 'Tutte le zone', al_any_price: 'Qualsiasi prezzo', al_upto: 'Fino a {v}',
    al_any_rooms: 'Camere: qualsiasi', al_rooms: 'camere',
    al_ev_new: 'Nuove case', al_ev_drop: 'Ribassi di prezzo', al_ev_sold: 'Vendute/ritirate',
    al_save: '🔔 Attiva avviso', al_del: 'Elimina avviso', al_was: 'era', al_gone: 'venduta o ritirata',
    al_push_title: 'Notifiche push (anche a portale chiuso)',
    al_push_on: '✅ Notifiche attive su questo dispositivo: prova la consegna col bottone qui sotto.',
    al_push_off: 'Non ancora attive su questo dispositivo: premi il bottone e consenti le notifiche quando il browser lo chiede.',
    al_push_denied: '⚠️ Notifiche bloccate dal browser: riattivale dalle impostazioni del sito (icona lucchetto nella barra degli indirizzi), poi riapri questo pannello.',
    al_push_err: '⚠️ Attivazione non riuscita ({e}). Riprova col bottone qui sotto.',
    al_push_ios: '📱 Su iPhone/iPad: apri il portale in Safari → tasto Condividi → «Aggiungi alla schermata Home», poi apri CasaTrova da quell\'icona e attiva le notifiche da qui.',
    al_push_unsupported: 'Questo browser non supporta le notifiche push: le novità compaiono comunque in questo pannello.',
    al_push_btn: '🔔 Attiva le notifiche su questo dispositivo',
    al_push_test: '📨 Invia una notifica di prova',
    t_push_sent: 'Notifica di prova inviata 📨 controlla che arrivi', t_push_fail: 'Invio di prova non riuscito ⚠️', t_push_nosub: 'Prima attiva le notifiche 🔔',
    t_al_saved: 'Avviso attivato 🔔', t_al_news: '🔔 {n} novità per i tuoi avvisi',
    map_agent_here: '🤖 Trova nuove case qui',
    t_agent_zoom: 'Zooma prima sulla zona che ti interessa 🔍', t_agent_sent: "Conferma la richiesta su GitHub: l'agente aggiungerà le case di questa zona al prossimo aggiornamento 🤖",
    agent_title: '🤖 Nuove case in quest\'area',
    agent_locating: 'Identifico la zona sulla mappa…',
    agent_zone: 'Zona richiesta',
    agent_explain: '«🔗 La lista segue la mappa» mostra solo le case già nel portale; da qui invece chiedi all\'agente di cercare NUOVE case in quest\'area.',
    agent_howto: 'Premendo «Invia la richiesta» si apre GitHub (il sito che ospita il portale) con la richiesta già compilata: conferma col pulsante verde «Create». Le nuove case compaiono col prossimo aggiornamento quotidiano, entro 24 ore.',
    agent_howto_direct: "Premendo «Invia la richiesta» la richiesta parte subito, senza login: l'agente cerca le case e le pubblica di solito in pochi minuti — ricarica il portale poco dopo.",
    agent_send: '📨 Invia la richiesta', agent_sending: 'Invio…', agent_cancel: 'Annulla',
    agst_working: "🔎 L'agente sta cercando le case nell'area…",
    agst_publishing: '🏠 Trovate {n} case — pubblicazione sul portale…',
    agst_ready: '✅ Fatto! {n} case in «{zone}» — già sulla mappa.',
    agst_none: "ℹ️ Richiesta gestita: al momento non c'è nulla in vendita in quell'area.",
    agst_deferred: "⏳ La ricerca immediata non è riuscita: ci pensa l'agente stanotte alle 06:00.",
    agent_reload: 'Ricarica il portale',
    agent_fallback: 'Invio diretto non riuscito — invia da GitHub →',
    t_agent_ok: 'Richiesta inviata ✅ L\'agente ci lavora: ricarica il portale tra qualche minuto',
    t_agent_dup: "C'è già una richiesta in coda per questa zona 👍",
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
    banner: '🌊 Real listings with photos from MyHome.ie and Rightmove — Scotland coasts & lochs + Donegal (Ireland) · use the Zone filter · updated {date}',
    all_zones: 'All areas', sale_rent: 'Sale & rent', for_sale: 'For sale', for_rent: 'To rent',
    all_types: 'All types', adv_filters: 'Advanced filters', favourites: 'Favourites', sea_view: '🌊 Sea view',
    garden: '🌳 Garden', seen_badge: 'Seen', new_badge: 'New',
    sold_chip: 'Sold', sold_found: '{n} sold or withdrawn', st_sold: 'Sold', st_sale_agreed: 'Sale agreed', st_removed: 'Withdrawn', sold_meta: 'removed {d} · listed ≥{n} days',
    price_any: '💶 Price', price_label: 'Price', price_upto: 'Up to {v}', price_over: 'Over {v}', price_clear: 'Clear',
    fresh_all: '📅 Added: all', fresh_1: 'Added today', fresh_3: 'Added: last 3 days', fresh_7: 'Added: last week', fresh_visit: 'Since my last visit',
    added_title: 'Date it entered the portal', st_added: 'On portal since',
    f_price: 'Price', f_area: 'Area (m²)', f_rooms: 'Bedrooms (min)', f_baths: 'Bathrooms (min)',
    f_features: 'Features', any: 'Any', reset: 'Reset', apply: 'Apply filters', min: 'Min', max: 'Max',
    found_one: '{n} property found', found_many: '{n} properties found',
    sort_rel: 'Relevance', sort_pasc: 'Price ↑', sort_pdesc: 'Price ↓', sort_sdesc: 'Area ↓', sort_new: 'Newest', sort_dist: 'Distance',
    empty1: 'No properties match these filters.', empty2: 'Try widening the map area or resetting the filters.',
    tag_sale: 'Sale', tag_rent: 'Rent',
    bed_one: '{n} bedroom', bed_many: '{n} bedrooms',
    bath_one: '{n} bathroom', bath_many: '{n} bathrooms',
    dist_from_you: '{d} from you', view_on: 'View on {host}',
    map_search_area: '🔗 List follows the map', map_see_all: '⛶ See all', pop_full: 'Full details →',
    al_chip: 'Alerts', al_title: 'Home alerts',
    al_news: 'News for your alerts', al_read: 'Mark read',
    al_new_alert: 'New alert — notify me when something like this appears:',
    al_all_zones: 'All areas', al_any_price: 'Any price', al_upto: 'Up to {v}',
    al_any_rooms: 'Bedrooms: any', al_rooms: 'bedrooms',
    al_ev_new: 'New homes', al_ev_drop: 'Price drops', al_ev_sold: 'Sold/withdrawn',
    al_save: '🔔 Enable alert', al_del: 'Delete alert', al_was: 'was', al_gone: 'sold or withdrawn',
    al_push_title: 'Push notifications (portal closed too)',
    al_push_on: '✅ Notifications active on this device: try delivery with the button below.',
    al_push_off: 'Not active on this device yet: press the button and allow notifications when the browser asks.',
    al_push_denied: '⚠️ Notifications blocked by the browser: re-enable them from the site settings (padlock icon in the address bar), then reopen this panel.',
    al_push_err: '⚠️ Activation failed ({e}). Retry with the button below.',
    al_push_ios: '📱 On iPhone/iPad: open the portal in Safari → Share → "Add to Home Screen", then open CasaTrova from that icon and enable notifications here.',
    al_push_unsupported: 'This browser does not support push notifications: news still appears in this panel.',
    al_push_btn: '🔔 Enable notifications on this device',
    al_push_test: '📨 Send a test notification',
    t_push_sent: 'Test notification sent 📨 check it arrives', t_push_fail: 'Test send failed ⚠️', t_push_nosub: 'Enable notifications first 🔔',
    t_al_saved: 'Alert enabled 🔔', t_al_news: '🔔 {n} updates for your alerts',
    map_agent_here: '🤖 Find new homes here',
    t_agent_zoom: 'Zoom in on the area you want first 🔍', t_agent_sent: 'Confirm the request on GitHub: the agent will add homes for this area on its next update 🤖',
    agent_title: '🤖 New homes in this area',
    agent_locating: 'Identifying the map area…',
    agent_zone: 'Requested area',
    agent_explain: '"🔗 List follows the map" only shows homes already on the portal; this instead asks the agent to hunt for NEW homes in this area.',
    agent_howto: 'Pressing "Send the request" opens GitHub (the site hosting this portal) with the request pre-filled: confirm with the green "Create" button. The new homes appear with the next daily update, within 24 hours.',
    agent_howto_direct: 'Pressing "Send the request" files it right away, no login needed: the agent hunts for homes and usually publishes them within minutes — reload the portal shortly after.',
    agent_send: '📨 Send the request', agent_sending: 'Sending…', agent_cancel: 'Cancel',
    agst_working: '🔎 The agent is hunting for homes in the area…',
    agst_publishing: '🏠 Found {n} homes — publishing to the portal…',
    agst_ready: '✅ Done! {n} homes in "{zone}" — already on the map.',
    agst_none: 'ℹ️ Request handled: nothing is for sale in that area right now.',
    agst_deferred: '⏳ Instant search failed: the daily agent takes over tonight at 06:00.',
    agent_reload: 'Reload the portal',
    agent_fallback: 'Direct send failed — send via GitHub →',
    t_agent_ok: 'Request sent ✅ The agent is on it: reload the portal in a few minutes',
    t_agent_dup: 'A request for this area is already queued 👍',
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

// Shared price bands (numeric; min inclusive, max exclusive). Used by the
// multi-select price filter and the filtering logic.
export const PRICE_RANGES = [
  { id: 'a', min: null, max: 250000 },
  { id: 'b', min: 250000, max: 500000 },
  { id: 'c', min: 500000, max: 750000 },
  { id: 'd', min: 750000, max: 1000000 },
  { id: 'e', min: 1000000, max: null },
]

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
