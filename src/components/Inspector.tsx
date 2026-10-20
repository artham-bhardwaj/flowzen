import { lazy, Suspense } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpLeft, BookOpen, Code2, EyeOff, FlaskConical, Lock, MousePointerClick, Trash2 } from 'lucide-react';
import { byKind, categories, categoryOrder, parseConfig, type Kind } from '../app/catalog';
import { GUIDES } from '../learn/components';
import { ShapeGlyph } from './shapes';
import { swappableAlternatives } from '../learn/alternatives';
import type { ComponentData, FlowEdge, FlowNode, ViewMode } from '../app/model';
import { neighborsOf, type Neighbor } from '../app/neighbors';
import { LLD_COVERAGE } from '../lld/coverage';
import { usePlayback, useThrottledTime } from '../app/playback';
import { edgeKey } from '../app/validation';
import { useValidation } from '../app/validationContext';
import { componentLive } from '../simulation/playback';
import { stateDescriptions, stateLabels } from './ArchitectureNode';
import { IssueList } from './IssueList';
import { StatusIcon, statusLabels } from './status';

// The LLD models are large; they load the first time a low-level design is opened.
const LldPanel = lazy(() => import('./lld/LldPanel'));
export type NodeTab = 'component' | 'lld';

const fmt = (value: number, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
/** Engine counters with readable names; only counters the engine reported are shown. */
const COUNTER_LABELS: Record<string, string> = {
  coldStarts: 'Cold starts', throttled: 'Throttled', scaleOuts: 'Scale-outs', blocked: 'Blocked', limited: 'Rate-limited', opened: 'Times opened',
  shortCircuited: 'Failed fast', replicaReads: 'Reads to replicas', deadLettered: 'Dead-lettered', redelivered: 'Redeliveries',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="fz-stat" title={hint}><span>{label}</span><b>{value}</b></div>;
}

function ComponentLiveSection({ id, kind }: { id: string; kind: FlowNode['data']['kind'] }) {
  const { index, failureWindowMs, result } = usePlayback(); const time = useThrottledTime(150);
  const live = componentLive(index, id, time, failureWindowMs); const metric = result?.components.find(component => component.id === id);
  if (!result) return <p className="fz-empty-note">Run a simulation to see live state and measured metrics for this component.</p>;
  if (!live && !metric) return <p className="fz-empty-note">This component was not part of the last run{kind === 'deadLetterQueue' ? ' or received no dead letters' : ''}.</p>;
  const counters = Object.entries(metric?.counters ?? {});
  return <>
    {live && kind !== 'deadLetterQueue' && <>
      <h3 className="fz-section-title">At playhead <small>{fmt(time / 1000, 3)} s</small></h3>
      <div className={`fz-state-row state-${live.state}`} title={stateDescriptions[live.state]}><i aria-hidden /><b>{stateLabels[live.state]}</b><span>{stateDescriptions[live.state]}</span></div>
      {metric ? <div className="fz-stats">
        <Stat label="Busy slots" value={`${live.active} / ${live.capacity}`} />
        <Stat label="Waiting" value={`${fmt(live.queued, 0)} / ${fmt(live.queueLimit, 0)}`} hint="Queue depth / queue limit" />
        {live.hits + live.misses > 0 ? <><Stat label="Hits so far" value={fmt(live.hits, 0)} /><Stat label="Misses so far" value={fmt(live.misses, 0)} /></>
          : <><Stat label="Ended here ✓" value={fmt(live.succeeded, 0)} hint="Requests that completed at this component" /><Stat label="Failed here" value={fmt(live.failed + live.timedOut, 0)} hint={`${live.failed} failed · ${live.timedOut} timed out`} /></>}
      </div> : <div className="fz-stats"><Stat label="Requests sent" value={fmt(live.sent, 0)} /><Stat label="Unroutable" value={fmt(live.failed, 0)} /></div>}
    </>}
    {metric && <>
      <h3 className="fz-section-title">Run totals <small>engine</small></h3>
      {kind !== 'deadLetterQueue' && <div className="fz-util"><span>Utilization</span><b>{fmt(metric.utilization * 100)}%</b><span className="fz-bar"><span style={{ width: `${Math.min(100, metric.utilization * 100)}%` }} /></span></div>}
      <div className="fz-stats">
        {kind !== 'deadLetterQueue' && <>
          <Stat label="Completed" value={fmt(metric.completed, 0)} hint="Processing completions at this component" />
          <Stat label="Rejected" value={fmt(metric.rejected, 0)} hint="Rejections, timeouts and admission failures here" />
          <Stat label="Max queue" value={fmt(metric.maxQueueDepth, 0)} />
          <Stat label="Avg wait" value={`${fmt(metric.averageWaitMs)} ms`} />
          <Stat label={kind === 'containerService' ? 'Peak capacity' : 'Capacity'} value={`${fmt(metric.capacity, 0)} slots`} />
          <Stat label="Busy time" value={`${fmt(metric.busyMs / 1000, 2)} s`} />
        </>}
        {counters.map(([key, value]) => <Stat key={key} label={COUNTER_LABELS[key] ?? key} value={fmt(value, 0)} />)}
        {kind === 'deadLetterQueue' && !counters.length && <Stat label="Dead-lettered" value="0" />}
      </div>
    </>}
  </>;
}

function ValidationSection({ id, labels }: { id: string; labels: Record<string, string> }) {
  const { validation } = useValidation(); const entry = validation.components[id]; if (!entry) return null;
  return <section className={`fz-validation status-${entry.status}`} aria-label="Validation">
    <div className="fz-validation__head"><StatusIcon status={entry.status} /><b>{statusLabels[entry.status]}</b>{!entry.simulated && <span className="fz-tag"><EyeOff size={11} aria-hidden />Not simulated</span>}</div>
    <p>{entry.summary}</p>
    {entry.issues.length > 0 && <IssueList issues={entry.issues} labels={labels} />}
  </section>;
}

function NeighborRows({ items, direction, onSelect }: { items: Neighbor[]; direction: 'in' | 'out'; onSelect: (id: string) => void }) {
  if (!items.length) return <p className="fz-empty-note">{direction === 'in' ? 'Nothing sends requests here yet.' : 'No outgoing connections.'}</p>;
  return <ul className="fz-neighbors">{items.map(item => <li key={item.id} className={item.edgeStatus === 'used' ? '' : 'is-muted'}>
    <button className="fz-link" onClick={() => onSelect(item.id)}>{item.label}</button><span>{item.kindLabel}</span>
    {item.edgeStatus === 'unused' && <em title={item.reason}>not used by the simulator{item.reason ? `: ${item.reason}` : ''}</em>}
    {(item.edgeStatus === 'telemetry' || item.edgeStatus === 'dead-letter') && <em>{item.edgeStatus === 'telemetry' ? 'telemetry only' : 'dead letters only'}</em>}
  </li>)}</ul>;
}

/** HLD view of a component: what it is for, and how it exchanges traffic with its neighbors. */
function RoleSection({ node, neighbors, onSelect, onOpenLld }: { node: FlowNode; neighbors: { upstream: Neighbor[]; downstream: Neighbor[] }; onSelect: (id: string) => void; onOpenLld?: () => void }) {
  const item = byKind[node.data.kind]; const coverage = LLD_COVERAGE[node.data.kind];
  return <section className="fz-role" aria-label="Role in the architecture">
    <h3 className="fz-section-title">Role in the architecture</h3>
    <dl className="fz-contract"><dt>Receives</dt><dd>{item.inputs}</dd><dt>Sends to</dt><dd>{item.outputs}</dd></dl>
    <h4 className="fz-subtitle"><ArrowUpLeft size={12} aria-hidden />Upstream</h4>
    <NeighborRows items={neighbors.upstream} direction="in" onSelect={onSelect} />
    <h4 className="fz-subtitle"><ArrowDownRight size={12} aria-hidden />Downstream</h4>
    <NeighborRows items={neighbors.downstream} direction="out" onSelect={onSelect} />
    {onOpenLld && (coverage
      ? <button className="fz-btn fz-btn--small fz-role__lld" onClick={onOpenLld}><Code2 size={13} />Low-level design · {coverage.types} Java types</button>
      : <p className="fz-empty-note">No low-level design model for {item.label} yet.</p>)}
  </section>;
}

type ComponentProps = {
  node: FlowNode; labels: Record<string, string>; locks: Record<string, string>; onUpdate: (id: string, patch: Partial<ComponentData>) => void; onDelete: (id: string) => void;
  view: ViewMode; tab: NodeTab; onTab: (tab: NodeTab) => void; onOpenLld: () => void; neighbors: { upstream: Neighbor[]; downstream: Neighbor[] };
  /** Opens the component's full guide in Learn. */
  onLearn?: (kind: Kind) => void;
  /** Playground only: tries an alternative kind for this component (the app saves the current design first). */
  onTryAlternative?: (id: string, kind: Kind) => void;
};

/** "Why use this?": the shared guide's one-line purpose and its alternatives, with what each trades. */
function WhySection({ node, onLearn, onTryAlternative }: Pick<ComponentProps, 'node' | 'onLearn' | 'onTryAlternative'>) {
  const guide = GUIDES[node.data.kind]; const swappable = new Set(swappableAlternatives(node.data.kind).map(entry => entry.kind));
  return <section className="fz-why" aria-label="Why use this component">
    <h3 className="fz-section-title">Why use this?</h3>
    <p className="fz-desc">{guide.why}</p>
    {guide.alternatives.length > 0 && <details className="fz-why__alts"><summary>Alternatives and trade-offs <small>{guide.alternatives.length}</small></summary>
      <ul>{guide.alternatives.map(alternative => <li key={alternative.name}><b>{alternative.name}</b><span>{alternative.tradeoff}</span>
        {alternative.kind && onTryAlternative && swappable.has(alternative.kind) && !node.data.fixture && <button className="fz-btn fz-btn--small" onClick={() => onTryAlternative(node.id, alternative.kind!)} title="Saves your current design as a variant first, then swaps this component (one undoable edit)"><FlaskConical size={12} />Try {alternative.name}</button>}
        {alternative.kind && onLearn && <button className="fz-link" onClick={() => onLearn(alternative.kind!)}>Guide</button>}</li>)}</ul>
      {!onTryAlternative && swappable.size > 0 && <p className="fz-empty-note">Open the Playground’s Lab to try an alternative as a saved variant.</p>}
    </details>}
    {onLearn && <button className="fz-link fz-why__learn" onClick={() => onLearn(node.data.kind)}><BookOpen size={12} aria-hidden />Full guide: when to use it, failure modes, metrics</button>}
  </section>;
}

function ComponentInspector(props: ComponentProps) {
  const { node, view, tab, onTab, neighbors } = props; const { selectNode } = useValidation();
  const item = byKind[node.data.kind]; const coverage = LLD_COVERAGE[node.data.kind];
  // HLD focuses on system-level role; Unified and LLD add the low-level design tab.
  const active: NodeTab = view === 'HLD' ? 'component' : tab;
  return <div className="fz-inspector__body">
    {view !== 'HLD' && <div className="fz-tabs fz-node-tabs" role="tablist" aria-label="Component views">
      <button role="tab" aria-selected={active === 'component'} className={active === 'component' ? 'is-on' : ''} onClick={() => onTab('component')}>Component</button>
      <button role="tab" aria-selected={active === 'lld'} className={active === 'lld' ? 'is-on' : ''} onClick={() => onTab('lld')}><Code2 size={12} aria-hidden />Low-level design</button>
    </div>}
    {active === 'lld'
      ? coverage
        ? <Suspense fallback={<p className="fz-empty-note">Loading low-level design…</p>}><LldPanel node={node} neighbors={neighbors} onSelectNode={selectNode} /></Suspense>
        : <div className="fz-inspector__empty"><Code2 size={20} aria-hidden /><b>No low-level design for {item.label} yet</b><span>Designs are written by hand for each component so the code, diagram and principles stay consistent. Covered: {Object.values(LLD_COVERAGE).map(entry => entry!.title).join(', ')}.</span></div>
      : <ComponentDetails {...props} />}
  </div>;
}

function ComponentDetails(props: ComponentProps) {
  const { node, labels, locks, onUpdate, onDelete, view, neighbors, onOpenLld } = props;
  const { selectNode } = useValidation();
  const fixture = node.data.fixture === true;
  const item = byKind[node.data.kind]; const config = node.data.config;
  const setField = (key: string, value: string) => onUpdate(node.id, { config: { ...config, [key]: value } });
  const simulated = item.fields.filter(field => field.simulated); const descriptive = item.fields.filter(field => !field.simulated);
  return <>
    <div className="fz-panel__head"><span className="fz-eyebrow">Component</span>
      {fixture ? <span className="fz-tag"><Lock size={11} aria-hidden />Given system</span>
        : <button className="fz-icon-btn is-danger" onClick={() => onDelete(node.id)} aria-label={`Delete ${node.data.label}`} title="Delete component"><Trash2 size={14} /></button>}
    </div>
    <div className={`fz-comp-head cat-${item.category}`}>
      <ShapeGlyph kind={node.data.kind} size={36} />
      <div><h2>{node.data.label || item.label}</h2><span>{categories[item.category].label} · {item.label}</span></div>
    </div>
    <p className="fz-desc">{item.description} {item.behavior}</p>
    <WhySection node={node} onLearn={props.onLearn} onTryAlternative={props.onTryAlternative} />
    {view === 'HLD' && <RoleSection node={node} neighbors={neighbors} onSelect={selectNode} onOpenLld={onOpenLld} />}
    <ValidationSection id={node.id} labels={labels} />

    {item.simulated && <ComponentLiveSection id={node.id} kind={node.data.kind} />}

    <h3 className="fz-section-title">Properties</h3>
    {Object.keys(locks).length > 0 && <p className="fz-empty-note"><Lock size={11} aria-hidden /> {fixture ? 'This is a given system: its locked settings are fixed by the challenge.' : 'Some settings are fixed by the challenge benchmark.'}</p>}
    <label className="fz-field"><span>Display name</span><input value={node.data.label} disabled={fixture} onChange={event => onUpdate(node.id, { label: event.target.value })} /></label>
    {simulated.length > 0 && <h4 className="fz-subtitle">Simulation parameters</h4>}
    {simulated.map(field => {
      const locked = locks[field.key]; const value = locked ?? config[field.key] ?? ''; const invalid = parseConfig(value) === null;
      return <label key={field.key} className={`fz-field${invalid ? ' is-invalid' : ''}${locked !== undefined ? ' is-locked' : ''}`}>
        <span>{field.label}{field.unit && <em>{field.unit}</em>}</span>
        <input inputMode="decimal" value={value} disabled={locked !== undefined} onChange={event => setField(field.key, event.target.value)} aria-invalid={invalid} title={field.hint} />
        {locked !== undefined ? <small>Fixed by the challenge.</small> : invalid ? <small>Not a number — the simulator will use {field.fallback}.</small> : field.hint && <small>{field.hint}</small>}
      </label>;
    })}
    {descriptive.length > 0 && <>
      <h4 className="fz-subtitle">Descriptive <em>not simulated</em></h4>
      {descriptive.map(field => <label key={field.key} className="fz-field">
        <span>{field.label}</span><input value={config[field.key] ?? ''} onChange={event => setField(field.key, event.target.value)} />
        {field.hint && <small>{field.hint}</small>}
      </label>)}
    </>}
    <h3 className="fz-section-title">Contract</h3>
    <dl className="fz-contract"><dt>Inputs</dt><dd>{item.inputs}</dd><dt>Outputs</dt><dd>{item.outputs}</dd>{item.rules.length > 0 && <><dt>Checks</dt><dd><ul>{item.rules.map(rule => <li key={rule}>{rule}</li>)}</ul></dd></>}</dl>
    {view !== 'HLD' && <RoleSection node={node} neighbors={neighbors} onSelect={selectNode} />}
  </>;
}

function EdgeInspector({ edge, labels, onDelete }: { edge: FlowEdge; labels: Record<string, string>; onDelete: (id: string) => void }) {
  const { index } = usePlayback(); const { validation } = useValidation();
  const key = edgeKey(edge.source, edge.target); const lane = index?.lanes[key]; const status = validation.edges[key];
  const tone = status?.status === 'unused' ? 'is-warn' : 'is-ok';
  const text = !status ? 'This connection references a missing component.' : status.status === 'used' ? 'The simulator routes requests over this connection.' : status.reason ?? '';
  return <div className="fz-inspector__body">
    <div className="fz-panel__head"><span className="fz-eyebrow">Connection</span>
      <button className="fz-icon-btn is-danger" onClick={() => onDelete(edge.id)} aria-label="Delete connection" title="Delete connection"><Trash2 size={14} /></button>
    </div>
    <div className="fz-conn"><b>{labels[edge.source] ?? edge.source}</b><ArrowRight size={14} aria-hidden /><b>{labels[edge.target] ?? edge.target}</b></div>
    <div className={`fz-alert ${tone}`}><span>{text}</span></div>
    {index && <div className="fz-stats"><Stat label="Transitions in last run" value={fmt(lane?.hopAt.length ?? 0, 0)} /><Stat label="Ended at target" value={fmt(lane?.endAt.length ?? 0, 0)} /></div>}
    <p className="fz-empty-note">Press Delete or Backspace to remove the selected connection.</p>
  </div>;
}

function LldCoverageList({ nodes }: { nodes: FlowNode[] }) {
  const { selectNode } = useValidation();
  if (!nodes.length) return null;
  return <section aria-label="Low-level designs">
    <h3 className="fz-section-title">Low-level designs <small>select to inspect</small></h3>
    <ul className="fz-lld-coverage">{nodes.map(node => { const coverage = LLD_COVERAGE[node.data.kind]; return <li key={node.id} className={coverage ? '' : 'is-muted'}>
      <button className="fz-link" onClick={() => selectNode(node.id)}>{node.data.label || byKind[node.data.kind].label}</button>
      <span>{coverage ? `${coverage.types} Java types` : 'not covered yet'}</span>
    </li>; })}</ul>
  </section>;
}

function Overview({ nodes, edges, labels, view }: { nodes: FlowNode[]; edges: FlowEdge[]; labels: Record<string, string>; view: ViewMode }) {
  const { validation } = useValidation();
  const counts = categoryOrder.map(id => ({ id, count: nodes.filter(node => byKind[node.data.kind].category === id).length })).filter(entry => entry.count);
  const dead = validation.issues.filter(issue => issue.severity === 'dead'); const warnings = validation.issues.filter(issue => issue.severity === 'warning');
  return <div className="fz-inspector__body">
    <div className="fz-panel__head"><span className="fz-eyebrow">Architecture</span></div>
    {view === 'LLD' && <LldCoverageList nodes={nodes} />}
    <div className="fz-stats"><Stat label="Components" value={String(nodes.length)} /><Stat label="Connections" value={String(edges.length)} /></div>
    {counts.length > 0 && <ul className="fz-cat-list">{counts.map(entry => <li key={entry.id} className={`cat-${entry.id}`}><i aria-hidden />{categories[entry.id].label}<b>{entry.count}</b></li>)}</ul>}
    <h3 className="fz-section-title">Validation <small>before running</small></h3>
    <div className="fz-status-counts">{(['functional', 'warning', 'dead'] as const).map(status => <span key={status} className={`status-${status}`}><StatusIcon status={status} /><b>{validation.counts[status]}</b>{statusLabels[status]}</span>)}</div>
    {dead.length > 0 && <><h4 className="fz-subtitle">Dead <em>cannot process traffic</em></h4><IssueList issues={dead} labels={labels} showComponent /></>}
    {warnings.length > 0 && <><h4 className="fz-subtitle">Warnings <em>misconfigured or bypassed</em></h4><IssueList issues={warnings} labels={labels} showComponent /></>}
    {!validation.issues.length && <p className="fz-empty-note">{nodes.length ? 'Every component is reachable and every connection carries traffic.' : 'Add components to see validation.'}</p>}
    <div className="fz-hint"><MousePointerClick size={15} aria-hidden /><span>Select a component to edit it, a connection to inspect it, or a request particle or timeline event to open its trace. Fixes are only applied after you confirm them.</span></div>
  </div>;
}

type Props = {
  nodes: FlowNode[]; edges: FlowEdge[]; selectedNode: FlowNode | undefined; selectedEdge: FlowEdge | undefined; labels: Record<string, string>;
  /** Settings a challenge benchmark fixes for a node (empty outside challenges). */
  locksFor: (node: FlowNode) => Record<string, string>;
  onUpdateNode: ComponentProps['onUpdate']; onDeleteNode: (id: string) => void; onDeleteEdge: (id: string) => void;
  view: ViewMode; nodeTab: NodeTab; onNodeTab: (tab: NodeTab) => void; onOpenLld: () => void;
  onLearn?: ComponentProps['onLearn']; onTryAlternative?: ComponentProps['onTryAlternative'];
};
export function Inspector(props: Props) {
  const { validation } = useValidation();
  if (props.selectedNode) return <ComponentInspector key={props.selectedNode.id} node={props.selectedNode} labels={props.labels} locks={props.locksFor(props.selectedNode)} onUpdate={props.onUpdateNode} onDelete={props.onDeleteNode}
    view={props.view} tab={props.nodeTab} onTab={props.onNodeTab} onOpenLld={props.onOpenLld} neighbors={neighborsOf(props.selectedNode.id, props.nodes, props.edges, validation)}
    onLearn={props.onLearn} onTryAlternative={props.onTryAlternative} />;
  if (props.selectedEdge) return <EdgeInspector edge={props.selectedEdge} labels={props.labels} onDelete={props.onDeleteEdge} />;
  return <Overview nodes={props.nodes} edges={props.edges} labels={props.labels} view={props.view} />;
}
