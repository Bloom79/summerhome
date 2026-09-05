import { fmtP, hostOf } from '../utils.js'
import { useI18n } from '../i18n.jsx'
import Gallery from './Gallery.jsx'

// Days between first-seen and removal — a lower bound (we only know the
// listing since we started tracking it), hence the "≥" in the label.
const days = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000))

export default function SoldCard({ s }) {
  const { t } = useI18n()
  return (
    <div className="card sold">
      <div className="cimg">
        {s.imgs && s.imgs.length
          ? <Gallery imgs={s.imgs} />
          : <div className="cimg-ph">📷</div>}
        <span className={'tag st-' + s.status}>{t('st_' + s.status)}</span>
        <span className="price">{fmtP(s)}</span>
      </div>
      <div className="cbody">
        <div className="ctitle">{s.title}</div>
        <div className="caddr">📍 {s.addr}</div>
        <div className="cstats">
          <span>{t('sold_meta', { d: s.removed, n: String(days(s.firstSeen, s.removed)) })}</span>
        </div>
        {s.url && (
          <a className="csrc" href={s.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            🔗 {t('view_on', { host: hostOf(s.url) })} →
          </a>
        )}
      </div>
    </div>
  )
}
