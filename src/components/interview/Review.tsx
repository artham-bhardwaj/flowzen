import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import { byKind } from '../../app/catalog';
import type { ArchitectureSnapshot } from '../../challenges/attempts';
import type { ChangeComparison } from '../../interview/changes';
import type { DecisionAssessment } from '../../interview/reasoning';
import type { RunEvidence } from '../../interview/session';
import type { Resource } from '../../interview/types';
import { AREA_LABELS, EVIDENCE_LABELS, type ReviewArea, type WhiteboardReview } from '../../interview/whiteboard';
import type { Diagram } from '../../learn/types';
import { DiagramView } from '../learn/Rich';
import { ResourceLinks } from './shared';

const TONE_ICON = { ok: CircleCheck, warn: CircleAlert, bad: CircleX } as const;
const TONE_TEXT = { ok: 'Fine', warn: 'Worth attention', bad: 'Problem' } as const;

/** The whiteboard review grouped by area. `actions` is false in a running mock interview (suggestions wait for the report). */
export function WhiteboardView({ review, actions, onResource, compact = false }: { review: WhiteboardReview; actions: boolean; onResource: (resource: Resource) => void; compact?: boolean }) {
  const areas = [...new Set(review.findings.map(finding => finding.area))] as ReviewArea[];
  return <div className={`fz-iv-wb${compact ? ' is-compact' : ''}`}>
    <p className="fz-brief__note">Each finding says what it rests on: <span className="fz-iv-ev is-fact">{EVIDENCE_LABELS.fact}</span> read from the diagram, <span className="fz-iv-ev is-measured">{EVIDENCE_LABELS.measured}</span> from an isolated run of exactly this design, <span className="fz-iv-ev is-risk">{EVIDENCE_LABELS.risk}</span> reasoned but not verified.</p>
    {areas.map(area => <section key={area} className="fz-iv-wb__area" aria-label={AREA_LABELS[area]}>
      <h4>{AREA_LABELS[area]}</h4>
      <ul>{review.findings.filter(finding => finding.area === area).map(finding => { const Icon = TONE_ICON[finding.tone]; return <li key={finding.id} className={`is-${finding.tone}`}>
        <Icon size={14} aria-hidden /><span className="fz-visually-hidden">{TONE_TEXT[finding.tone]}: </span>
        <div><b>{finding.title}</b> <span className={`fz-iv-ev is-${finding.evidence}`}>{EVIDENCE_LABELS[finding.evidence]}</span>
          <p>{finding.detail}</p>
          {actions && finding.action && <p className="fz-iv-wb__action">Suggested: {finding.action}</p>}
          {actions && <ResourceLinks resources={finding.resources} onResource={onResource} />}</div>
      </li>; })}</ul>
    </section>)}
    {!actions && <p className="fz-brief__note">Suggested actions and learning links appear in the report after you finish.</p>}
    <details className="fz-iv-limits"><summary>What the simulator does not model</summary><ul className="fz-prose__list">{review.notModelled.map(item => <li key={item}>{item}</li>)}</ul></details>
  </div>;
}

/** The decision-reasoning rubric: one row per major decision, one column per dimension. */
export function DecisionRubricView({ decisions, showSuggestions }: { decisions: DecisionAssessment[]; showSuggestions: boolean }) {
  if (!decisions.length) return <p className="fz-empty-note">No component fills one of this problem’s roles yet, so there is no major decision to assess.</p>;
  const dims = decisions[0].dimensions;
  return <div className="fz-prose__tablewrap" tabIndex={0} role="group" aria-label="Decision reasoning rubric">
    <table className="fz-table fz-iv-rubric">
      <caption>Reasoning behind each major decision. ✓ means the rule found that part; it does not mean the reasoning is right.</caption>
      <thead><tr><th scope="col">Decision</th>{dims.map(dim => <th key={dim.id} scope="col">{dim.label}</th>)}<th scope="col">Score</th></tr></thead>
      <tbody>{decisions.map(entry => <tr key={entry.nodeId}>
        <th scope="row">{entry.label}<small>{entry.role ?? byKind[entry.kind].label}</small></th>
        {entry.dimensions.map(dim => <td key={dim.id} className={dim.met ? 'is-met' : 'is-unmet'}><span aria-hidden>{dim.met ? '✓' : '–'}</span><span className="fz-visually-hidden">{dim.met ? 'Found: ' : 'Not found: '}</span><small>{dim.note}</small></td>)}
        <td>{entry.score}/4{entry.uncertain && <em className="fz-tag is-warn">uncertain</em>}</td>
      </tr>)}</tbody>
    </table>
    {showSuggestions && decisions.some(entry => entry.suggestions.length) && <details><summary>Considerations you could add (suggestions, not requirements)</summary>
      <ul className="fz-prose__list">{decisions.flatMap(entry => entry.suggestions.map(text => <li key={`${entry.nodeId}${text}`}><b>{entry.label}:</b> {text}</li>))}</ul></details>}
  </div>;
}

