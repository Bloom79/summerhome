// ================= DATI ANNUNCI =================
// Il portale è focalizzato SOLO su queste zone costiere:
//   • Burtonport / The Rosses — County Donegal, Irlanda (EUR)
//   • North Berwick — East Lothian, Scozia (GBP)
//   • Rosemarkie / Fortrose — Black Isle, Highland, Scozia (GBP)
//   • East Neuk of Fife (Anstruther, Crail, Pittenweem, St Monans, Elie) — Scozia (GBP)
//
// Questo file viene rigenerato automaticamente ogni giorno dall'agente di
// aggiornamento (vedi README → "Agente giornaliero"). Mantieni la struttura:
// l'app importa LAST_UPDATED, ZONES, FEATURES, IMGS e LISTINGS.

export const LAST_UPDATED = '2026-08-09'

export const ZONES = [
  'Burtonport (Donegal, IE)',
  'North Berwick (Scozia)',
  'Rosemarkie (Scozia)',
  'East Neuk (Fife, Scozia)',
]

const U = (id, seed) => [
  `https://images.unsplash.com/photo-${id}?w=900&q=60&auto=format&fit=crop`,
  seed,
]

export const IMGS = {
  h1: U('1568605114967-8130f3a36994', 'casa1'), h2: U('1570129477492-45c003edd2be', 'casa2'),
  h3: U('1564013799919-ab600027ffc6', 'casa3'), h4: U('1512917774080-9991f1c4c750', 'casa4'),
  h5: U('1580587771525-78b9dba3b914', 'casa5'), h6: U('1600596542815-ffad4c1539a9', 'casa6'),
  h7: U('1600585154340-be6161a56a0c', 'casa7'), i1: U('1600607687939-ce8a6c25118c', 'int1'),
  i2: U('1600566753086-00f18fb6b3ea', 'int2'), i3: U('1502672260266-1c1ef2d93688', 'int3'),
  i4: U('1522708323590-d24dbb6b0267', 'int4'), i5: U('1560448204-e02f11c3d0e2', 'int5'),
  i6: U('1493809842364-78817add7ffb', 'int6'), v1: U('1583608205776-bfd35f0d9f83', 'villa1'),
  v2: U('1613490493576-7fde63acd811', 'villa2'), v3: U('1613977257363-707ba9348227', 'villa3'),
  h8: U('1600047509807-ba8f99d2cdde', 'casa8'), h9: U('1600585152220-90363fe7e115', 'casa9'),
  i7: U('1600607687920-4e2a09cf159d', 'int7'), i8: U('1600210492486-724fe5c67fb0', 'int8'),
}

export const FEATURES = [
  'Giardino', 'Terrazzo', 'Vista mare', 'Garage', 'Posto auto', 'Camino',
  'Camino a legna', 'Cantina', 'Arredato', 'Fronte porto', 'Vicino golf', 'Ristrutturato',
]

