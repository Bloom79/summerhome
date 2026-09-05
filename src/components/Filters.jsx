import { useEffect, useRef, useState } from 'react'
import { useI18n, PRICE_RANGES } from '../i18n.jsx'

const emptyAdv = { smin: '', smax: '', rooms: '', baths: '', feats: [], epc: '' }
const fmtK = (n) => (n >= 1000000 ? +(n / 1000000).toFixed(1) + 'M' : n / 1000 + 'k')

export default function Filters({ zones, areas = [], searches = [], onSaveSearch, onApplySearch, onDeleteSearch, onOpenTrip, zoneCounts, features, filters, onImmediate, onApplyAdvanced, favOnly, onToggleFavOnly, seaOnly, onToggleSea, gardenOnly, onToggleGarden, beachOnly, onToggleBeach, auctionOnly, onToggleAuction, farmOnly, onToggleFarm, dealsOnly, onToggleDeals, dealsCount, reducedOnly, onToggleReduced, bothOnly, onToggleBoth, soldView, soldCount, onToggleSold, favCount, onOpenCompare, onOpenAlerts, alertsUnseen, hasAlerts }) {
  const { t, typeLabel, featLabel } = useI18n()
  const [open, setOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const priceRef = useRef(null)
  const [srchOpen, setSrchOpen] = useState(false)
  const [srchName, setSrchName] = useState('')
  const srchRef = useRef(null)
  const [draft, setDraft] = useState(emptyAdv)

  // Close the price panel on outside click.
  useEffect(() => {
    const onDoc = (e) => {
      if (priceRef.current && !priceRef.current.contains(e.target)) setPriceOpen(false)
      if (srchRef.current && !srchRef.current.contains(e.target)) setSrchOpen(false)
    }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [])

  const bands = filters.priceRanges || []
  const bandLabel = (r) =>
    r.min == null ? t('price_upto', { v: fmtK(r.max) })
    : r.max == null ? t('price_over', { v: fmtK(r.min) })
    : `${fmtK(r.min)} – ${fmtK(r.max)}`
  const toggleBand = (id) => {
    const next = bands.includes(id) ? bands.filter((x) => x !== id) : [...bands, id]
    onImmediate('priceRanges', next)
  }

  // Keep the draft in sync if committed filters change elsewhere (e.g. reset).
  useEffect(() => {
    setDraft({
      smin: filters.smin ?? '', smax: filters.smax ?? '',
      rooms: filters.rooms || '', baths: filters.baths || '',
      feats: [...filters.feats], epc: filters.epc || '',
    })
  }, [filters])

  const advCount =
    (filters.smin != null ? 1 : 0) + (filters.smax != null ? 1 : 0) +
    (filters.rooms ? 1 : 0) + (filters.baths ? 1 : 0) + filters.feats.length + (filters.epc ? 1 : 0)

  const setD = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const toggleFeat = (f) =>
    setDraft((d) => ({ ...d, feats: d.feats.includes(f) ? d.feats.filter((x) => x !== f) : [...d.feats, f] }))

  const num = (v) => (v === '' ? null : +v)
  const apply = () => {
    onApplyAdvanced({ smin: num(draft.smin), smax: num(draft.smax), rooms: draft.rooms, baths: draft.baths, feats: draft.feats, epc: draft.epc })
    setOpen(false)
  }
  const reset = () => {
    setDraft(emptyAdv)
    onApplyAdvanced({ smin: null, smax: null, rooms: '', baths: '', feats: [], epc: '' })
  }

  return (
    <>
      <div id="filterbar">
        <select className="chip" value={filters.zone} onChange={(e) => { onImmediate('zone', e.target.value); onImmediate('area', '') }}>
          <option value="">{t('all_zones')}</option>
          {zones.map((z) => <option key={z} value={z}>{z}{zoneCounts?.[z] ? ` (${zoneCounts[z]})` : ''}</option>)}
        </select>
        {areas.length >= 2 && (
          <select className={'chip' + (filters.area ? ' active' : '')} value={filters.area || ''} onChange={(e) => onImmediate('area', e.target.value)}>
            <option value="">📍 {t('area_all')}</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <div className="msel" ref={srchRef}>
          <button className={'chip' + (searches.length ? ' active' : '')} onClick={() => setSrchOpen((o) => !o)}>📌 {t('searches_chip')}{searches.length ? ` (${searches.length})` : ''} ▾</button>
          {srchOpen && (
            <div className="mselpanel srchpanel">
              <b>{t('searches_title')}</b>
              {searches.length === 0 && <p className="srchempty">{t('searches_empty')}</p>}
              {searches.map((s) => (
                <div key={s.id} className="srchrow">
                  <button className="srchapply" onClick={() => { onApplySearch(s.id); setSrchOpen(false) }}>{s.name}</button>
                  <button className="srchdel" title="✕" onClick={() => onDeleteSearch(s.id)}>✕</button>
                </div>
              ))}
              <div className="srchsave">
                <input value={srchName} placeholder={t('searches_name_ph')} onChange={(e) => setSrchName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && srchName.trim()) { onSaveSearch(srchName); setSrchName('') } }} />
                <button className="btn primary" disabled={!srchName.trim()} onClick={() => { onSaveSearch(srchName); setSrchName('') }}>{t('searches_save')}</button>
              </div>
            </div>
          )}
        </div>
        <div className="msel" ref={priceRef}>
          <button className={'chip' + (bands.length ? ' active' : '')} onClick={() => setPriceOpen((o) => !o)}>
            💶 {bands.length ? `${t('price_label')} (${bands.length})` : t('price_any')} ▾
          </button>
          {priceOpen && (
            <div className="mselpanel">
              {PRICE_RANGES.map((r) => (
                <label key={r.id}>
                  <input type="checkbox" checked={bands.includes(r.id)} onChange={() => toggleBand(r.id)} />
                  {bandLabel(r)}
                </label>
              ))}
              {bands.length > 0 && (
                <button className="mselclear" onClick={() => onImmediate('priceRanges', [])}>{t('price_clear')}</button>
              )}
            </div>
          )}
        </div>
        <select className={'chip' + (filters.travel ? ' active' : '')} value={filters.travel || ''} title={t('travel_note')} onChange={(e) => onImmediate('travel', e.target.value)}>
          <option value="">{t('travel_any')}</option>
          <option value="90">{t('travel_90')}</option>
          <option value="150">{t('travel_150')}</option>
          <option value="240">{t('travel_240')}</option>
        </select>
        <select className={'chip' + (filters.freshness ? ' active' : '')} value={filters.freshness} onChange={(e) => onImmediate('freshness', e.target.value)}>
          <option value="">{t('fresh_all')}</option>
          <option value="1">{t('fresh_1')}</option>
          <option value="3">{t('fresh_3')}</option>
          <option value="7">{t('fresh_7')}</option>
          <option value="visit">{t('fresh_visit')}</option>
        </select>
        <select className="chip" value={filters.contract} onChange={(e) => onImmediate('contract', e.target.value)}>
          <option value="">{t('sale_rent')}</option>
          <option value="sale">{t('for_sale')}</option>
          <option value="rent">{t('for_rent')}</option>
        </select>
        <select className="chip" value={filters.type} onChange={(e) => onImmediate('type', e.target.value)}>
          <option value="">{t('all_types')}</option>
          {['Cottage', 'Casa indipendente', 'Villa', 'Appartamento', 'Bungalow'].map((ty) => (
            <option key={ty} value={ty}>{typeLabel(ty)}</option>
          ))}
        </select>
        <button className="chip" onClick={() => setOpen((o) => !o)}>
          ⚙️ {t('adv_filters')}{advCount ? <span className="badge">{advCount}</span> : null}
        </button>
        <button className={'chip' + (seaOnly ? ' active' : '')} onClick={onToggleSea}>{t('sea_view')}</button>
        <button className={'chip' + (gardenOnly ? ' active' : '')} onClick={onToggleGarden}>{t('garden')}</button>
        <button className={'chip' + (beachOnly ? ' active' : '')} onClick={onToggleBeach}>{t('beach')}</button>
        <button className={'chip' + (auctionOnly ? ' active' : '')} onClick={onToggleAuction}>🔨 {t('auction_chip')}</button>
        <button className={'chip' + (farmOnly ? ' active' : '')} onClick={onToggleFarm}>🌱 {t('farm_chip')}</button>
        {dealsCount > 0 && (
          <button className={'chip' + (dealsOnly ? ' active' : '')} onClick={onToggleDeals}>{t('deals_chip')} ({dealsCount})</button>
        )}
        <button className={'chip' + (reducedOnly ? ' active' : '')} onClick={onToggleReduced}>{t('reduced')}</button>
        <button className={'chip' + (bothOnly ? ' active' : '')} onClick={onToggleBoth}>{t('both_chip')}</button>
        <button className={'chip' + (favOnly ? ' active' : '')} onClick={onToggleFavOnly}>❤️ {t('favourites')}{favCount > 0 ? ` (${favCount})` : ''}</button>
        {favCount >= 2 && (
          <button className="chip" onClick={onOpenCompare}>⚖️ {t('cmp_chip')} ({favCount})</button>
        )}
        {favCount >= 1 && onOpenTrip && (
          <button className="chip" onClick={onOpenTrip}>🗺 {t('trip_chip')}</button>
        )}
        <button className={'chip' + (hasAlerts ? ' active' : '')} onClick={onOpenAlerts}>
          🔔 {t('al_chip')}{alertsUnseen > 0 ? <span className="badge">{alertsUnseen}</span> : null}
        </button>
        {soldCount > 0 && (
          <button className={'chip' + (soldView ? ' active' : '')} onClick={onToggleSold}>🔴 {t('sold_chip')} ({soldCount})</button>
        )}
      </div>

      {open && (
        <div id="advfilters">
          <div className="fgroup">
            <label>{t('f_area')}</label>
            <div className="pair">
              <input type="number" min="0" placeholder={t('min')} value={draft.smin} onChange={(e) => setD('smin', e.target.value)} />
              <input type="number" min="0" placeholder={t('max')} value={draft.smax} onChange={(e) => setD('smax', e.target.value)} />
            </div>
          </div>
          <div className="fgroup">
            <label>{t('f_rooms')}</label>
            <select value={draft.rooms} onChange={(e) => setD('rooms', e.target.value)}>
              <option value="">{t('any')}</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option>
            </select>
          </div>
          <div className="fgroup">
            <label>{t('f_epc')}</label>
            <select value={draft.epc} onChange={(e) => setD('epc', e.target.value)}>
              <option value="">{t('any')}</option>{['A', 'B', 'C', 'D', 'E'].map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <div className="fgroup">
            <label>{t('f_baths')}</label>
            <select value={draft.baths} onChange={(e) => setD('baths', e.target.value)}>
              <option value="">{t('any')}</option><option>1</option><option>2</option><option>3</option>
            </select>
          </div>
          <div className="fgroup" style={{ gridColumn: '1/-1' }}>
            <label>{t('f_features')}</label>
            <div className="feat">
              {features.map((f) => (
                <span key={f} className={draft.feats.includes(f) ? 'on' : ''} onClick={() => toggleFeat(f)}>{featLabel(f)}</span>
              ))}
            </div>
          </div>
          <div className="factions">
            <button className="btn ghost" onClick={reset}>{t('reset')}</button>
            <button className="btn primary" onClick={apply}>{t('apply')}</button>
          </div>
        </div>
      )}
    </>
  )
}
