import { fmtP, srcOf } from '../utils.js'
import { useI18n } from '../i18n.jsx'

// Landing "Novità" panel: the first thing shown on open. It greets with the
// houses added since the last visit — sea-view and garden ones featured —
// and carries the macro-filters (zone, freshness, sea, garden, deals) so the
// whole app can be steered from here. It drives the SAME global filter state
// as the rest of the app, so entering the portal keeps every choice.
export default function HomePanel({
  open, onClose, onEnter, newCount, firstVisit, items, previewCount,
  zones, zoneVal, onZone, freshVal, onFresh, seaOnly, onSea, gardenOnly, onGarden,
  dealsOnly, onDeals, dealsCount, gbpEur, updated, onOpenListing,
  pushState, onCreateAlert,
}) {
  const { t, typeLabel } = useI18n()
  if (!open) return null

  const zoneLabel = (z) => z.replace(/ \((Scozia|Irlanda|UK|Donegal, IE|Fife, Scozia)\)$/, '')
  const featured = items.slice(0, 6)

  return (
    <div id="homewrap" onClick={onClose}>
      <div id="homepanel" onClick={(e) => e.stopPropagation()}>
        <div className="homehead">
          <div>
            <h2>✨ {t('home_title')}</h2>
            <p className="homesub">
              {firstVisit
                ? t('home_sub_first', { n: newCount })
                : t('home_sub', { n: newCount })}
            </p>
          </div>
          <button className="homex" onClick={onClose} aria-label="close">✕</button>
        </div>

        {/* Macro filters — steer the whole app from here */}
        <div className="homefilters">
          <label className="homefield">
            <span>{t('home_zone')}</span>
            <select value={zoneVal} onChange={(e) => onZone(e.target.value)}>
              <option value="">{t('home_all_zones')}</option>
              {zones.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
            </select>
          </label>
          <label className="homefield">
            <span>{t('home_when')}</span>
            <select value={freshVal} onChange={(e) => onFresh(e.target.value)}>
              <option value="visit">{t('home_since_visit')}</option>
              <option value="3">{t('home_3days')}</option>
              <option value="7">{t('home_7days')}</option>
              <option value="">{t('home_anytime')}</option>
            </select>
          </label>
        </div>

        <div className="hometoggles">
          <button className={seaOnly ? 'on' : ''} onClick={onSea}>{t('sea_view')}</button>
          <button className={gardenOnly ? 'on' : ''} onClick={onGarden}>{t('garden')}</button>
          {dealsCount > 0 && <button className={dealsOnly ? 'on' : ''} onClick={onDeals}>{t('deals_chip')}</button>}
        </div>

        {/* Featured preview: sea-view / garden first */}
        {featured.length > 0 ? (
          <div className="homefeat">
            {featured.map((l) => {
              const eur = l.currency === 'GBP' && gbpEur ? '≈ €' + Math.round(l.price * gbpEur).toLocaleString('it-IT') : null
              const src = srcOf(l.url)
              return (
                <button key={l.id} className="homecard" onClick={() => onOpenListing(l.id)}>
                  <div className="hcimg">
                    {l.imgs && l.imgs[0]
                      ? <img src={l.imgs[0]} alt="" loading="lazy" />
                      : <div className="hcph">📷</div>}
                    <div className="hcbadges">
                      {l.date === updated && <span className="hcb new">✨</span>}
                      {l.seaView && <span className="hcb sea">🌊</span>}
                      {l.feats.includes('Giardino') && <span className="hcb gar">🌳</span>}
                    </div>
                    <span className="hcprice" title={eur || undefined}>{fmtP(l)}</span>
                  </div>
                  <div className="hcbody">
                    <div className="hctitle">{l.title}</div>
                    <div className="hcmeta">
                      {l.rooms ? <span>🛏 {l.rooms}</span> : null}
                      {l.size ? <span>{l.size} m²</span> : null}
                      <span>{typeLabel(l.type)}</span>
                      {src && <span className={'srcb srcb-' + src.key}>{src.label}</span>}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="homeempty">{t('home_empty')}</p>
        )}

        <div className="homeactions">
          <button className="homeenter" onClick={onEnter}>
            {previewCount > 0 ? t('home_see_all', { n: previewCount }) : t('home_browse')} →
          </button>
          {pushState !== 'unsupported' && (
            <button className="homealert" onClick={onCreateAlert} disabled={pushState === 'on'}>
              🔔 {pushState === 'on' ? t('home_alert_on') : t('home_alert')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
