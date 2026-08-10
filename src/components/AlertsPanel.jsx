import { useState } from 'react'
import { useI18n, PRICE_RANGES } from '../i18n.jsx'

const fmtK = (n) => (n >= 1000000 ? +(n / 1000000).toFixed(1) + 'M' : n / 1000 + 'k')
const emptyDraft = { zone: '', priceMax: '', rooms: '', seaView: false, garden: false, ev: { nuove: true, ribassi: true, vendute: false } }

// Create/manage saved alerts (zone + filters + event types) and show the
// recent matches ("novità") computed against them.
export default function AlertsPanel({ zones, alerts, news, pushState, onSave, onDelete, onMarkRead, onClose }) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(emptyDraft)
  const setD = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const setEv = (k) => setDraft((d) => ({ ...d, ev: { ...d.ev, [k]: !d.ev[k] } }))

  const describe = (a) => {
    const p = [a.zone || t('al_all_zones')]
    if (a.priceMax != null) p.push(t('al_upto', { v: fmtK(a.priceMax) }))
    if (a.rooms) p.push(`≥${a.rooms} ${t('al_rooms')}`)
    if (a.seaView) p.push(t('sea_view'))
    if (a.garden) p.push(t('garden'))
    const evs = [a.ev?.nuove && t('al_ev_new'), a.ev?.ribassi && t('al_ev_drop'), a.ev?.vendute && t('al_ev_sold')].filter(Boolean)
    return `${p.join(' · ')} — ${evs.join(', ')}`
  }

  const fmtNews = (n) => {
    const price = `${n.currency === 'EUR' ? '€' : '£'}${n.price.toLocaleString('it-IT')}`
    if (n.type === 'nuova') return `🏠 ${n.addr} — ${price}`
    if (n.type === 'ribasso') return `📉 ${n.addr} — ${price} (${t('al_was')} ${n.currency === 'EUR' ? '€' : '£'}${n.oldPrice.toLocaleString('it-IT')})`
    return `🔴 ${n.addr} — ${t('al_gone')}`
  }

  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox alertsbox" onClick={(e) => e.stopPropagation()}>
        <h3>🔔 {t('al_title')}</h3>

        {news.length > 0 && (
          <div className="alnews">
            <div className="alhead">{t('al_news')} <button className="agentcancel" onClick={onMarkRead}>{t('al_read')}</button></div>
            {news.slice(0, 12).map((n, i) => (
              <a key={i} className={'alnew' + (n.seen ? ' seen' : '')} href={n.url} target="_blank" rel="noopener noreferrer">{fmtNews(n)}</a>
            ))}
          </div>
        )}

        {alerts.length > 0 && (
          <div className="allist">
            {alerts.map((a) => (
              <div key={a.id} className="alrow">
                <span>{describe(a)}</span>
                <button onClick={() => onDelete(a.id)} title={t('al_del')}>🗑</button>
              </div>
            ))}
          </div>
        )}

        <div className="alform">
          <div className="alhead">{t('al_new_alert')}</div>
          <div className="alfields">
            <select value={draft.zone} onChange={(e) => setD('zone', e.target.value)}>
              <option value="">{t('al_all_zones')}</option>
              {zones.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
            <select value={draft.priceMax} onChange={(e) => setD('priceMax', e.target.value)}>
              <option value="">{t('al_any_price')}</option>
              {PRICE_RANGES.filter((r) => r.max).map((r) => <option key={r.id} value={r.max}>{t('al_upto', { v: fmtK(r.max) })}</option>)}
            </select>
            <select value={draft.rooms} onChange={(e) => setD('rooms', e.target.value)}>
              <option value="">{t('al_any_rooms')}</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>≥{n} {t('al_rooms')}</option>)}
            </select>
          </div>
          <div className="alchecks">
            <label><input type="checkbox" checked={draft.seaView} onChange={() => setD('seaView', !draft.seaView)} />{t('sea_view')}</label>
            <label><input type="checkbox" checked={draft.garden} onChange={() => setD('garden', !draft.garden)} />{t('garden')}</label>
          </div>
          <div className="alchecks alev">
            <label><input type="checkbox" checked={draft.ev.nuove} onChange={() => setEv('nuove')} />{t('al_ev_new')}</label>
            <label><input type="checkbox" checked={draft.ev.ribassi} onChange={() => setEv('ribassi')} />{t('al_ev_drop')}</label>
            <label><input type="checkbox" checked={draft.ev.vendute} onChange={() => setEv('vendute')} />{t('al_ev_sold')}</label>
          </div>
          <button
            className="agentsend"
            disabled={!draft.ev.nuove && !draft.ev.ribassi && !draft.ev.vendute}
            onClick={() => { onSave(draft); setDraft(emptyDraft) }}
          >{t('al_save')}</button>
        </div>

        <p className="agentexpl">
          {pushState === 'on' ? t('al_push_on') : pushState === 'denied' ? t('al_push_denied') : t('al_push_off')}
        </p>
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
