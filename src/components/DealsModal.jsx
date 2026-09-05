import { useState } from 'react'
import { useI18n } from '../i18n.jsx'
import { fmtP, srcOf } from '../utils.js'
import Gallery from './Gallery.jsx'
import { savingOf } from '../analyze.js'

// Renders one analysis' check breakdown — shared between the Occasioni modal
// and the detail view. Checks come from scripts/analyze-deals.mjs or from
// the client-side replica in src/analyze.js (which adds neutral facts).
export function DealChecks({ deal }) {
  const { t } = useI18n()
  const line = (c) => {
    switch (c.k) {
      case 'sqm': return t('dc_sqm', { unit: c.v.unit.toLocaleString('it-IT'), zone: c.v.zone.toLocaleString('it-IT'), pct: c.v.pct })
      case 'sqm_info': return t(c.v.over ? 'dc_sqm_over' : 'dc_sqm_near', { unit: c.v.unit.toLocaleString('it-IT'), zone: c.v.zone.toLocaleString('it-IT'), pct: c.v.pct })
      case 'comps': return t('dc_comps', { pct: c.v.pct, rooms: c.v.rooms, n: c.v.n })
      case 'comps_info': return t(c.v.over ? 'dc_comps_over' : 'dc_comps_near', { pct: c.v.pct, rooms: c.v.rooms, n: c.v.n })
      case 'nosize': return t('dc_nosize')
      case 'cuts': return t('dc_cuts', { pct: c.v.pct }) + (c.v.n >= 2 ? t('dc_cuts_multi', { n: c.v.n }) : '')
      case 'days': return t('dc_days', { d: c.v.d })
      case 'motive': return c.v.flags.map((f) => t('dc_m_' + f)).join(' · ')
      case 'upside': return t('dc_upside') + (c.v.land ? t('dc_upside_land') : '')
      case 'premium': return t('dc_premium') + (c.v.beach ? t('dc_premium_beach') : '')
      default: return c.k
    }
  }
  return (
    <ul className="dchecks">
      {deal.checks.map((c) => (
        <li key={c.k} className={c.pts ? '' : 'neutral'}><span className="dpts">{c.pts ? '+' + c.pts : '·'}</span>{line(c)}</li>
      ))}
    </ul>
  )
}

// The dedicated bargain-analysis view: every current deal with its full
// scoring breakdown, sortable, new-today ones first.
export default function DealsModal({ deals, listings, gbpEur, updated, favs, onToggleFav, onOpen, onClose }) {
  const { t, eur: eurMode } = useI18n()
  const fx = eurMode ? gbpEur : null
  const [order, setOrder] = useState('score')
  const byId = new Map(listings.map((l) => [l.id, l]))
  const rows = deals.map((d) => ({ d, l: byId.get(d.id), save: 0 })).filter((r) => r.l)
  for (const r of rows) r.save = savingOf(r.d, r.l, gbpEur)
  const cmp = order === 'price' ? (a, b) => a.l.price - b.l.price
    : order === 'save' ? (a, b) => b.save - a.save
    : (a, b) => b.d.score - a.d.score
  rows.sort(cmp)
  const fresh = rows.filter((r) => r.d.isNew)
  const rest = rows.filter((r) => !r.d.isNew)
  const daysOn = (l) => updated ? Math.max(0, Math.round((new Date(updated) - new Date(l.date)) / 864e5)) : 0
  const Row = ({ d, l, save }) => (
    <div className="dealrow" onClick={() => { onClose(); onOpen(l.id) }}>
      <div className="dimg">{l.imgs?.length ? <Gallery imgs={l.imgs} /> : '🏠'}</div>
      <div className="dbody">
        <div className="dhead">
          <span className={'dscore' + (d.tier === 'top' ? ' top' : '')}>{d.tier === 'top' ? '🔥' : '💎'} {d.score}</span>
          <b>{fmtP(l, fx)}</b>
          {d.isNew && <span className="newb">✨ {t('new_badge')}</span>}
          <button className="dfav" onClick={(e) => { e.stopPropagation(); onToggleFav(l.id) }}>{favs.has(l.id) ? '❤️' : '🤍'}</button>
        </div>
        <div className="daddr">{l.addr} · {l.zone.replace(/ \(.*/, '')}</div>
        <div className="dmeta">
          {srcOf(l.url) && <span className={'srcb srcb-' + srcOf(l.url).key}>{srcOf(l.url).label}</span>}
          {l.size ? <span>{l.size} m²</span> : null}
          {l.rooms ? <span>🛏 {l.rooms}</span> : null}
          <span>📅 {t('deal_days', { d: daysOn(l) })}</span>
          {save > 0 && <span className="dsave">💰 {t('deal_saving', { v: '€' + save.toLocaleString('it-IT') })}</span>}
        </div>
        <DealChecks deal={d} />
      </div>
    </div>
  )
  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox cmpbox" onClick={(e) => e.stopPropagation()}>
        <h3>💎 {t('deals_title')}</h3>
        <div className="dstats">
          <span>{t('deals_stats', { n: rows.length, top: rows.filter((r) => r.d.tier === 'top').length, fresh: fresh.length })}</span>
          <select value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="score">{t('dsort_score')}</option>
            <option value="save">{t('dsort_save')}</option>
            <option value="price">{t('dsort_price')}</option>
          </select>
        </div>
        <p className="agentexpl">{t('deals_explain')}</p>
        <div className="cmp-scroll dealscroll">
          {rows.length === 0 && <p className="agentexpl">{t('deals_none')}</p>}
          {fresh.length > 0 && <div className="dsec">✨ {t('deals_new_today')} ({fresh.length})</div>}
          {fresh.map((r) => <Row key={r.d.id} {...r} />)}
          {rest.length > 0 && fresh.length > 0 && <div className="dsec">{t('deals_all')}</div>}
          {rest.map((r) => <Row key={r.d.id} {...r} />)}
        </div>
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
