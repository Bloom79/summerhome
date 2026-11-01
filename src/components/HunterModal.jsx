import { useI18n } from '../i18n.jsx'
import { fmtP, srcOf } from '../utils.js'
import Gallery from './Gallery.jsx'

const eur = (n) => '€' + Number(n).toLocaleString('it-IT')
export const fairText = (fair) => (Array.isArray(fair) && fair.length === 2 ? eur(fair[0]) + '–' + Number(fair[1]).toLocaleString('it-IT') : '')

// Pro / contro / flags / domande lists, shared with the detail view.
export function HunterNotes({ pick }) {
  const { t } = useI18n()
  const ai = pick.ai
  const cons = [...(ai?.contro || []), ...(pick.flags || [])]
  return (
    <>
      {ai?.why && <p className="hwhy">{ai.why}</p>}
      {fairText(ai?.fair) && <div className="hfair">{t('hunter_fair')}: <b>{fairText(ai.fair)}</b></div>}
      {ai?.pro?.length > 0 && <ul className="hlist hpro">{ai.pro.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {cons.length > 0 && <ul className="hlist hcon">{cons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {ai?.domande?.length > 0 && (
        <div className="hask">
          <b>{t('hunter_ask')}</b>
          <ul>{ai.domande.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
    </>
  )
}

export const verdictKey = (p) => (p.ai ? (p.ai.verdict === 'vera occasione' ? 'good' : p.ai.verdict === 'no' ? 'no' : 'mid') : 'mid')

export default function HunterModal({ hunter, listings, gbpEur, favs, onToggleFav, onOpen, onClose }) {
  const { t, eur: eurMode } = useI18n()
  const fx = eurMode ? gbpEur : null
  const byId = new Map(listings.map((l) => [l.id, l]))
  const rows = (hunter?.picks || []).map((p) => ({ p, l: byId.get(p.id) })).filter((r) => r.l)
  const by = (k) => rows.filter((r) => verdictKey(r.p) === k).sort((a, b) => (b.p.score || 0) - (a.p.score || 0))
  const good = by('good'), mid = by('mid'), no = by('no')
  const st = hunter?.stats

  const Card = ({ p, l }) => {
    const k = verdictKey(p)
    const src = srcOf(l.url)
    return (
      <div className={'hcard hv-' + k} onClick={() => { onClose(); onOpen(l.id) }}>
        <div className="hcard-top">
          <div className="dimg">{l.imgs?.length ? <Gallery imgs={l.imgs} /> : '🏠'}</div>
          <div className="dbody">
            <div className="dhead">
              <b>{fmtP(l, fx)}</b>
              <span className={'hbadge hb-' + k}>{p.ai ? p.ai.verdict : t('hunter_pending')}</span>
              <button className="dfav" onClick={(e) => { e.stopPropagation(); onToggleFav(l.id) }}>{favs.has(l.id) ? '❤️' : '🤍'}</button>
            </div>
            <div className="daddr">{l.title ? l.title + ' · ' : ''}{l.town || l.zone}</div>
            <div className="dmeta">
              {p.unit ? <span>{p.unit.toLocaleString('it-IT')} €/m²{p.omi ? ' · OMI ' + p.omi.map((n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')).join('–') : ''}</span> : null}
              {l.size ? <span>{l.size} m²</span> : null}
              {src && <a className={'srcb srcb-' + src.key} href={p.url || l.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{src.label} ↗</a>}
            </div>
          </div>
        </div>
        <HunterNotes pick={p} />
        {p.checks?.length > 0 && <div className="hchips">{p.checks.map((c) => <span key={c.k} className="hchip">{c.t}</span>)}</div>}
      </div>
    )
  }

  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox cmpbox" onClick={(e) => e.stopPropagation()}>
        <h3>🎯 {t('hunter_title')}</h3>
        <div className="dstats">
          <span>{hunter?.updated ? t('hunter_updated', { d: hunter.updated }) : ''}{st ? ' · ' + t('hunter_stats', { a: st.eligible, b: st.shortlisted }) : ''}</span>
        </div>
        <p className="agentexpl">{t('hunter_explain')}</p>
        <div className="cmp-scroll dealscroll hunterscroll">
          {rows.length === 0 && <p className="agentexpl">{t('hunter_none')}</p>}
          {good.length > 0 && <div className="dsec">✅ {t('hunter_good')} ({good.length})</div>}
          {good.map((r) => <Card key={r.p.id} {...r} />)}
          {mid.length > 0 && <div className="dsec">👀 {t('hunter_mid')} ({mid.length})</div>}
          {mid.map((r) => <Card key={r.p.id} {...r} />)}
          {no.length > 0 && (
            <details className="hno">
              <summary className="dsec">❌ {t('hunter_no', { n: no.length })}</summary>
              {no.map((r) => <Card key={r.p.id} {...r} />)}
            </details>
          )}
        </div>
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
