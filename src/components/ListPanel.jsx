import { useEffect, useState } from 'react'
import Filters from './Filters.jsx'
import Card from './Card.jsx'
import SoldCard from './SoldCard.jsx'
import { useI18n } from '../i18n.jsx'

export default function ListPanel({
  items, activeFilters, onClearFilters, onShareSearch, areas, searches, onSaveSearch, onApplySearch, onDeleteSearch, zones, zoneCounts, features, updated, gbpEur, notes, votes, profile, onVote, reducedOnly, onToggleReduced, bothOnly, onToggleBoth, filters, favOnly, seaOnly, gardenOnly, beachOnly, auctionOnly, farmOnly, dealsOnly, dealsCount, dealById, soldView, soldCount, favs, seen, userPos, sort, highlightId,
  onImmediate, onApplyAdvanced, onToggleFavOnly, onToggleSea, onToggleGarden, onToggleBeach, onToggleAuction, onToggleFarm, onToggleDeals, onToggleSold, onSortChange,
  favCount, onOpenCompare, onOpenAlerts, alertsUnseen, hasAlerts,
  seenFilter, seenCounts, onSeenFilter, onMarkAllSeen, onToggleSeen, onOpenDealsSummary,
  onOpen, onToggleFav, onSeen, onHover, cardRefs,
}) {
  const { t } = useI18n()
  // Render the list in pages of 40: a thousand cards with their photo
  // strips choke a phone. A marker click on a card beyond the page extends
  // the page so the card can scroll into view.
  const PAGE = 40
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => { setLimit(PAGE) }, [items])
  useEffect(() => {
    if (highlightId == null) return
    const i = items.findIndex((l) => l.id === highlightId)
    if (i >= limit) setLimit(Math.ceil((i + 1) / PAGE) * PAGE)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId])
  const shown = items.length > limit ? items.slice(0, limit) : items
  return (
    <section id="panel">
      <Filters
        zones={zones}
        areas={areas}
        searches={searches} onSaveSearch={onSaveSearch} onApplySearch={onApplySearch} onDeleteSearch={onDeleteSearch}
        zoneCounts={zoneCounts}
        features={features}
        filters={filters}
        onImmediate={onImmediate}
        onApplyAdvanced={onApplyAdvanced}
        favOnly={favOnly}
        onToggleFavOnly={onToggleFavOnly}
        seaOnly={seaOnly}
        onToggleSea={onToggleSea}
        gardenOnly={gardenOnly}
        onToggleGarden={onToggleGarden}
        beachOnly={beachOnly}
        onToggleBeach={onToggleBeach}
        auctionOnly={auctionOnly}
        onToggleAuction={onToggleAuction}
        farmOnly={farmOnly}
        onToggleFarm={onToggleFarm}
        dealsOnly={dealsOnly}
        dealsCount={dealsCount}
        onToggleDeals={onToggleDeals}
        reducedOnly={reducedOnly}
        onToggleReduced={onToggleReduced}
        bothOnly={bothOnly}
        onToggleBoth={onToggleBoth}
        soldView={soldView}
        soldCount={soldCount}
        onToggleSold={onToggleSold}
        favCount={favCount}
        onOpenCompare={onOpenCompare}
        onOpenAlerts={onOpenAlerts}
        alertsUnseen={alertsUnseen}
        hasAlerts={hasAlerts}
      />

      {/* One compact row: triage tabs (they already show the count) + sort.
          The old separate "N immobili trovati" line said what "Tutte N"
          already says and cost a full row on phones. */}
      <div id="resmeta">
        {!soldView ? (
          <div id="seentabs">
            <button className={seenFilter === '' ? 'on' : ''} onClick={() => onSeenFilter('')}>
              {t('seen_all')} <b>{seenCounts.all}</b>
            </button>
            <button className={seenFilter === 'unseen' ? 'on' : ''} onClick={() => onSeenFilter('unseen')}>
              👁 {t('seen_unseen')} <b>{seenCounts.unseen}</b>
            </button>
            <button className={seenFilter === 'seen' ? 'on' : ''} onClick={() => onSeenFilter('seen')}>
              ✓ {t('seen_seen')} <b>{seenCounts.seen}</b>
            </button>
            {seenFilter === 'unseen' && seenCounts.unseen > 0 && (
              <button className="markall" onClick={onMarkAllSeen}>{t('mark_all_seen')}</button>
            )}
          </div>
        ) : (
          <div id="count" dangerouslySetInnerHTML={{ __html: t('sold_found', { n: `<b>${items.length}</b>` }) }} />
        )}
        {!soldView && <select id="sort" value={sort} onChange={(e) => onSortChange(e.target.value)}>
          <option value="rel">{t('sort_rel')}</option>
          <option value="pasc">{t('sort_pasc')}</option>
          <option value="pdesc">{t('sort_pdesc')}</option>
          <option value="sdesc">{t('sort_sdesc')}</option>
          <option value="ppm">{t('sort_ppm')}</option>
          <option value="drop">{t('sort_drop')}</option>
          <option value="new">{t('sort_new')}</option>
          <option value="deal">{t('sort_deal')}</option>
          <option value="dist">{t('sort_dist')}</option>
        </select>}
      </div>

      {!soldView && dealsOnly && (
        <button id="dealsummarybar" onClick={onOpenDealsSummary}>
          📋 {t('deals_summary_btn')} →
        </button>
      )}

      {!soldView && activeFilters && activeFilters.length > 0 && (
        <div id="afbar">
          <span className="aflabel">{t('af_label')}</span>
          {activeFilters.map((f, i) => (
            <button key={i} className="afchip" onClick={f.clear} title={t('af_remove')}>{f.label} ✕</button>
          ))}
          {activeFilters.length > 1 && (
            <button className="afclear" onClick={onClearFilters}>{t('af_clear_all')}</button>
          )}
          {onShareSearch && (
            <button className="afshare" onClick={onShareSearch} title={t('share_search')}>{t('share_search')}</button>
          )}
        </div>
      )}

      {items.length ? (
        <div id="list">
          {shown.map((l) => (
            <div key={l.id} ref={(el) => { if (cardRefs) cardRefs.current[l.id] = el }}>
              {soldView ? <SoldCard s={l} /> : <Card
            deal={dealById && dealById.get(l.id)}
                l={l}
                updated={updated}
                gbpEur={gbpEur}
                hasNote={!!(notes && notes[l.url])}
                vote={(votes && votes[l.url]) || {}}
                profile={profile}
                onVote={onVote}
                onToggleSeen={onToggleSeen}
                fav={favs.has(l.id)}
                seen={seen.has(l.id)}
                highlighted={highlightId === l.id}
                userPos={userPos}
                onOpen={onOpen}
                onToggleFav={onToggleFav}
                onSeen={onSeen}
                onHover={onHover}
              />}
            </div>
          ))}
          {items.length > shown.length && (
            <button id="showmore" onClick={() => setLimit((n) => n + PAGE)}>
              {t('show_more', { n: Math.min(PAGE, items.length - shown.length) })} <small>{t('shown_of', { a: shown.length, n: items.length })}</small>
            </button>
          )}
        </div>
      ) : (
        <div id="empty">
          <div className="big">🔎</div>
          {t('empty1')}<br />
          {t('empty2')}
        </div>
      )}
    </section>
  )
}