function RunCell({ run, targets, ok }: { run: RunEvidence | undefined; targets: { p95Ms: number; minSuccessPct: number }; ok: boolean | undefined }) {
  if (!run) return <td>not run</td>;
  return <td className={ok === undefined ? '' : ok ? 'is-met' : 'is-unmet'}>p95 {run.p95 ?? '—'} ms · {run.successPct.toFixed(1)}% ok{run.busiest ? ` · busiest ${run.busiest.label} ${Math.round(run.busiest.utilization * 100)}%` : ''}{ok !== undefined && <small>{ok ? 'meets' : 'misses'} p95 ≤ {targets.p95Ms} ms, ≥ {targets.minSuccessPct}%</small>}</td>;
}
/** Original vs revised design for one requirement change: structural differences and, when comparable, measurements. */
export function ChangeComparisonView({ comparison }: { comparison: Pick<ChangeComparison, 'diff' | 'mode' | 'original' | 'revised' | 'comparable' | 'notComparable' | 'targets' | 'meets'> }) {
  const { diff } = comparison;
  const changes = diff ? [
    ...diff.components.map(entry => entry.type !== 'changed' ? `${entry.type === 'added' ? 'Added' : 'Removed'} ${entry.label} (${byKind[entry.kind].label})`
      : `${entry.label}: ${[entry.kindChanged ? `now ${byKind[entry.kindChanged.after].label}` : '', entry.renamed ? `renamed from ${entry.renamed.before}` : '', ...entry.config.map(config => `${config.label} ${config.before ?? '—'} → ${config.after ?? '—'}`)].filter(Boolean).join(', ')}`),
    ...diff.connectionsAdded.map(edge => `Connected ${edge}`), ...diff.connectionsRemoved.map(edge => `Disconnected ${edge}`)] : [];
  return <div className="fz-iv-compare">
    <h5>What changed in the design <span className="fz-iv-ev is-fact">Structural fact</span></h5>
    {!diff ? <p className="fz-empty-note">Save the revised design to see the differences.</p> : changes.length ? <ul className="fz-prose__list">{changes.map(text => <li key={text}>{text}</li>)}</ul> : <p className="fz-empty-note">The revised design is identical to the original.</p>}
    <h5>Measured under the change {comparison.mode === 'measured' ? <span className="fz-iv-ev is-measured">Measured</span> : <span className="fz-iv-ev is-risk">Hypothetical</span>}</h5>
    {comparison.mode === 'measured' && <table className="fz-table fz-iv-table"><thead><tr><th scope="col">Design</th><th scope="col">Result</th></tr></thead>
      <tbody><tr><th scope="row">Original</th><RunCell run={comparison.original} targets={comparison.targets} ok={comparison.meets.original} /></tr><tr><th scope="row">Revised</th><RunCell run={comparison.revised} targets={comparison.targets} ok={comparison.meets.revised} /></tr></tbody></table>}
    {comparison.notComparable && <p className="fz-brief__note">{comparison.notComparable}</p>}
  </div>;
}

/** A read-only diagram of a saved architecture, laid out by distance from the clients. */
export function snapshotDiagram(id: string, title: string, caption: string, architecture: ArchitectureSnapshot): Diagram {
  const depth = new Map<string, number>(); const queue = architecture.nodes.filter(node => node.kind === 'client').map(node => node.id);
  for (const nodeId of queue) depth.set(nodeId, 0);
  while (queue.length) { const nodeId = queue.shift()!; for (const edge of architecture.edges) if (edge.source === nodeId && !depth.has(edge.target)) { depth.set(edge.target, depth.get(nodeId)! + 1); queue.push(edge.target); } }
  const last = Math.max(0, ...depth.values()) + 1; const rows = new Map<number, number>();
  const nodes = architecture.nodes.map(node => { const col = depth.get(node.id) ?? last; const row = rows.get(col) ?? 0; rows.set(col, row + 1); return { id: node.id, label: node.label || byKind[node.kind].label, col, row, kind: node.kind }; });
  return { id, title, caption, nodes, edges: architecture.edges.filter(edge => nodes.some(node => node.id === edge.source) && nodes.some(node => node.id === edge.target)).map(edge => ({ from: edge.source, to: edge.target })) };
}
export function SnapshotView({ id, title, caption, architecture }: { id: string; title: string; caption: string; architecture: ArchitectureSnapshot }) {
  if (!architecture.nodes.length) return <p className="fz-empty-note">This checkpoint has no components.</p>;
  return <DiagramView diagram={snapshotDiagram(id, title, caption, architecture)} />;
}
