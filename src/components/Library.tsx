import { useMemo, useState } from 'react';
import { BookOpen, Plus, Search, X } from 'lucide-react';
import { byKind, catalog, categories, categoryOrder, type Kind } from '../app/catalog';
import { GUIDES } from '../learn/components';
import { SHAPE_NAMES, ShapeGlyph } from './shapes';
import { DRAG_TYPE } from './Canvas';

type Props = { onAdd: (kind: Kind) => void; onLearn: (kind: Kind) => void };

export function Library({ onAdd, onLearn }: Props) {
  const [query, setQuery] = useState(''); const [focused, setFocused] = useState<Kind | null>(null);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = catalog.filter(item => !needle || `${item.label} ${categories[item.category].label} ${item.description}`.toLowerCase().includes(needle));
    return categoryOrder.map(id => ({ id, items: matches.filter(item => item.category === id) })).filter(group => group.items.length);
  }, [query]);
  const detail = focused ? byKind[focused] : null;

  return <aside className="fz-panel fz-library" aria-label="Component library">
    <div className="fz-panel__head"><span className="fz-eyebrow">Components</span><span className="fz-panel__meta">{catalog.length}</span></div>
    <label className="fz-search">
      <Search size={14} aria-hidden />
      <input type="search" placeholder="Search components" aria-label="Search components" value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') setQuery(''); }} />
      {query && <button className="fz-search__clear" onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}
    </label>
    <div className="fz-library__list">
      {groups.map(group => <section key={group.id} className="fz-library__group" aria-label={categories[group.id].label}>
        <h3 className={`fz-library__cat cat-${group.id}`}><i aria-hidden />{categories[group.id].label}</h3>
        {group.items.map(item => {
          return <button key={item.kind} className={`fz-lib-item cat-${item.category}${focused === item.kind ? ' is-focused' : ''}`} draggable
            onDragStart={event => { event.dataTransfer.setData(DRAG_TYPE, item.kind); event.dataTransfer.effectAllowed = 'copy'; }}
            onClick={() => onAdd(item.kind)} onMouseEnter={() => setFocused(item.kind)} onFocus={() => setFocused(item.kind)}
            aria-label={`Add ${item.label}`} aria-describedby="fz-library-detail">
            <ShapeGlyph kind={item.kind} size={28} />
            <span className="fz-lib-item__text"><b>{item.label}{!item.simulated && <em className="fz-tag">Not simulated</em>}</b><small>{item.description}</small></span>
            <Plus size={14} className="fz-lib-item__add" aria-hidden />
          </button>;
        })}
      </section>)}
      {!groups.length && <div className="fz-empty-note">No components match “{query}”.</div>}
    </div>
    <div className="fz-library__detail" id="fz-library-detail" aria-live="polite">
      {detail ? <>
        <span className={`fz-library__cat cat-${detail.category}`}><i aria-hidden />{categories[detail.category].label}</span>
        <b>{detail.label}{!detail.simulated && <em className="fz-tag">Not simulated</em>}</b>
        <p className="fz-library__why"><span>Why use this?</span> {GUIDES[detail.kind].why}</p>
        <small>Drawn as {SHAPE_NAMES[detail.kind]}.</small>
        <p>{detail.behavior}</p>
        <small>{detail.simulated ? `${detail.fields.filter(field => field.simulated).length} simulated parameters` : 'Visual only: does not affect requests or performance'}</small>
        <button className="fz-link fz-library__learn" onClick={() => onLearn(detail.kind)}><BookOpen size={12} aria-hidden />When to use it, alternatives and trade-offs</button>
      </> : <p>Click a component to add it, or drag it onto the canvas. Hover or focus one to see how the simulator models it.</p>}
    </div>
  </aside>;
}
