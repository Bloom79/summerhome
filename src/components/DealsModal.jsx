import { useI18n } from '../i18n.jsx'
import { fmtP, imgUrl, handleImgError } from '../utils.js'

// Renders one deal's check breakdown — shared between the Occasioni modal
// and the detail view. `deal.checks` comes from scripts/analyze-deals.mjs.
export function DealChecks({ deal }) {
  const { t } = useI18n()
  const line = (c) => {
    switch (c.k) {
      case 'sqm': return t('dc_sqm', { unit: c.v.unit.toLocaleString('it-IT'), zone: c.v.zone.toLocaleString('it-IT'), pct: c.v.pct })
      case 'comps': return t('dc_comps', { pct: c.v.pct, rooms: c.v.rooms, n: c.v.n })
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
        <li key={c.k}><span className="dpts">+{c.pts}</span>{line(c)}</li>
      ))}
    </ul>
  )
}

// The dedicated bargain-analysis view: every current deal with its full
// scoring breakdown, new-today ones first.
export default function DealsModal({ deals, listings, onOpen, onClose }) {
  const { t } = useI18n()
  const byId = new Map(listings.map((l) => [l.id, l]))
  const rows = deals.map((d) => ({ d, l: byId.get(d.id) })).filter((r) => r.l)
  const fresh = rows.filter((r) => r.d.isNew)
  const rest = rows.filter((r) => !r.d.isNew)
  const Row = ({ d, l }) => (
    <div className="dealrow" onClick={() => { onClose(); onOpen(l.id) }}>
      <div className="dimg">{l.imgs[0] ? <img loading="lazy" src={imgUrl(l.imgs[0])} onError={(e) => handleImgError(e)} alt="" /> : '🏠'}</div>
      <div className="dbody">
        <div className="dhead">
          <span className={'dscore' + (d.tier === 'top' ? ' top' : '')}>{d.tier === 'top' ? '🔥' : '💎'} {d.score}</span>
          <b>{fmtP(l)}</b>
          {d.isNew && <span className="newb">✨ {t('new_badge')}</span>}
        </div>
        <div className="daddr">{l.addr} · {l.zone.replace(/ \(.*/, '')}</div>
        <DealChecks deal={d} />
      </div>
    </div>
  )
  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox cmpbox" onClick={(e) => e.stopPropagation()}>
        <h3>💎 {t('deals_title')}</h3>
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
