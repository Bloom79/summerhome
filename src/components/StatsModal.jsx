import { useI18n } from '../i18n.jsx'

const fmtK = (n, sym) => sym + (n >= 1000000 ? +(n / 1000000).toFixed(2) + 'M' : Math.round(n / 1000) + 'k')

// Per-zone market snapshot: counts, median/min/max asking price, median
// €/m² (GBP converted, only homes with a known size), sea-view share,
// reductions and sold-archive entries. Rows apply the zone filter.
export default function StatsModal({ zones, listings, sold, gbpEur, onPickZone, onClose }) {
  const { t } = useI18n()
  const rows = zones.map((z) => {
    // Auction teaser prices would poison the medians.
    const ls = listings.filter((l) => l.zone === z && !l.feats.includes('Asta'))
    if (!ls.length) return null
    const prices = ls.map((l) => l.price).sort((a, b) => a - b)
    const sym = ls[0].currency === 'EUR' ? '€' : '£'
    // €/m² needs one currency to compare Scottish and Irish zones alike.
    const unit = ls
      .filter((l) => l.size > 15 && l.contract !== 'rent')
      .map((l) => (l.currency === 'GBP' ? l.price * (gbpEur || 1.15) : l.price) / l.size)
      .sort((a, b) => a - b)
    return {
      z, n: ls.length, sym,
      median: prices[Math.floor(prices.length / 2)],
      min: prices[0], max: prices[prices.length - 1],
      sqm: unit.length >= 3 ? Math.round(unit[Math.floor(unit.length / 2)]) : null,
      sqmN: unit.length,
      sea: ls.filter((l) => l.seaView).length,
      red: ls.filter((l) => Array.isArray(l.hist) && l.hist.length > 1 && l.hist[l.hist.length - 1].p < l.hist[l.hist.length - 2].p).length,
      gone: sold.filter((s) => s.zone === z).length,
    }
  }).filter(Boolean)

  return (
    <div id="agentmodal" onClick={onClose}>
      <div className="agentbox cmpbox" onClick={(e) => e.stopPropagation()}>
        <h3>📊 {t('stats_title')}</h3>
        <div className="cmp-scroll">
          <table className="cmp-table stats-table">
            <thead>
              <tr>
                <th>{t('cmp_zone')}</th>
                <th>{t('stats_n')}</th>
                <th>{t('stats_median')}</th>
                <th>{t('stats_range')}</th>
                <th>€/m²</th>
                <th>🌊</th>
                <th>📉</th>
                <th>🔴</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.z} className="stats-row" onClick={() => { onClose(); onPickZone(r.z) }}>
                  <td className="cmp-label">{r.z.replace(/ \((Scozia|Irlanda|UK|Donegal, IE|Fife, Scozia)\)$/, '')}</td>
                  <td>{r.n}</td>
                  <td><b>{fmtK(r.median, r.sym)}</b></td>
                  <td>{fmtK(r.min, r.sym)} – {fmtK(r.max, r.sym)}</td>
                  <td title={r.sqm ? t('stats_sqm_n', { n: r.sqmN }) : undefined}>{r.sqm ? r.sqm.toLocaleString('it-IT') : '—'}</td>
                  <td>{r.sea || '—'}</td>
                  <td>{r.red || '—'}</td>
                  <td>{r.gone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="agentexpl">{t('stats_hint')}</p>
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
