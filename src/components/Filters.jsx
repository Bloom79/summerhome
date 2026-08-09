import { useEffect, useState } from 'react'
import { FEATURES, ZONES } from '../data.js'
import { useI18n } from '../i18n.jsx'

const emptyAdv = { smin: '', smax: '', rooms: '', baths: '', feats: [] }

export default function Filters({ filters, onImmediate, onPrice, onApplyAdvanced, favOnly, onToggleFavOnly }) {
  const { t, typeLabel, featLabel } = useI18n()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(emptyAdv)

  // Keep the draft in sync if committed filters change elsewhere (e.g. reset).
  useEffect(() => {
    setDraft({
      smin: filters.smin ?? '', smax: filters.smax ?? '',
      rooms: filters.rooms || '', baths: filters.baths || '',
      feats: [...filters.feats],
    })
  }, [filters])

  // Preset price ranges (numeric — applies to £ and € alike).
  const RANGES = [
    { v: '', min: null, max: null, label: t('price_any') },
    { v: 'a', min: null, max: 250000, label: t('price_upto', { v: '250k' }) },
    { v: 'b', min: 250000, max: 500000, label: '250k – 500k' },
    { v: 'c', min: 500000, max: 750000, label: '500k – 750k' },
    { v: 'd', min: 750000, max: 1000000, label: '750k – 1M' },
    { v: 'e', min: 1000000, max: null, label: t('price_over', { v: '1M' }) },
  ]
  const priceValue = (RANGES.find((r) => (r.min ?? null) === (filters.pmin ?? null) && (r.max ?? null) === (filters.pmax ?? null)) || {}).v || ''
  const onPriceChange = (v) => {
    const r = RANGES.find((x) => x.v === v) || RANGES[0]
    onPrice(r.min, r.max)
  }

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
          {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <select className={'chip' + (priceValue ? ' active' : '')} value={priceValue} onChange={(e) => onPriceChange(e.target.value)}>
          {RANGES.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
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
        <button className={'chip' + (favOnly ? ' active' : '')} onClick={onToggleFavOnly}>❤️ {t('favourites')}</button>
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
              {FEATURES.map((f) => (
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