// currency: 'EUR' per l'Irlanda (Burtonport), 'GBP' per la Scozia.
export const LISTINGS = [
  // ---------- Burtonport / The Rosses — Donegal, Irlanda (EUR) ----------
  { id: 1, title: 'Cottage in pietra con vista su Arranmore', type: 'Cottage', contract: 'sale', price: 245000, currency: 'EUR', size: 110, rooms: 3, baths: 2, floor: 'Su 2 livelli', year: 1930, energy: 'D', zone: 'Burtonport (Donegal, IE)', town: 'Burtonport', addr: 'Ailt an Chorráin, Burtonport, Co. Donegal', lat: 54.98790, lng: -8.44060, imgs: ['h1', 'h5', 'i1'], feats: ['Vista mare', 'Camino a legna', 'Giardino'], desc: 'Tradizionale cottage irlandese in pietra a due passi dal porticciolo di Burtonport, con vista sull\'isola di Arranmore. Ristrutturato mantenendo il camino originale, ideale come casa vacanza sulla Wild Atlantic Way.', date: '2026-08-06' },
  { id: 2, title: 'Casa indipendente nel centro di Dungloe', type: 'Casa indipendente', contract: 'sale', price: 210000, currency: 'EUR', size: 130, rooms: 4, baths: 2, floor: 'Su 2 livelli', year: 1975, energy: 'C', zone: 'Burtonport (Donegal, IE)', town: 'Dungloe', addr: 'Main Street, Dungloe, Co. Donegal', lat: 54.94910, lng: -8.36110, imgs: ['h2', 'i3', 'i6'], feats: ['Giardino', 'Posto auto', 'Camino'], desc: 'Ampia casa familiare nel cuore di Dungloe, la "capitale" delle Rosses, vicino a negozi e servizi. Quattro camere, giardino sul retro e garage.', date: '2026-08-04' },
  { id: 3, title: 'Bungalow fronte mare a Kincasslagh', type: 'Bungalow', contract: 'sale', price: 320000, currency: 'EUR', size: 145, rooms: 4, baths: 3, floor: 'Piano terra', year: 2004, energy: 'B', zone: 'Burtonport (Donegal, IE)', town: 'Kincasslagh', addr: 'Kincasslagh, Co. Donegal', lat: 55.03020, lng: -8.40900, imgs: ['h6', 'i7', 'i2'], feats: ['Vista mare', 'Giardino', 'Posto auto'], desc: 'Bungalow moderno affacciato sulla baia di Kincasslagh, con ampie vetrate sul mare e accesso diretto alla spiaggia. Vicino a Cruit Island e al Donegal Airport.', date: '2026-08-08' },
  { id: 4, title: 'Cottage da ristrutturare a Meenmore', type: 'Cottage', contract: 'rent', price: 900, currency: 'EUR', size: 80, rooms: 2, baths: 1, floor: 'Piano terra', year: 1940, energy: 'E', zone: 'Burtonport (Donegal, IE)', town: 'Burtonport', addr: 'Meenmore, Burtonport, Co. Donegal', lat: 54.96500, lng: -8.40000, imgs: ['h8', 'i4', 'h3'], feats: ['Camino a legna', 'Giardino', 'Arredato'], desc: 'Piccolo cottage di campagna in affitto a lungo termine tra Dungloe e Burtonport, con giardino e stufa a legna. Perfetto per chi cerca tranquillità sulla costa atlantica.', date: '2026-08-07' },

  // ---------- North Berwick — East Lothian, Scozia (GBP) ----------
  { id: 5, title: 'Villa vittoriana a due passi dalla spiaggia', type: 'Villa', contract: 'sale', price: 695000, currency: 'GBP', size: 210, rooms: 5, baths: 3, floor: 'Su 3 livelli', year: 1898, energy: 'D', zone: 'North Berwick (Scozia)', town: 'North Berwick', addr: 'Marine Parade, North Berwick, EH39', lat: 56.05930, lng: -2.71620, imgs: ['v2', 'h7', 'i1', 'i5'], feats: ['Vista mare', 'Giardino', 'Camino', 'Ristrutturato'], desc: 'Elegante villa vittoriana sul lungomare di North Berwick, con vista sul Firth of Forth e sul Bass Rock. Soffitti alti, cornici originali e giardino recintato. A pochi minuti dalla stazione per Edimburgo.', date: '2026-08-05' },
  { id: 6, title: 'Appartamento con vista sul Bass Rock', type: 'Appartamento', contract: 'sale', price: 415000, currency: 'GBP', size: 95, rooms: 3, baths: 2, floor: '2° con ascensore', year: 2016, energy: 'B', zone: 'North Berwick (Scozia)', town: 'North Berwick', addr: 'Melbourne Road, North Berwick, EH39', lat: 56.05780, lng: -2.72400, imgs: ['i5', 'i8', 'h4'], feats: ['Vista mare', 'Posto auto', 'Ristrutturato'], desc: 'Appartamento di nuova costruzione con balcone affacciato sul mare e sull\'iconico Bass Rock. Finiture di pregio, posto auto assegnato e a breve distanza dal porto e dai campi da golf.', date: '2026-08-03' },
  { id: 7, title: 'Casa signorile vicino al golf di Gullane', type: 'Casa indipendente', contract: 'sale', price: 780000, currency: 'GBP', size: 240, rooms: 5, baths: 4, floor: 'Su 2 livelli', year: 1932, energy: 'C', zone: 'North Berwick (Scozia)', town: 'Gullane', addr: 'Sandy Loan, Gullane, EH31', lat: 56.03500, lng: -2.82800, imgs: ['v1', 'h5', 'i2', 'i7'], feats: ['Giardino', 'Garage', 'Vicino golf', 'Camino'], desc: 'Prestigiosa villa in arenaria a Gullane, a pochi passi dai celebri links di Muirfield. Ampio giardino, garage doppio e interni luminosi con camino in ogni salone.', date: '2026-07-30' },
  { id: 8, title: 'Cottage nel villaggio di Dirleton', type: 'Cottage', contract: 'rent', price: 1600, currency: 'GBP', size: 100, rooms: 3, baths: 2, floor: 'Su 2 livelli', year: 1890, energy: 'D', zone: 'North Berwick (Scozia)', town: 'Dirleton', addr: 'The Green, Dirleton, EH39', lat: 56.04500, lng: -2.78300, imgs: ['h1', 'i6', 'i3'], feats: ['Giardino', 'Camino a legna', 'Arredato'], desc: 'Grazioso cottage affacciato sul green del villaggio di Dirleton, di fronte al castello. Affitto a lungo termine, arredato, con giardino e stufa a legna.', date: '2026-08-02' },

  // ---------- Rosemarkie / Fortrose — Black Isle, Scozia (GBP) ----------
  { id: 9, title: 'Casa fronte mare sulla spiaggia di Rosemarkie', type: 'Casa indipendente', contract: 'sale', price: 465000, currency: 'GBP', size: 175, rooms: 4, baths: 2, floor: 'Su 2 livelli', year: 1928, energy: 'D', zone: 'Rosemarkie (Scozia)', town: 'Rosemarkie', addr: 'Marine Terrace, Rosemarkie, IV10', lat: 57.58520, lng: -4.11760, imgs: ['h7', 'i1', 'i8'], feats: ['Vista mare', 'Giardino', 'Camino'], desc: 'Casa in arenaria direttamente sulla spiaggia di Rosemarkie, con vista sul Moray Firth dove si avvistano i delfini. Giardino fronte mare e accesso diretto alla battigia.', date: '2026-08-06' },
  { id: 10, title: 'Cottage vicino alla cattedrale di Fortrose', type: 'Cottage', contract: 'sale', price: 298000, currency: 'GBP', size: 105, rooms: 3, baths: 1, floor: 'Su 2 livelli', year: 1900, energy: 'E', zone: 'Rosemarkie (Scozia)', town: 'Fortrose', addr: 'Cathedral Square, Fortrose, IV10', lat: 57.58010, lng: -4.13320, imgs: ['h2', 'i6', 'h3'], feats: ['Camino a legna', 'Giardino', 'Ristrutturato'], desc: 'Caratteristico cottage a pochi passi dalle rovine della cattedrale di Fortrose e dal porticciolo. Travi a vista, stufa a legna e cortile riservato.', date: '2026-08-01' },
  { id: 11, title: 'Bungalow panoramico sul Moray Firth', type: 'Bungalow', contract: 'sale', price: 385000, currency: 'GBP', size: 150, rooms: 4, baths: 2, floor: 'Piano terra', year: 1998, energy: 'C', zone: 'Rosemarkie (Scozia)', town: 'Rosemarkie', addr: 'Greenside, Rosemarkie, IV10', lat: 57.58330, lng: -4.12140, imgs: ['h6', 'i7', 'i2'], feats: ['Vista mare', 'Garage', 'Giardino'], desc: 'Ampio bungalow con giardino terrazzato e vista aperta sul Moray Firth e su Chanonry Point. Ideale per chi cerca comodità su un unico livello e panorami sul mare.', date: '2026-07-29' },
  { id: 12, title: 'Appartamento vicino a Chanonry Point', type: 'Appartamento', contract: 'rent', price: 1200, currency: 'GBP', size: 70, rooms: 2, baths: 1, floor: '1°', year: 1965, energy: 'D', zone: 'Rosemarkie (Scozia)', town: 'Rosemarkie', addr: 'Ness Road, Rosemarkie, IV10', lat: 57.57680, lng: -4.10250, imgs: ['i5', 'i4', 'h4'], feats: ['Vista mare', 'Arredato', 'Posto auto'], desc: 'Luminoso appartamento in affitto vicino a Chanonry Point, uno dei migliori punti d\'Europa per avvistare i delfini. Arredato, con posto auto.', date: '2026-08-07' },

  // ---------- East Neuk of Fife — Scozia (GBP) ----------
  { id: 13, title: 'Cottage del pescatore a Crail', type: 'Cottage', contract: 'sale', price: 425000, currency: 'GBP', size: 120, rooms: 3, baths: 2, floor: 'Su 2 livelli', year: 1780, energy: 'E', zone: 'East Neuk (Fife, Scozia)', town: 'Crail', addr: 'Shoregate, Crail, KY10', lat: 56.26010, lng: -2.62760, imgs: ['h1', 'i3', 'i1'], feats: ['Fronte porto', 'Vista mare', 'Camino a legna'], desc: 'Storico cottage del XVIII secolo sul pittoresco porticciolo di Crail, uno degli scorci più fotografati di Scozia. Muri in pietra, stufa a legna e vista diretta sul porto.', date: '2026-08-05' },
  { id: 14, title: 'Casa sul porto di Anstruther', type: 'Casa indipendente', contract: 'sale', price: 535000, currency: 'GBP', size: 160, rooms: 4, baths: 3, floor: 'Su 3 livelli', year: 1850, energy: 'D', zone: 'East Neuk (Fife, Scozia)', town: 'Anstruther', addr: 'Shore Street, Anstruther, KY10', lat: 56.22100, lng: -2.70020, imgs: ['h7', 'i8', 'i2', 'h5'], feats: ['Fronte porto', 'Vista mare', 'Ristrutturato'], desc: 'Elegante casa a schiera vittoriana affacciata sul porto di Anstruther, sopra la celebre gelateria e il fish bar. Tre livelli con vista sul Firth of Forth e sull\'Isola di May.', date: '2026-08-08' },
  { id: 15, title: 'Casa in pietra a Pittenweem', type: 'Casa indipendente', contract: 'sale', price: 360000, currency: 'GBP', size: 135, rooms: 3, baths: 2, floor: 'Su 2 livelli', year: 1820, energy: 'E', zone: 'East Neuk (Fife, Scozia)', town: 'Pittenweem', addr: 'High Street, Pittenweem, KY10', lat: 56.21240, lng: -2.72730, imgs: ['h2', 'i6', 'h8'], feats: ['Vista mare', 'Camino', 'Ristrutturato'], desc: 'Casa in pietra nel villaggio di artisti di Pittenweem, a due minuti dal porto di pescatori ancora in attività. Interni ristrutturati con gusto, vicino a gallerie e caffè.', date: '2026-08-02' },
  { id: 16, title: 'Cottage fronte mare a St Monans', type: 'Cottage', contract: 'rent', price: 1400, currency: 'GBP', size: 95, rooms: 3, baths: 1, floor: 'Su 2 livelli', year: 1900, energy: 'D', zone: 'East Neuk (Fife, Scozia)', town: 'St Monans', addr: 'West Shore, St Monans, KY10', lat: 56.20420, lng: -2.76560, imgs: ['h1', 'i4', 'i7'], feats: ['Vista mare', 'Arredato', 'Camino a legna'], desc: 'Cottage in affitto sul lungomare di St Monans, vicino alla chiesa medievale a picco sul mare e al vecchio mulino a vento. Arredato, con vista sul Firth of Forth.', date: '2026-08-04' },
  { id: 17, title: 'Villa con vista sulla baia di Elie', type: 'Villa', contract: 'sale', price: 850000, currency: 'GBP', size: 230, rooms: 5, baths: 3, floor: 'Su 2 livelli', year: 1925, energy: 'C', zone: 'East Neuk (Fife, Scozia)', town: 'Elie', addr: 'Wadeslea, Elie, KY9', lat: 56.19010, lng: -2.81640, imgs: ['v3', 'h5', 'i1', 'i5'], feats: ['Vista mare', 'Giardino', 'Garage', 'Vicino golf'], desc: 'Prestigiosa villa affacciata sulla baia sabbiosa di Elie, con ampio giardino, garage e vista sul mare. A pochi passi dalla spiaggia e dal golf links, in uno dei villaggi più esclusivi del Fife.', date: '2026-07-28' },
]
