import { useEffect, useRef, useState } from 'react'
import { useI18n, PRICE_RANGES } from '../i18n.jsx'

const emptyAdv = { smin: '', smax: '', rooms: '', baths: '', feats: [] }
const fmtK = (n) => (n >= 1000000 ? +(n / 1000000).toFixed(1) + 'M' : n / 1000 + 'k')

export default function Filters({ zones, features, filters, onImmediate, onApplyAdvanced, favOnly, onToggleFavOnly, seaOnly, onToggleSea, gardenOnly, onToggleGarden, soldView, soldCount, onToggleSold, onOpenAlerts, alertsUnseen, hasAlerts }) {
  const { t, typeLabel, featLabel } = useI18n()
  const [open, setOpen] = useState(false)
  const [priceOpen, setPriceOpen] = useState(false)
  const priceRef = useRef(null)
  const [draft, setDraft] = useState(emptyAdv)

  // Close the price panel on outside click.
  useEffect(() => {
    const onDoc = (e) => { if (priceRef.current && !priceRef.current.contains(e.target)) setPriceOpen(false) }
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
      feats: [...filters.feats],
    })
  }, [filters])

  const advCount =
    (filters.smin != null ? 1 : 0) + (filters.smax != null ? 1 : 0) +
    (filters.rooms ? 1 : 0) + (filters.baths ? 1 : 0) + filters.feats.length

  const setD = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const toggleFeat = (f) =>
    setDraft((d) => ({ ...d, feats: d.feats.includes(f) ? d.feats.filter((x) => x !== f) : [...d.feats, f] }))

  const num = (v) => (v === '' ? null : +v)
  const apply = () => {
    onApplyAdvanced({ smin: num(draft.smin), smax: num(draft.smax), rooms: draft.rooms, baths: draft.baths, feats: draft.feats })
    setOpen(false)
  }
  const reset = () => {
    setDraft(emptyAdv)
    onApplyAdvanced({ smin: null, smax: null, rooms: '', baths: '', feats: [] })
  }

  return (
    <>
      <div id="filterbar">
        <select className="chip" value={filters.zone} onChange={(e) => onImmediate('zone', e.target.value)}>
          <option value="">{t('all_zones')}</option>
          {zones.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
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
        <button className={'chip' + (favOnly ? ' active' : '')} onClick={onToggleFavOnly}>❤️ {t('favourites')}</button>
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
