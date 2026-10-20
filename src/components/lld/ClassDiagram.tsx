import { useMemo } from 'react';
import { layoutDiagram } from '../../lld/diagram';
import type { LldModel } from '../../lld/types';

const STEREOTYPE: Record<string, string> = { interface: '«interface»', abstract: '«abstract»', enum: '«enum»', record: '«record»', class: '' };
const MARKERS = { implements: 'fz-uml-tri', extends: 'fz-uml-tri', uses: 'fz-uml-arrow', creates: 'fz-uml-arrow', composes: undefined } as const;

type Props = { model: LldModel; selected: string | null; onSelect: (id: string) => void; showSupport: boolean };

/** A lightweight UML class diagram rendered as SVG from the model's classes and relations. */
export function ClassDiagram({ model, selected, onSelect, showSupport }: Props) {
  const layout = useMemo(() => layoutDiagram(model, { showSupport }), [model, showSupport]);
  const classes = useMemo(() => new Map(model.classes.map(entry => [entry.id, entry])), [model]);
  const touches = (edge: { from: string; to: string }) => selected !== null && (edge.from === selected || edge.to === selected);
  return <svg className={`fz-uml${selected ? ' has-selection' : ''}`} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label={`${model.title} class diagram`}
    style={{ maxWidth: layout.width }}>
    <defs>
      <marker id="fz-uml-tri" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11 Z" className="fz-uml__tri" /></marker>
      <marker id="fz-uml-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M1 1 L11 6 L1 11" className="fz-uml__arrow" /></marker>
      <marker id="fz-uml-diamond" viewBox="0 0 14 10" refX="1" refY="5" markerWidth="13" markerHeight="9" orient="auto-start-reverse"><path d="M1 5 L7 1 L13 5 L7 9 Z" className="fz-uml__diamond" /></marker>
    </defs>
    {layout.edges.map((edge, index) => {
      const marker = MARKERS[edge.type];
      return <g key={index} className={`fz-uml__edge is-${edge.type}${touches(edge) ? ' is-hot' : ''}`}>
        <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} markerEnd={marker ? `url(#${marker})` : undefined} markerStart={edge.type === 'composes' ? 'url(#fz-uml-diamond)' : undefined} />
        {(edge.label || edge.type === 'creates') && <text x={(edge.x1 + edge.x2) / 2 + 4} y={(edge.y1 + edge.y2) / 2} className="fz-uml__label">{edge.type === 'creates' ? `«create»${edge.label ? ` ${edge.label}` : ''}` : edge.label}</text>}
      </g>;
    })}
    {layout.boxes.map(box => {
      const entry = classes.get(box.id)!; const stereotype = STEREOTYPE[entry.kind]; const isSelected = selected === box.id;
      const linked = selected !== null && !isSelected && model.relations.some(relation => (relation.from === selected && relation.to === box.id) || (relation.to === selected && relation.from === box.id));
      const long = entry.name.length > 19;
      return <g key={box.id} className={`fz-uml__box kind-${entry.kind}${isSelected ? ' is-selected' : ''}${linked ? ' is-linked' : ''}`} transform={`translate(${box.x} ${box.y})`}
        role="button" tabIndex={0} aria-pressed={isSelected} aria-label={`${entry.kind} ${entry.name}`}
        onClick={() => onSelect(box.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(box.id); } }}>
        <title>{`${entry.name}: ${entry.responsibility}`}</title>
        <rect width={box.w} height={box.h} rx={6} />
        {stereotype && <text x={box.w / 2} y={15} className="fz-uml__stereo">{stereotype}</text>}
        <text x={box.w / 2} y={stereotype ? 32 : 27} className="fz-uml__name" {...(long ? { textLength: box.w - 14, lengthAdjust: 'spacingAndGlyphs' } : {})}>{entry.name}</text>
      </g>;
    })}
  </svg>;
}

export function DiagramLegend() {
  return <ul className="fz-uml-legend" aria-label="Diagram legend">
    <li><svg width="30" height="10" aria-hidden><line x1="1" y1="5" x2="22" y2="5" className="fz-uml__legend is-implements" /><path d="M21 1 L29 5 L21 9 Z" className="fz-uml__tri" /></svg>implements</li>
    <li><svg width="30" height="10" aria-hidden><line x1="1" y1="5" x2="22" y2="5" className="fz-uml__legend" /><path d="M21 1 L29 5 L21 9 Z" className="fz-uml__tri" /></svg>extends</li>
    <li><svg width="30" height="10" aria-hidden><line x1="1" y1="5" x2="28" y2="5" className="fz-uml__legend" /><path d="M22 1 L29 5 L22 9" className="fz-uml__arrow" /></svg>uses</li>
    <li><svg width="30" height="10" aria-hidden><line x1="1" y1="5" x2="28" y2="5" className="fz-uml__legend is-creates" /><path d="M22 1 L29 5 L22 9" className="fz-uml__arrow" /></svg>creates</li>
    <li><svg width="30" height="10" aria-hidden><path d="M1 5 L6 1 L11 5 L6 9 Z" className="fz-uml__diamond" /><line x1="11" y1="5" x2="29" y2="5" className="fz-uml__legend" /></svg>owns</li>
  </ul>;
}
