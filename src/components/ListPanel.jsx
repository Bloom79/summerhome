import Filters from './Filters.jsx'
import Card from './Card.jsx'

export default function ListPanel({
  items, filters, favOnly, favs, userPos, sort, highlightId,
  onImmediate, onApplyAdvanced, onToggleFavOnly, onSortChange,
  onOpen, onToggleFav, onHover, cardRefs,
}) {
  return (
    <section id="panel">
      <Filters
        filters={filters}
        onImmediate={onImmediate}
        onApplyAdvanced={onApplyAdvanced}
        favOnly={favOnly}
        onToggleFavOnly={onToggleFavOnly}
      />

      <div id="resmeta">
        <div id="count">
          <b>{items.length}</b> immobil{items.length === 1 ? 'e' : 'i'} trovat{items.length === 1 ? 'o' : 'i'}
        </div>
        <select id="sort" value={sort} onChange={(e) => onSortChange(e.target.value)}>
          <option value="rel">Rilevanza</option>
          <option value="pasc">Prezzo ↑</option>
          <option value="pdesc">Prezzo ↓</option>
          <option value="sdesc">Superficie ↓</option>
          <option value="new">Più recenti</option>
          <option value="dist">Distanza</option>
        </select>
      </div>

      {items.length ? (
        <div id="list">
          {items.map((l) => (
            <div key={l.id} ref={(el) => { if (cardRefs) cardRefs.current[l.id] = el }}>
              <Card
                l={l}
                fav={favs.has(l.id)}
                highlighted={highlightId === l.id}
                userPos={userPos}
                onOpen={onOpen}
                onToggleFav={onToggleFav}
                onHover={onHover}
              />
            </div>
          ))}
        </div>
      ) : (
        <div id="empty">
          <div className="big">🔎</div>
          Nessun immobile trovato con questi criteri.<br />
          Prova ad allargare l'area sulla mappa o ad azzerare i filtri.
        </div>
      )}
    </section>
  )
}
