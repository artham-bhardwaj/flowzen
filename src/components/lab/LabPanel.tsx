import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleHelp, CircleX, FlaskConical, GitCompareArrows, LoaderCircle, Play, Plus, Save, Square, Trash2, TrendingUp, Upload, X } from 'lucide-react';
import { byKind, type Kind } from '../../app/catalog';
import type { FlowEdge, FlowNode } from '../../app/model';
import type { Theme } from '../../app/theme';
import type { ArchitectureSnapshot } from '../../challenges/attempts';
import {
  LAB_LIMITS, analyzeSweep, benchmarkDifferences, compareRuns, curveSeries, explainComparison, explainRun, planSweep, presetLevels, validateBenchmark,
  type Insight, type LabBenchmark, type LabRun, type RunComparison, type TargetResult,
} from '../../lab/lab';
import { LESSONS } from '../../lab/lessons';
import { MAX_VARIANTS } from '../../lab/store';
import { canAddReplica, canInsertCache } from '../../lab/edits';
import { runMatches, type LabController } from '../../lab/useLab';
import type { LearnController } from '../../learn/useLearn';
import { GuidedPanel, type PlaygroundFocus } from '../learn/GuidedPanel';

const ScalingChart = lazy(() => import('./ScalingChart'));
type Tab = 'setup' | 'experiment' | 'results' | 'variants' | 'guided' | 'learn';
const TABS: Array<[Tab, string]> = [['setup', 'Setup'], ['experiment', 'Experiment'], ['results', 'Results'], ['variants', 'Variants'], ['guided', 'Guided'], ['learn', 'Hypotheses']];
/** The simulated settings the lab exposes per component kind (only parameters the engine models). */
const CONTROLS: Partial<Record<Kind, string[]>> = {
  server: ['instances'], containerService: ['maxTasks', 'slotsPerTask'], serverless: ['concurrency'],
  loadBalancer: ['concurrency'], reverseProxy: ['concurrency'], gateway: ['concurrency'],
  cache: ['hitRatio', 'concurrency'], cdn: ['hitRatio', 'concurrency'], distributedCache: ['hitRatio', 'nodes'],
  database: ['concurrency', 'readRatio'], readReplica: ['concurrency'], nosql: ['concurrency'], searchEngine: ['concurrency'], objectStorage: ['concurrency'],
  queue: ['queueLimit', 'maxDeliveries', 'redeliveryDelayMs'], eventStream: ['partitions', 'maxDeliveries'], worker: ['concurrency', 'processingRate'],
  rateLimiter: ['ratePerSecond', 'burst'], circuitBreaker: ['failureThresholdPct', 'openMs'],
};
const fmt = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const pct = (value: number) => `${fmt(value * 100, 1)}%`;
const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Props = {
  lab: LabController; theme: Theme; snapshot: ArchitectureSnapshot; labels: Record<string, string>; nodes: FlowNode[]; edges: FlowEdge[];
  onSetConfig: (id: string, key: string, value: string) => void; onAddReplica: (id: string) => void; onInsertCache: (id: string) => void;
  /** Replaces the experiment canvas (one undoable edit). Only called after confirmation when it would change the canvas. */
  onLoad: (snapshot: ArchitectureSnapshot, label: string) => void;
  sources: { sample: ArchitectureSnapshot; design: ArchitectureSnapshot | null; challengeDrafts: Array<{ id: string; title: string; snapshot: ArchitectureSnapshot }> };
  /** Learning progress (guided experiments and exercises record into it) and what a lesson opened the Playground for. */
  learn: LearnController; focus: PlaygroundFocus | null; onOpenLesson: (lessonId: string, section: 'exercise' | 'experiment') => void;
};

function TargetList({ results }: { results: TargetResult[] }) {
  return <ul className="fz-crit">{results.map(result => <li key={result.id} className={`is-${result.met === true ? 'pass' : result.met === false ? 'fail' : 'unavailable'}`}>
    {result.met === true ? <CircleCheck size={14} aria-label="Met" /> : result.met === false ? <CircleX size={14} aria-label="Missed" /> : <CircleHelp size={14} aria-label="Not measurable" />}
    <span>{result.label}{result.reason && <em> · {result.reason}</em>}</span><b>{result.measured === null ? '—' : `${fmt(result.measured, 2)}${result.unit === '%' ? '%' : ` ${result.unit}`}`}</b>
  </li>)}</ul>;
}

