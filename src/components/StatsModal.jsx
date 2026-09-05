import { useI18n } from '../i18n.jsx'

const fmtK = (n, sym) => sym + (n >= 1000000 ? +(n / 1000000).toFixed(2) + 'M' : Math.round(n / 1000) + 'k')

// Per-zone market snapshot: counts, median/min/max asking price, median
// €/m² (GBP converted, only homes with a known size), sea-view share,
// reductions and sold-archive entries. Rows apply the zone filter.
// Tiny inline sparkline of a zone's median over the last 30 snapshots.
function Spark({ pts }) {
  if (!pts || pts.length < 2) return null
  const w = 64, h = 18, min = Math.min(...pts), max = Math.max(...pts)
  const y = (v) => (max === min ? h / 2 : h - 2 - ((v - min) / (max - min)) * (h - 4))
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${y(v).toFixed(1)}`).join(' ')
  return <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}><polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
}

export default function StatsModal({ zones, listings, sold, trends, gbpEur, onPickZone, onClose }) {
  const { t } = useI18n()
  const days = trends?.days || []
  const last = days[days.length - 1]
  // The snapshot closest to 28 days before the last one (≥ 21 days back).
  const base = [...days].reverse().find((x) => last && (new Date(last.d) - new Date(x.d)) / 864e5 >= 21) || null
  const week = days.filter((x) => last && (new Date(last.d) - new Date(x.d)) / 864e5 < 7)
  const weekNew = week.reduce((s, x) => s + (x.new || 0), 0)
  const weekSold = week.length && days.indexOf(week[0]) > 0 ? (last.sold - days[days.indexOf(week[0]) - 1].sold) : null
  const trendOf = (z) => {
    // Thin zones swing with every listing that comes or goes: no trend below 10 homes.
    const a = base?.zones?.[z]?.med, b = last?.zones?.[z]?.med
    if (!a || !b || (base.zones[z].n < 10) || (last.zones[z].n < 10)) return null
    return Math.round((b - a) / a * 100)
  }
  const sparkOf = (z) => days.slice(-30).map((x) => x.zones?.[z]?.med).filter((v) => v)
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
                {days.length > 1 && <th title={t('stats_trend_title')}>{t('stats_trend')}</th>}
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
                  {days.length > 1 && (() => { const tr = trendOf(r.z); return (
                    <td className="trendcell">
                      {tr == null ? '—' : <span className={'trend ' + (tr > 2 ? 'up' : tr < -2 ? 'down' : 'flat')}>{tr > 2 ? '▲' : tr < -2 ? '▼' : '▬'} {tr > 0 ? '+' : ''}{tr}%</span>}
                      <Spark pts={sparkOf(r.z)} />
                    </td>) })()}
                  <td>{r.sea || '—'}</td>
                  <td>{r.red || '—'}</td>
                  <td>{r.gone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {last && week.length > 0 && <p className="agentexpl statsweek">📈 {t('stats_week', { n: weekNew, s: weekSold ?? '—', t: last.total })}</p>}
        <p className="agentexpl">{t('stats_hint')}</p>
        <button className="agentcancel" onClick={onClose}>{t('agent_cancel')}</button>
      </div>
    </div>
  )
}
