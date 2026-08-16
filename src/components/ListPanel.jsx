import Filters from './Filters.jsx'
import Card from './Card.jsx'
import SoldCard from './SoldCard.jsx'
import { useI18n } from '../i18n.jsx'

export default function ListPanel({
  items, activeFilters, onClearFilters, zones, zoneCounts, features, updated, gbpEur, notes, votes, profile, onVote, reducedOnly, onToggleReduced, bothOnly, onToggleBoth, filters, favOnly, seaOnly, gardenOnly, beachOnly, soldView, soldCount, favs, seen, userPos, sort, highlightId,
  onImmediate, onApplyAdvanced, onToggleFavOnly, onToggleSea, onToggleGarden, onToggleBeach, onToggleSold, onSortChange,
  favCount, onOpenCompare, onOpenAlerts, alertsUnseen, hasAlerts,
  seenFilter, seenCounts, onSeenFilter, onMarkAllSeen, onToggleSeen,
  onOpen, onToggleFav, onSeen, onHover, cardRefs,
}) {
  const { t } = useI18n()
  return (
    <section id="panel">
      <Filters
        zones={zones}
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
          <option value="new">{t('sort_new')}</option>
          <option value="dist">{t('sort_dist')}</option>
        </select>}
      </div>

      {!soldView && activeFilters && activeFilters.length > 0 && (
        <div id="afbar">
          <span className="aflabel">{t('af_label')}</span>
          {activeFilters.map((f, i) => (
            <button key={i} className="afchip" onClick={f.clear} title={t('af_remove')}>{f.label} ✕</button>
          ))}
          {activeFilters.length > 1 && (
            <button className="afclear" onClick={onClearFilters}>{t('af_clear_all')}</button>
          )}
        </div>
      )}

      {items.length ? (
        <div id="list">
          {items.map((l) => (
            <div key={l.id} ref={(el) => { if (cardRefs) cardRefs.current[l.id] = el }}>
              {soldView ? <SoldCard s={l} /> : <Card
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