function RunSummary({ run, status }: { run: LabRun; status?: string }) {
  const m = run.measurements;
  return <div className="fz-labrun">
    <div className="fz-labrun__head"><b>{run.label}</b><span>{when(run.at)} · {fmt(run.benchmark.rps, 0)} req/s · seed {run.benchmark.seed}</span>{status && <em className="fz-tag">{status}</em>}</div>
    {!m.complete && <div className="fz-alert is-warn"><span>Incomplete: the engine reached its limit of {LAB_LIMITS.maxEventsPerRun.toLocaleString()} events. No measurement from this run is used.</span></div>}
    <dl className="fz-facts fz-labrun__kpis">
      <dt>Offered → succeeded</dt><dd>{fmt(m.offeredRequests, 0)} → {fmt(m.completedRequests, 0)} ({fmt(m.successPct, 2)}%)</dd>
      <dt>Successful throughput</dt><dd>{fmt(m.successThroughput)} req/s</dd>
      <dt>p50 · p95 · p99</dt><dd>{fmt(m.p50)} · {fmt(m.p95)} · {fmt(m.p99)} ms</dd>
      <dt>Error rate</dt><dd>{fmt(m.errorRatePct, 2)}%</dd>
    </dl>
    <TargetList results={run.targetResults} />
  </div>;
}

function Insights({ insights }: { insights: Insight[] }) {
  if (!insights.length) return null;
  return <ul className="fz-findings">{insights.map((insight, i) => <li key={`${insight.title}-${i}`} className={`fz-finding is-${insight.basis === 'measured' ? 'info' : 'medium'}`}>
    <span className={`fz-basis is-${insight.basis}`}>{insight.basis === 'measured' ? 'Measured' : 'Heuristic'}</span> <b>{insight.title}</b>
    <ul>{insight.evidence.map(item => <li key={item}>{item}</li>)}</ul>
  </li>)}</ul>;
}

