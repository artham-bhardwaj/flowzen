import { Fragment, type ReactNode } from 'react';
import { CircleAlert, FlaskConical, Info } from 'lucide-react';
import { byKind } from '../../app/catalog';
import { shapeGeometry } from '../shapes';
import type { Block, Diagram } from '../../learn/types';

/** Inline text: **bold** and `code` only. Everything else is rendered as plain text. */
export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return <>{parts.map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong>
    : part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>)}</>;
}

const CALLOUT_ICONS = { note: Info, warn: CircleAlert, sim: FlaskConical } as const;
export function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, i) => <BlockView key={i} block={block} />)}</>;
}
function BlockView({ block }: { block: Block }): ReactNode {
  switch (block.type) {
    case 'p': return <p className="fz-prose__p"><Inline text={block.text} /></p>;
    case 'list': { const Tag = block.ordered ? 'ol' : 'ul'; return <Tag className="fz-prose__list">{block.items.map(item => <li key={item}><Inline text={item} /></li>)}</Tag>; }
    case 'table': return <DataTable caption={block.caption} columns={block.columns} rows={block.rows} />;
    case 'diagram': return <DiagramView diagram={block.diagram} />;
    case 'formula': return <div className="fz-formula"><code>{block.expression}</code><span><Inline text={block.explanation} /></span></div>;
    case 'example': return <div className="fz-example"><b>Example · {block.title}</b><Blocks blocks={block.blocks} /></div>;
    case 'callout': { const Icon = CALLOUT_ICONS[block.tone]; return <div className={`fz-callout is-${block.tone}`} role="note"><Icon size={15} aria-hidden /><div><b>{block.tone === 'sim' ? `Simulator · ${block.title}` : block.title}</b><p><Inline text={block.text} /></p></div></div>; }
  }
}

export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: string[][] }) {
  return <div className="fz-prose__tablewrap" tabIndex={0} role="group" aria-label={caption}>
    <table className="fz-table fz-prose__table">
      <caption>{caption}</caption>
      <thead><tr>{columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => c === 0 ? <th key={c} scope="row"><Inline text={cell} /></th> : <td key={c}><Inline text={cell} /></td>)}</tr>)}</tbody>
    </table>
  </div>;
}

// ── Diagrams ────────────────────────────────────────────────────────────────────
const COL = 196; const ROW = 86; const BOX = 156; const PAD = 8;
/** Splits a label into at most two lines near a word boundary. */
function wrap(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const cut = text.lastIndexOf(' ', max);
  const at = cut > 4 ? cut : max;
  const rest = text.slice(at).trim();
  return [text.slice(0, at).trim(), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

/** A left-to-right architecture diagram on a grid. Colors come from theme tokens via component categories. */
export function DiagramView({ diagram }: { diagram: Diagram }) {
  const layout = new Map(diagram.nodes.map(node => {
    const lines = wrap(node.label, 20); const height = 26 + lines.length * 14 + (node.note ? 13 : 0);
    return [node.id, { node, lines, x: PAD + node.col * COL, y: PAD + node.row * ROW + (62 - height) / 2, height }];
  }));
  const width = PAD * 2 + Math.max(...diagram.nodes.map(node => node.col)) * COL + BOX;
  const height = PAD * 2 + Math.max(...diagram.nodes.map(node => node.row)) * ROW + 62;
  const seen = new Map<string, number>();
  return <figure className="fz-diagram">
    <svg viewBox={`0 0 ${width} ${height}`} width={width} role="img" aria-labelledby={`dg-${diagram.id}-t dg-${diagram.id}-d`} style={{ maxWidth: '100%' }}>
      <title id={`dg-${diagram.id}-t`}>{diagram.title}</title>
      <desc id={`dg-${diagram.id}-d`}>{diagram.caption} Connections: {diagram.edges.map(edge => `${layout.get(edge.from)?.node.label} to ${layout.get(edge.to)?.node.label}${edge.label ? ` (${edge.label})` : ''}`).join('; ')}.</desc>
      <defs><marker id={`dg-${diagram.id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="fz-diagram__head" /></marker></defs>
      {diagram.edges.map((edge, i) => {
        const a = layout.get(edge.from)!; const b = layout.get(edge.to)!;
        const key = [edge.from, edge.to].sort().join('|'); const nth = seen.get(key) ?? 0; seen.set(key, nth + 1);
        const offset = nth * 12;
        let x1: number, y1: number, x2: number, y2: number;
        if (b.node.col > a.node.col) { x1 = a.x + BOX; y1 = a.y + a.height / 2 + offset; x2 = b.x; y2 = b.y + b.height / 2 + offset; }
        else if (b.node.col < a.node.col) { x1 = a.x; y1 = a.y + a.height / 2 + offset; x2 = b.x + BOX; y2 = b.y + b.height / 2 + offset; }
        else { const down = b.node.row > a.node.row; x1 = a.x + BOX / 2 + offset; y1 = down ? a.y + a.height : a.y; x2 = b.x + BOX / 2 + offset; y2 = down ? b.y : b.y + b.height; }
        const mx = (x1 + x2) / 2; const my = (y1 + y2) / 2;
        return <g key={i} className={`fz-diagram__edge${edge.dashed ? ' is-dashed' : ''}`}>
          <path d={b.node.col === a.node.col ? `M${x1} ${y1}L${x2} ${y2}` : `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} markerEnd={`url(#dg-${diagram.id}-arrow)`} />
          {edge.label && <text x={mx} y={my - 5} textAnchor="middle">{edge.label}</text>}
        </g>;
      })}
      {[...layout.values()].map(({ node, lines, x, y, height: h }) => <g key={node.id} className={`fz-diagram__node${node.kind ? ` cat-${byKind[node.kind].category}` : ' is-plain'}`}>
        {node.kind ? <g transform={`translate(${x} ${y})`}>{(() => { const shape = shapeGeometry(node.kind, BOX, h); return <>{shape.back?.map((d, i) => <path key={i} d={d} className="fz-diagram__back" />)}<path d={shape.outline} />{shape.detail && <path d={shape.detail} className="fz-diagram__detail" />}{shape.accent && <path d={shape.accent} className="fz-diagram__accent" />}</>; })()}</g> : <rect x={x} y={y} width={BOX} height={h} rx={7} />}
        {lines.map((line, i) => <text key={i} x={x + BOX / 2} y={y + 24 + i * 14} textAnchor="middle" className="fz-diagram__label">{line}</text>)}
        {node.note && <text x={x + BOX / 2} y={y + 24 + lines.length * 14} textAnchor="middle" className="fz-diagram__note">{node.note}</text>}
      </g>)}
    </svg>
    <figcaption><b>{diagram.title}.</b> {diagram.caption}</figcaption>
  </figure>;
}
