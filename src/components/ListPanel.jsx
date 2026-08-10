import Filters from './Filters.jsx'
import Card from './Card.jsx'
import SoldCard from './SoldCard.jsx'
import { useI18n } from '../i18n.jsx'

export default function ListPanel({
  items, filters, favOnly, seaOnly, gardenOnly, soldView, soldCount, favs, seen, userPos, sort, highlightId,
  onImmediate, onApplyAdvanced, onToggleFavOnly, onToggleSea, onToggleGarden, onToggleSold, onSortChange,
  onOpen, onToggleFav, onSeen, onHover, cardRefs,
}) {
  const { t } = useI18n()
  return (
    <section id="panel">
      <Filters
        filters={filters}
        onImmediate={onImmediate}
        onApplyAdvanced={onApplyAdvanced}
        favOnly={favOnly}
        onToggleFavOnly={onToggleFavOnly}
        seaOnly={seaOnly}
        onToggleSea={onToggleSea}
        gardenOnly={gardenOnly}
        onToggleGarden={onToggleGarden}
        soldView={soldView}
        soldCount={soldCount}
        onToggleSold={onToggleSold}
      />

      <div id="resmeta">
        <div id="count" dangerouslySetInnerHTML={{
          __html: soldView
            ? t('sold_found', { n: `<b>${items.length}</b>` })
            : t(items.length === 1 ? 'found_one' : 'found_many', { n: `<b>${items.length}</b>` }),
        }} />
        {!soldView && <select id="sort" value={sort} onChange={(e) => onSortChange(e.target.value)}>
          <option value="rel">{t('sort_rel')}</option>
          <option value="pasc">{t('sort_pasc')}</option>
          <option value="pdesc">{t('sort_pdesc')}</option>
          <option value="sdesc">{t('sort_sdesc')}</option>
          <option value="new">{t('sort_new')}</option>
          <option value="dist">{t('sort_dist')}</option>
        </select>}
      </div>

      {items.length ? (
        <div id="list">
          {items.map((l) => (
            <div key={l.id} ref={(el) => { if (cardRefs) cardRefs.current[l.id] = el }}>
              {soldView ? <SoldCard s={l} /> : <Card
                l={l}
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