function Comparison({ comparison, baseline, experiment }: { comparison: RunComparison; baseline: LabRun; experiment: LabRun }) {
  const { structural } = comparison;
  return <section aria-label="Baseline vs experiment">
    <div className={`fz-alert ${comparison.comparable ? (comparison.attribution.kind === 'multiple-changes' ? 'is-warn' : 'is-ok') : 'is-bad'} fz-attribution`} role="note"><span>
      <b>{comparison.comparable ? 'Same benchmark: like-for-like comparison' : 'Different benchmarks: not directly comparable'}</b>{comparison.attribution.message}</span></div>
    <table className="fz-table fz-compare__table">
      <thead><tr><th scope="col">Metric</th><th scope="col">Baseline</th><th scope="col">{experiment.label}</th><th scope="col">Change</th></tr></thead>
      <tbody>{comparison.metrics.map(entry => <tr key={entry.key}><th scope="row">{entry.label}</th><td>{fmt(entry.a, 2)}</td><td>{fmt(entry.b, 2)}</td>
        <td><span className={`fz-delta ${entry.verdict === 'improved' ? 'is-better' : entry.verdict === 'regressed' ? 'is-worse' : ''}`}>{entry.delta === null ? '—' : entry.delta === 0 ? 'no change' : `${entry.delta > 0 ? '+' : ''}${fmt(entry.delta, 2)} ${entry.unit === '%' ? 'pts' : entry.unit}`}</span></td></tr>)}</tbody>
    </table>
    <table className="fz-table fz-compare__table">
      <thead><tr><th scope="col">Target</th><th scope="col">Baseline</th><th scope="col">{experiment.label}</th></tr></thead>
      <tbody>{comparison.targets.map(target => <tr key={target.id} className={target.a !== target.b ? 'is-changed' : ''}><th scope="row">{target.label}</th>
        {[target.a, target.b].map((met, i) => <td key={i}>{met === true ? 'met' : met === false ? 'missed' : 'not measurable'}</td>)}</tr>)}</tbody>
    </table>
    <table className="fz-table fz-compare__table">
      <thead><tr><th scope="col">Component</th><th scope="col">Busy (traffic window)</th><th scope="col">Peak queue</th><th scope="col">Avg wait</th></tr></thead>
      <tbody>{comparison.components.map(entry => <tr key={entry.id}><th scope="row">{entry.label}</th>
        <td>{entry.utilization.map(value => value === null ? '—' : pct(value)).join(' → ')}</td><td>{entry.maxQueue.map(value => fmt(value, 0)).join(' → ')}</td><td>{entry.averageWaitMs.map(value => value === null ? '—' : `${fmt(value)} ms`).join(' → ')}</td></tr>)}</tbody>
    </table>
    <div className="fz-labdiff">
      {comparison.improvements.length > 0 && <div><h4 className="fz-subtitle">Improvements</h4><ul>{comparison.improvements.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {comparison.regressions.length > 0 && <div><h4 className="fz-subtitle">Regressions</h4><ul>{comparison.regressions.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {comparison.newFailureModes.length > 0 && <div><h4 className="fz-subtitle">New failure modes</h4><ul>{comparison.newFailureModes.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {comparison.resolvedFailureModes.length > 0 && <div><h4 className="fz-subtitle">Failure modes no longer seen</h4><ul>{comparison.resolvedFailureModes.map(item => <li key={item}>{item}</li>)}</ul></div>}
    </div>
    <h4 className="fz-subtitle">Architecture differences <em>from the two snapshots</em></h4>
    {comparison.simulationChanges.length ? <ul className="fz-structural">{comparison.simulationChanges.map(change => <li key={change}>{change}</li>)}</ul> : <p className="fz-empty-note">No simulation input changed.</p>}
    {structural.components.some(change => change.type === 'changed' && (change.renamed || change.moved)) && <p className="fz-brief__note">Renames and moves are cosmetic and not listed as simulation changes.</p>}
    <h4 className="fz-subtitle">Explanations</h4>
    <Insights insights={explainComparison(baseline, experiment, comparison)} />
  </section>;
}

/** The Scaling Laboratory's right-panel workspace. */
export function LabPanel({ lab, theme, snapshot, labels, nodes, edges, onSetConfig, onAddReplica, onInsertCache, onLoad, sources, learn, focus, onOpenLesson }: Props) {
  const [tab, setTab] = useState<Tab>(focus ? 'guided' : 'setup');
  useEffect(() => { if (focus) setTab('guided'); }, [focus]);
  const [pending, setPending] = useState<{ snapshot: ArchitectureSnapshot; label: string; then?: () => void } | null>(null);
  const [draftId, setDraftId] = useState(sources.challengeDrafts[0]?.id ?? '');
  const [levels, setLevels] = useState<number[]>(() => presetLevels(lab.lab.benchmark.rps, [0.5, 1, 1.5, 2, 3]));
  const [custom, setCustom] = useState('');
  const [variantName, setVariantName] = useState('');
  const [compareWith, setCompareWith] = useState<string>('latest');
  const { lab: state, runner } = lab;
  const running = runner.status === 'running';
  const benchmarkErrors = validateBenchmark(state.benchmark, new Set(snapshot.nodes.map(node => node.id)));
  const plan = useMemo(() => planSweep(state.benchmark, levels), [state.benchmark, levels]);

  /** Loading into the canvas asks first unless it would not change anything. */
  const requestLoad = (next: ArchitectureSnapshot, label: string, then?: () => void) => { if (same(next.nodes, snapshot.nodes) && same(next.edges, snapshot.edges)) { then?.(); return; } if (!snapshot.nodes.length) { onLoad(next, label); then?.(); } else setPending({ snapshot: next, label, then }); };
  const setBenchmark = (patch: Partial<LabBenchmark>) => lab.setBenchmark({ ...state.benchmark, ...patch });
  const numberField = (label: string, value: number, onChange: (value: number) => void, unit: string, hint?: string) =>
    <label className="fz-field fz-labfield"><span>{label}<em>{unit}</em></span><input type="number" value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.value === '' ? Number.NaN : Number(event.target.value))} />{hint && <small>{hint}</small>}</label>;

  const target = compareWith === 'latest' ? state.experiment : state.variants.find(variant => variant.id === compareWith)?.run ?? null;
  const targetCurrent = compareWith === 'latest' && runMatches(state.experiment, snapshot, state.benchmark);
  const comparison = useMemo(() => state.baseline && target ? compareRuns(state.baseline, target) : null, [state.baseline, target]);
  const sweepAnalysis = useMemo(() => state.sweep ? analyzeSweep(state.sweep.points) : null, [state.sweep]);
  const baselineDiffs = state.baseline ? benchmarkDifferences(state.baseline.benchmark, state.benchmark, state.baseline.simulatorRevision, state.baseline.simulatorRevision) : [];
  const lessonContext = { baseline: state.baseline, experiment: target, sweep: state.sweep };

  return <div className="fz-inspector__body fz-lab">
    <div className="fz-panel__head"><span className="fz-eyebrow">Scaling Laboratory</span><span className="fz-dialog__sub">local · {state.variants.length}/{MAX_VARIANTS} variants</span></div>
    {running && <div className="fz-labstatus" role="status">
      <LoaderCircle size={14} className="fz-spin" aria-hidden /><span>{runner.label}: level {runner.done + 1} of {runner.total}</span>
      <span className="fz-bar"><span style={{ width: `${runner.done / runner.total * 100}%` }} /></span>
      <button className="fz-btn fz-btn--small" onClick={lab.cancel}><Square size={12} />Cancel</button>
    </div>}
    {lab.message && <div className="fz-alert is-warn" role="alert"><span>{lab.message}</span><button className="fz-icon-btn" onClick={lab.dismissMessage} aria-label="Dismiss"><X size={13} /></button></div>}
    {lab.dropped.length > 0 && <div className="fz-alert is-warn"><span><b>Some saved lab records could not be loaded</b>They were left out rather than replaced: {lab.dropped.join('; ')}.</span></div>}
    {lab.saveFailed && <div className="fz-alert is-bad"><span>Lab data could not be saved in this browser (storage full or blocked). It is kept for this session only.</span></div>}

    <div className="fz-tabs fz-lld__tabs" role="tablist" aria-label="Laboratory sections">
      {TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>

    {pending && <div className="fz-confirm fz-confirm--inline" role="alertdialog" aria-labelledby="fz-lab-confirm">
      <h3 id="fz-lab-confirm">Replace the experiment architecture?</h3>
      <p>The canvas will be replaced with {pending.label}. The baseline and saved variants are not affected, and Undo restores the current canvas.</p>
      <div className="fz-dialog__actions"><button className="fz-btn" onClick={() => setPending(null)}>Keep current</button><button className="fz-btn fz-btn--primary" onClick={() => { onLoad(pending.snapshot, pending.label); pending.then?.(); setPending(null); }}><Upload size={13} />Replace</button></div>
    </div>}

    {tab === 'setup' && <>
      <h3 className="fz-section-title">Start from</h3>
      <div className="fz-brief__actions">
        <button className="fz-btn fz-btn--small" onClick={() => requestLoad(sources.sample, 'the sample architecture')}>Sample architecture</button>
        <button className="fz-btn fz-btn--small" disabled={!sources.design} onClick={() => sources.design && requestLoad(sources.design, 'your design canvas')}>Design canvas</button>
      </div>
      {sources.challengeDrafts.length > 0 && <div className="fz-labrow">
        <select value={draftId} onChange={event => setDraftId(event.target.value)} aria-label="Saved challenge design">{sources.challengeDrafts.map(draft => <option key={draft.id} value={draft.id}>{draft.title}</option>)}</select>
        <button className="fz-btn fz-btn--small" onClick={() => { const draft = sources.challengeDrafts.find(entry => entry.id === draftId); if (draft) requestLoad(draft.snapshot, `your “${draft.title}” challenge draft`); }}>Load challenge design</button>
      </div>}
      <p className="fz-brief__note">Loading copies a design into the lab canvas. The original is not changed, and challenge history is never touched.</p>

      <h3 className="fz-section-title">Benchmark <small>deterministic</small></h3>
      <div className="fz-labgrid">
        {numberField('Traffic', state.benchmark.rps, value => setBenchmark({ rps: value }), 'req/s')}
        {numberField('Traffic window', state.benchmark.durationMs / 1000, value => setBenchmark({ durationMs: Math.round(value * 1000) }), 's')}
        {numberField('Drain window', state.benchmark.drainMs / 1000, value => setBenchmark({ drainMs: Math.round(value * 1000) }), 's', 'Run time after arrivals stop.')}
        {numberField('Seed', state.benchmark.seed, value => setBenchmark({ seed: value }), '')}
      </div>
      <h4 className="fz-subtitle">Injected failures <em>scheduled outages</em></h4>
      {state.benchmark.faults.map((fault, i) => <div key={i} className="fz-labrow">
        <select value={fault.nodeId} aria-label="Failing component" onChange={event => setBenchmark({ faults: state.benchmark.faults.map((entry, j) => j === i ? { ...entry, nodeId: event.target.value } : entry) })}>
          {snapshot.nodes.filter(node => byKind[node.kind].simulated && node.kind !== 'client').map(node => <option key={node.id} value={node.id}>{labels[node.id]}</option>)}
          {!snapshot.nodes.some(node => node.id === fault.nodeId) && <option value={fault.nodeId}>{fault.nodeId} (not in the design)</option>}
        </select>
        <input type="number" aria-label="Outage start (s)" value={fault.startMs / 1000} onChange={event => setBenchmark({ faults: state.benchmark.faults.map((entry, j) => j === i ? { ...entry, startMs: Math.round(Number(event.target.value) * 1000) } : entry) })} /><span>to</span>
        <input type="number" aria-label="Outage end (s)" value={fault.endMs / 1000} onChange={event => setBenchmark({ faults: state.benchmark.faults.map((entry, j) => j === i ? { ...entry, endMs: Math.round(Number(event.target.value) * 1000) } : entry) })} /><span>s</span>
        <button className="fz-icon-btn is-danger" aria-label="Remove failure" onClick={() => setBenchmark({ faults: state.benchmark.faults.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
      </div>)}
      <button className="fz-btn fz-btn--small" disabled={!snapshot.nodes.some(node => node.kind !== 'client')} onClick={() => { const node = snapshot.nodes.find(entry => entry.kind !== 'client' && byKind[entry.kind].simulated); if (node) setBenchmark({ faults: [...state.benchmark.faults, { nodeId: node.id, startMs: Math.min(2000, state.benchmark.durationMs / 2), endMs: Math.min(4000, state.benchmark.durationMs) }] }); }}><Plus size={12} />Add failure</button>
      {benchmarkErrors.length > 0 && <ul className="fz-results__list is-errors">{benchmarkErrors.map(error => <li key={error}>{error}</li>)}</ul>}

      <h3 className="fz-section-title">Performance targets</h3>
      <div className="fz-labgrid">
        {numberField('p95 latency ≤', state.targets.p95Ms, value => lab.setTargets({ ...state.targets, p95Ms: value }), 'ms')}
        {numberField('Error rate ≤', state.targets.maxErrorRatePct, value => lab.setTargets({ ...state.targets, maxErrorRatePct: value }), '%')}
        {numberField('Offered requests that succeed ≥', state.targets.minSuccessPct, value => lab.setTargets({ ...state.targets, minSuccessPct: value }), '%')}
      </div>

      <h3 className="fz-section-title">Baseline</h3>
      {state.baseline ? <RunSummary run={state.baseline} /> : <p className="fz-empty-note">No baseline yet. A baseline is an immutable run of a design under the benchmark; experiments are compared with it.</p>}
      {state.baseline && baselineDiffs.length > 0 && <div className="fz-alert is-warn"><span>The benchmark above differs from the baseline’s ({baselineDiffs.join(', ')}). Experiments run with it will not be directly comparable.
        <button className="fz-link" onClick={() => lab.setBenchmark(state.baseline!.benchmark)}>Use the baseline’s benchmark</button></span></div>}
      <div className="fz-brief__actions">
        <button className="fz-btn fz-btn--small fz-btn--primary" disabled={running || benchmarkErrors.length > 0} onClick={() => { if (!state.baseline || window.confirm('Replace the baseline with a new run of the current design? The old baseline is discarded; saved variants are kept.')) lab.runBaseline(snapshot, labels); }}><FlaskConical size={12} />{state.baseline ? 'Replace baseline with current design' : 'Set current design as baseline'}</button>
        {state.baseline && <button className="fz-btn fz-btn--small" onClick={() => requestLoad(state.baseline!.architecture, 'a copy of the baseline')}>Duplicate baseline into experiment</button>}
      </div>
    </>}

    {tab === 'experiment' && <>
      <p className="fz-brief__note">Edit the experiment on the canvas or with these controls. Every change is an undoable edit; the baseline and saved variants are never modified. Only settings the simulator models are offered.</p>
      {state.baseline && <p className={`fz-labmatch ${baselineDiffs.length ? 'is-warn' : 'is-ok'}`}>{baselineDiffs.length ? `Benchmark differs from the baseline: ${baselineDiffs.join(', ')}` : 'Benchmark matches the baseline: results will be directly comparable.'}</p>}
      <div className="fz-labcontrols">{nodes.filter(node => CONTROLS[node.data.kind]).map(node => {
        const keys = (CONTROLS[node.data.kind] ?? []).filter(key => byKind[node.data.kind].fields.some(field => field.key === key && field.simulated))
          .filter(key => key !== 'readRatio' || edges.some(edge => edge.source === node.id && nodes.find(entry => entry.id === edge.target)?.data.kind === 'readReplica'));
        return <div key={node.id} className={`fz-labcontrol cat-${byKind[node.data.kind].category}`}>
          <div className="fz-labcontrol__head"><b>{node.data.label}</b><span>{byKind[node.data.kind].label}</span></div>
          <div className="fz-labgrid">{keys.map(key => { const field = byKind[node.data.kind].fields.find(entry => entry.key === key)!; return <label key={key} className="fz-field fz-labfield">
            <span>{field.label}{field.unit && <em>{field.unit}</em>}</span>
            <input type="number" min={0} value={node.data.config[key] ?? ''} onChange={event => onSetConfig(node.id, key, event.target.value)} aria-label={`${node.data.label} ${field.label}`} disabled={node.data.fixture === true} />
          </label>; })}</div>
          {(canAddReplica(nodes, edges, node.id) || canInsertCache(nodes, edges, node.id)) && <div className="fz-brief__actions">
            {canAddReplica(nodes, edges, node.id) && <button className="fz-btn fz-btn--small" onClick={() => onAddReplica(node.id)}><Plus size={12} />Add replica</button>}
            {canInsertCache(nodes, edges, node.id) && <button className="fz-btn fz-btn--small" onClick={() => onInsertCache(node.id)}><Plus size={12} />Insert cache in front</button>}
          </div>}
        </div>;
      })}</div>
      <div className="fz-brief__actions">
        <button className="fz-btn fz-btn--primary" disabled={running || benchmarkErrors.length > 0} onClick={() => { lab.runExperiment(snapshot, labels); setTab('results'); }}><Play size={13} />Run experiment</button>
      </div>

      <h3 className="fz-section-title"><span><TrendingUp size={13} aria-hidden /> Traffic sweep</span><small>max {LAB_LIMITS.maxLevels} levels</small></h3>
      <div className="fz-topic-filter" role="group" aria-label="Traffic levels">
        {[...new Set([...presetLevels(state.benchmark.rps), ...levels])].sort((a, b) => a - b).map(level => <button key={level} aria-pressed={levels.includes(level)} className={levels.includes(level) ? 'is-on' : ''} onClick={() => setLevels(current => current.includes(level) ? current.filter(entry => entry !== level) : [...current, level])}>{fmt(level, 0)}</button>)}
      </div>
      <div className="fz-labrow"><input type="number" placeholder="Add a level (req/s)" aria-label="Custom traffic level" value={custom} onChange={event => setCustom(event.target.value)} />
        <button className="fz-btn fz-btn--small" onClick={() => { const value = Math.round(Number(custom)); if (value > 0) { setLevels(current => [...new Set([...current, value])]); setCustom(''); } }}>Add</button></div>
      <p className="fz-brief__note">{plan.levels.length} levels · {plan.offeredRequests.toLocaleString()} offered requests (limit {LAB_LIMITS.maxSweepRequests.toLocaleString()}). Each level is a separate deterministic run with the benchmark’s seed.</p>
      {plan.errors.length > 0 && <ul className="fz-results__list is-errors">{plan.errors.map(error => <li key={error}>{error}</li>)}</ul>}
      <button className="fz-btn" disabled={running || plan.errors.length > 0 || benchmarkErrors.length > 0} onClick={() => { lab.runSweep(snapshot, labels, plan.levels); setTab('results'); }}><TrendingUp size={13} />Run traffic sweep</button>
    </>}

    {tab === 'results' && <>
      <div className="fz-labrow"><span>Compare baseline with</span>
        <select value={compareWith} onChange={event => setCompareWith(event.target.value)} aria-label="Run to compare with the baseline">
          <option value="latest">Latest experiment run</option>
          {state.variants.filter(variant => variant.run).map(variant => <option key={variant.id} value={variant.id}>Variant: {variant.name}</option>)}
        </select></div>
      {target ? <RunSummary run={target} status={compareWith !== 'latest' ? 'saved variant' : targetCurrent ? 'current design' : 'design changed since this run'} /> : <p className="fz-empty-note">Run an experiment to see results.</p>}
      {target && comparison && state.baseline && <><h3 className="fz-section-title"><span><GitCompareArrows size={13} aria-hidden /> Baseline vs {compareWith === 'latest' ? 'experiment' : 'variant'}</span></h3>
        <Comparison comparison={comparison} baseline={state.baseline} experiment={target} /></>}
      {target && !state.baseline && <><h3 className="fz-section-title">Explanations</h3><Insights insights={explainRun(target)} /></>}
      {target && state.baseline && <details className="fz-labdetails"><summary>Explanations of this run alone</summary><Insights insights={explainRun(target)} /></details>}

      <h3 className="fz-section-title"><span><TrendingUp size={13} aria-hidden /> Scaling curve</span>{state.sweep && <small>{when(state.sweep.at)}</small>}</h3>
      {!state.sweep || !sweepAnalysis ? <p className="fz-empty-note">Run a traffic sweep from the Experiment tab.</p> : <>
        {!same(state.sweep.architecture.nodes.map(node => [node.id, node.kind, node.config]), snapshot.nodes.map(node => [node.id, node.kind, node.config])) || !same(state.sweep.architecture.edges, snapshot.edges) ? <p className="fz-labmatch is-warn">The design has changed since this sweep ran.</p> : null}
        <div className="fz-alert is-ok"><span><b>Measured</b>{sweepAnalysis.measured.statement}{sweepAnalysis.measured.violated.length > 0 && <> Missed: {sweepAnalysis.measured.violated.join('; ')}.</>}</span></div>
        {sweepAnalysis.prediction && <div className="fz-alert is-warn"><span><b>Heuristic</b>{sweepAnalysis.prediction.statement}</span></div>}
        {sweepAnalysis.excluded.length > 0 && <p className="fz-brief__note">Not plotted: {sweepAnalysis.excluded.map(entry => `${fmt(entry.rps, 0)} req/s (${entry.status === 'cancelled' ? 'not run' : entry.status})`).join(', ')}.</p>}
        <Suspense fallback={<p className="fz-empty-note">Loading chart…</p>}><ScalingChart points={curveSeries(state.sweep.points)} theme={theme} p95Target={state.sweep.targets.p95Ms} firstFailingRps={sweepAnalysis.measured.firstFailingRps} /></Suspense>
        {sweepAnalysis.firstToSaturate.length > 0 && <p className="fz-brief__note"><b>First to reach 85% busy (measured):</b> {sweepAnalysis.firstToSaturate.map(entry => `${entry.label} at ${fmt(entry.rps, 0)} req/s (${pct(entry.utilization)})`).join(' · ')}</p>}
        <table className="fz-table fz-sweep__table">
          <thead><tr><th scope="col">Offered</th><th scope="col">Succeeded</th><th scope="col">p50 · p95 · p99 (ms)</th><th scope="col">Errors</th><th scope="col">Busiest component</th><th scope="col">Peak queue · wait</th><th scope="col">Targets</th></tr></thead>
          <tbody>{state.sweep.points.map(point => { const m = point.measurements; const top = m?.components.find(component => component.kind !== 'client'); const queue = m?.components.reduce((best, component) => component.maxQueueDepth > (best?.maxQueueDepth ?? -1) ? component : best, undefined as typeof top);
            return <tr key={point.rps} className={point.status === 'measured' ? '' : 'is-unavailable'}>
              <th scope="row">{fmt(point.rps, 0)} req/s</th>
              {point.status === 'measured' && m ? <>
                <td>{fmt(m.successThroughput)} req/s ({fmt(m.successPct, 1)}%)</td><td>{fmt(m.p50)} · {fmt(m.p95)} · {fmt(m.p99)}</td><td>{fmt(m.errorRatePct, 2)}%</td>
                <td>{top ? `${top.label} ${pct(top.utilization)}` : '—'}</td><td>{queue && queue.maxQueueDepth > 0 ? `${queue.label}: ${fmt(queue.maxQueueDepth, 0)} · ${fmt(queue.averageWaitMs)} ms` : '0'}</td>
                <td>{point.targetResults!.every(result => result.met === true) ? 'met' : 'missed'}</td>
              </> : <td colSpan={6}>{point.status === 'cancelled' ? 'Not run (sweep cancelled)' : point.status === 'incomplete' ? `Incomplete: hit the ${LAB_LIMITS.maxEventsPerRun.toLocaleString()}-event limit, not used` : `Failed: ${point.error}`}</td>}
            </tr>; })}</tbody>
        </table>
        <p className="fz-brief__note">Latency covers successful requests only, so p95 can fall at very high traffic when most requests are rejected. Read it together with the success rate.</p>
      </>}
    </>}

    {tab === 'variants' && <>
      <h3 className="fz-section-title">Save the current design</h3>
      <div className="fz-labrow"><input value={variantName} onChange={event => setVariantName(event.target.value)} placeholder="Variant name" aria-label="Variant name" maxLength={60} />
        <button className="fz-btn fz-btn--small fz-btn--primary" disabled={!variantName.trim()} onClick={() => { if (lab.saveAsVariant(variantName, snapshot)) setVariantName(''); }}><Save size={12} />Save variant</button></div>
      <p className="fz-brief__note">A variant stores the architecture, the benchmark and, if it matches exactly, the latest experiment run. Saved variants are never overwritten.</p>
      {!state.variants.length ? <p className="fz-empty-note">No saved variants.</p> : <ul className="fz-variants">{state.variants.map(variant => <li key={variant.id}>
        <div><b>{variant.name}</b><span>{when(variant.savedAt)} · {variant.architecture.nodes.length} components · {fmt(variant.benchmark.rps, 0)} req/s</span>
          <span>{variant.run ? `p95 ${fmt(variant.run.measurements.p95)} ms · ${fmt(variant.run.measurements.successThroughput)} req/s succeeded` : 'no run saved'}</span></div>
        <div className="fz-brief__actions">
          <button className="fz-btn fz-btn--small" onClick={() => requestLoad(variant.architecture, `variant “${variant.name}”`)}><Upload size={12} />Load as draft</button>
          {variant.run && state.baseline && <button className="fz-btn fz-btn--small" onClick={() => { setCompareWith(variant.id); setTab('results'); }}><GitCompareArrows size={12} />Compare</button>}
          <button className="fz-icon-btn is-danger" aria-label={`Delete variant ${variant.name}`} onClick={() => { if (window.confirm(`Delete variant “${variant.name}”? This cannot be undone.`)) { lab.deleteVariant(variant.id); if (compareWith === variant.id) setCompareWith('latest'); } }}><Trash2 size={13} /></button>
        </div>
      </li>)}</ul>}
    </>}

    {tab === 'guided' && <GuidedPanel learn={learn} snapshot={snapshot} labels={labels} focus={focus} onLoad={requestLoad} onSetBenchmark={lab.setBenchmark} onOpenLesson={onOpenLesson} />}

    {tab === 'learn' && <>
      <p className="fz-brief__note">Each hypothesis is concluded from your own baseline, experiment (the run selected in Results) and sweep. Any design that exercises the idea works. For guided, controlled comparisons with prepared variants, use the Guided tab.</p>
      {LESSONS.map(lesson => { const outcome = lesson.evaluate(lessonContext); return <details key={lesson.id} className="fz-lesson">
        <summary><b>{lesson.title}</b><span className={`fz-lesson__status is-${outcome.status}`}>{outcome.status === 'needs-data' ? 'needs data' : outcome.status === 'supports' ? 'your results support it' : outcome.status === 'does-not-support' ? 'your results do not support it' : 'inconclusive'}</span></summary>
        <h4>Hypothesis</h4><p>{lesson.hypothesis}</p>
        <h4>Experiment</h4><ol>{lesson.experiment.map(step => <li key={step}>{step}</li>)}</ol>
        <h4>Look for</h4><ul>{lesson.observe.map(item => <li key={item}>{item}</li>)}</ul>
        <h4>Conclusion from your results</h4><p>{outcome.summary}</p>
        {outcome.evidence.length > 0 && <ul className="fz-lesson__evidence">{outcome.evidence.map(item => <li key={item}>{item}</li>)}</ul>}
        {outcome.caveat && <p className="fz-brief__note">{outcome.caveat}</p>}
      </details>; })}
    </>}
  </div>;
}
