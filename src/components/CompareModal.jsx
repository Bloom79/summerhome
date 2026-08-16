import { fmtP, imgUrl, handleImgError, hostOf } from '../utils.js'
import { useI18n } from '../i18n.jsx'

// Side-by-side comparison of the favourite listings.
export default function CompareModal({ items, gbpEur, notes, onOpen, onToggleFav, onClose }) {
  const { t, typeLabel } = useI18n()
  const eur = (l) => (l.currency === 'GBP' && gbpEur ? '≈ €' + Math.round(l.price * gbpEur).toLocaleString('it-IT') : null)
  const lastDrop = (l) => {
    if (!Array.isArray(l.hist) || l.hist.length < 2) return null
    const a = l.hist[l.hist.length - 2].p, b = l.hist[l.hist.length - 1].p
    return b < a ? `📉 ${fmtP({ ...l, price: a })} → ${fmtP(l)}` : null
  }

  const rows = [
    [t('cmp_price'), (l) => <><b>{fmtP(l)}</b>{eur(l) ? <div className="cmp-sub">{eur(l)}</div> : null}{lastDrop(l) ? <div className="cmp-sub">{lastDrop(l)}</div> : null}</>],
    [t('cmp_zone'), (l) => l.zone],
    [t('st_rooms'), (l) => l.rooms ?? '—'],
    [t('st_baths'), (l) => l.baths ?? '—'],
    [t('cmp_type'), (l) => typeLabel(l.type)],
    [t('sea_view').replace('🌊 ', ''), (l) => (l.seaView ? '🌊 ✓' : '—')],
    [t('garden').replace('🌳 ', ''), (l) => (l.feats.includes('Giardino') ? '🌳 ✓' : '—')],
    [t('st_added'), (l) => `${l.date.slice(8, 10)}/${l.date.slice(5, 7)}`],
    [t('cmp_note'), (l) => (notes[l.url] ? `📝 ${notes[l.url].slice(0, 60)}${notes[l.url].length > 60 ? '…' : ''}` : '—')],
  ]

  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox cmpbox" onClick={(e) => e.stopPropagation()}>
        <h3>⚖️ {t('cmp_title', { n: items.length })}</h3>
        <div className="cmp-scroll">
          <table className="cmp-table">
            <thead>
              <tr>
                <th />
                {items.map((l) => (
                  <th key={l.id}>
                    {l.imgs?.length
                      ? <img src={imgUrl(l.imgs[0])} onError={(e) => handleImgError(e)} alt="" onClick={() => { onClose(); onOpen(l.id) }} />
                      : <div className="cmp-ph">🏠</div>}
                    <div className="cmp-addr" onClick={() => { onClose(); onOpen(l.id) }}>{(l.addr || '').split(',')[0]}</div>
                    <button className="cmp-x" title={t('cmp_remove')} onClick={() => onToggleFav(l.id)}>🗑</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, fn]) => (
                <tr key={label}>
                  <td className="cmp-label">{label}</td>
                  {items.map((l) => <td key={l.id}>{fn(l)}</td>)}
                </tr>
              ))}
              <tr>
                <td className="cmp-label" />
                {items.map((l) => (
                  <td key={l.id}>
                    {l.url && <a className="cmp-link" href={l.url} target="_blank" rel="noopener noreferrer">{hostOf(l.url)} ↗</a>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <button className="agentsend noprint" onClick={() => window.print()}>🖨 {t('cmp_print')}</button>
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
