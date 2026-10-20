import type { SimulationInput } from '../simulation/engine';
import { deepFreeze } from '../challenges/grading';
import { SIMULATOR_REVISION, diffSnapshots, simulationInputChanges, type ArchitectureSnapshot, type ComponentChange } from '../challenges/attempts';
import { LAB_LIMITS, SWEEP_MULTIPLIERS, labInput, type LabBenchmark, type LabMeasurements, type LabTargets } from './measure';

export * from './measure';

/**
 * Scaling Laboratory core: benchmarks, measurements, immutable run records, traffic sweeps and comparisons.
 *
 * Everything here is pure and DOM-free so it runs in the simulation worker and in tests. Measurements are
 * read from engine output only. Anything estimated (as opposed to simulated) is labelled `heuristic`.
 */

// ── Targets ────────────────────────────────────────────────────────────────────
export type TargetResult = { id: 'p95' | 'errors' | 'success'; label: string; met: boolean | null; measured: number | null; target: number; unit: string; reason?: string };
/** Checks the configured performance targets. `met: null` means the value could not be measured (never counted as met). */
export function evaluateTargets(measurements: LabMeasurements, targets: LabTargets): TargetResult[] {
  const incomplete = measurements.complete ? undefined : 'The run hit the event limit, so it is incomplete.';
  const result = (id: TargetResult['id'], label: string, measured: number | null, target: number, unit: string, ok: (value: number) => boolean, missing?: string): TargetResult =>
    incomplete ? { id, label, met: null, measured: null, target, unit, reason: incomplete } : measured === null ? { id, label, met: null, measured, target, unit, reason: missing } : { id, label, met: ok(measured), measured, target, unit };
  return [
    result('p95', `p95 latency ≤ ${targets.p95Ms} ms`, measurements.p95, targets.p95Ms, 'ms', value => value <= targets.p95Ms, 'No request succeeded, so latency was not measured.'),
    result('errors', `Error rate ≤ ${targets.maxErrorRatePct}%`, measurements.errorRatePct, targets.maxErrorRatePct, '%', value => value <= targets.maxErrorRatePct),
    result('success', `≥ ${targets.minSuccessPct}% of offered requests succeed`, measurements.offeredRequests ? measurements.successPct : null, targets.minSuccessPct, '%', value => value >= targets.minSuccessPct, 'No traffic was offered.'),
  ];
}
export const meetsTargets = (results: TargetResult[]) => results.every(result => result.met === true);

// ── Immutable records ──────────────────────────────────────────────────────────
export const LAB_RECORD_VERSION = 1;
export type LabRun = {
  schema: 'flowzen.lab-run'; version: 1; id: string; at: number; label: string; simulatorRevision: number;
  architecture: ArchitectureSnapshot; benchmark: LabBenchmark; input: SimulationInput;
  measurements: LabMeasurements; targets: LabTargets; targetResults: TargetResult[];
};
export function makeRun(params: { id: string; at: number; label: string; architecture: ArchitectureSnapshot; benchmark: LabBenchmark; targets: LabTargets; measurements: LabMeasurements }): LabRun {
  const { architecture, benchmark, targets, measurements } = params;
  return deepFreeze(structuredClone({
    schema: 'flowzen.lab-run' as const, version: 1 as const, id: params.id, at: params.at, label: params.label, simulatorRevision: SIMULATOR_REVISION,
    architecture, benchmark, input: labInput(architecture, benchmark), measurements, targets, targetResults: evaluateTargets(measurements, targets),
  }));
}

// ── Traffic sweeps ─────────────────────────────────────────────────────────────
export type SweepPlan = { levels: number[]; errors: string[]; offeredRequests: number };
/** Validates and bounds a sweep. Levels are sorted and de-duplicated; nothing is clipped silently. */
export function planSweep(benchmark: LabBenchmark, levels: number[]): SweepPlan {
  const unique = [...new Set(levels.map(level => Math.round(level)))].sort((a, b) => a - b);
  const errors: string[] = [];
  if (unique.length < 2) errors.push('Choose at least two traffic levels.');
  if (unique.length > LAB_LIMITS.maxLevels) errors.push(`A sweep can have at most ${LAB_LIMITS.maxLevels} levels.`);
  const outside = unique.filter(level => level < LAB_LIMITS.minRps || level > LAB_LIMITS.maxRps);
  if (outside.length) errors.push(`Levels must be from ${LAB_LIMITS.minRps} to ${LAB_LIMITS.maxRps.toLocaleString()} req/s (got ${outside.join(', ')}).`);
  const offeredRequests = unique.reduce((sum, level) => sum + Math.floor(level * benchmark.durationMs / 1000), 0);
  if (offeredRequests > LAB_LIMITS.maxSweepRequests) errors.push(`This sweep would offer ${offeredRequests.toLocaleString()} requests; the limit is ${LAB_LIMITS.maxSweepRequests.toLocaleString()}. Use fewer or lower levels, or a shorter traffic window.`);
  return { levels: unique, errors, offeredRequests };
}
export const presetLevels = (rps: number, multipliers: readonly number[] = SWEEP_MULTIPLIERS) => [...new Set(multipliers.map(multiplier => Math.max(LAB_LIMITS.minRps, Math.round(rps * multiplier))))].filter(level => level <= LAB_LIMITS.maxRps);

export type SweepPoint = {
  rps: number;
  /** measured: complete run; incomplete: hit the event limit; cancelled: not run because the sweep was cancelled; failed: engine error. */
  status: 'measured' | 'incomplete' | 'cancelled' | 'failed';
  measurements: LabMeasurements | null; targetResults: TargetResult[] | null; error?: string;
};
export type Sweep = {
  schema: 'flowzen.lab-sweep'; version: 1; id: string; at: number; simulatorRevision: number;
  architecture: ArchitectureSnapshot; benchmark: LabBenchmark; targets: LabTargets; points: SweepPoint[];
};
export const sweepPoint = (rps: number, measurements: LabMeasurements, targets: LabTargets): SweepPoint =>
  ({ rps, status: measurements.complete ? 'measured' : 'incomplete', measurements, targetResults: evaluateTargets(measurements, targets) });
export const cancelledPoint = (rps: number): SweepPoint => ({ rps, status: 'cancelled', measurements: null, targetResults: null });
export const failedPoint = (rps: number, error: string): SweepPoint => ({ rps, status: 'failed', measurements: null, targetResults: null, error });
export function makeSweep(params: { id: string; at: number; architecture: ArchitectureSnapshot; benchmark: LabBenchmark; targets: LabTargets; points: SweepPoint[] }): Sweep {
  return deepFreeze(structuredClone({ schema: 'flowzen.lab-sweep' as const, version: 1 as const, simulatorRevision: SIMULATOR_REVISION, ...params }));
}

/**
 * Runs a sweep level by level with an injected simulator (the worker in the app, the engine directly in tests).
 * `shouldCancel` is checked before each level; levels not run are recorded as cancelled, never estimated.
 */
export function runSweepSync(architecture: ArchitectureSnapshot, benchmark: LabBenchmark, plan: SweepPlan, targets: LabTargets, run: (input: SimulationInput) => LabMeasurements, shouldCancel: () => boolean = () => false): SweepPoint[] {
  if (plan.errors.length) throw new Error(plan.errors.join(' '));
  const points: SweepPoint[] = [];
  for (const rps of plan.levels) {
    if (shouldCancel()) { points.push(cancelledPoint(rps)); continue; }
    try { points.push(sweepPoint(rps, run(labInput(architecture, benchmark, rps)), targets)); } catch (error) { points.push(failedPoint(rps, error instanceof Error ? error.message : String(error))); }
  }
  return points;
}

/** Chart data: one point per completely simulated level. Cancelled, failed or incomplete levels are left out, not interpolated. */
export function curveSeries(points: SweepPoint[]) {
  return points.filter(point => point.status === 'measured' && point.measurements).sort((a, b) => a.rps - b.rps).map(point => ({
    rps: point.rps, successThroughput: point.measurements!.successThroughput, p50: point.measurements!.p50, p95: point.measurements!.p95, p99: point.measurements!.p99,
    errorRatePct: point.measurements!.errorRatePct, meetsTargets: meetsTargets(point.targetResults!),
  }));
}

export type SweepAnalysis = {
  /** From simulated levels only. */
  measured: { lastPassingRps: number | null; firstFailingRps: number | null; violated: string[]; statement: string };
  /** Heuristic, labelled as such; present only when no simulated level violated a target. */
  prediction: { componentId: string; label: string; atRps: number; utilization: number; estimatedSaturationRps: number; statement: string } | null;
  /** Per component, the lowest simulated level at which it was ≥ 85% busy. */
  firstToSaturate: Array<{ id: string; label: string; rps: number; utilization: number }>;
  excluded: Array<{ rps: number; status: SweepPoint['status'] }>;
};
export function analyzeSweep(points: SweepPoint[]): SweepAnalysis {
  const measured = points.filter(point => point.status === 'measured' && point.measurements && point.targetResults).sort((a, b) => a.rps - b.rps);
  const excluded = points.filter(point => point.status !== 'measured').map(point => ({ rps: point.rps, status: point.status }));
  let lastPassingRps: number | null = null; let firstFailing: SweepPoint | null = null;
  for (const point of measured) { if (meetsTargets(point.targetResults!)) { if (!firstFailing) lastPassingRps = point.rps; } else if (!firstFailing) firstFailing = point; }
  const violated = firstFailing ? firstFailing.targetResults!.filter(result => result.met !== true).map(result => result.met === null ? `${result.label} (not measurable)` : `${result.label} (measured ${Math.round(result.measured! * 100) / 100}${result.unit === '%' ? '%' : ` ${result.unit}`})`) : [];
  const statement = !measured.length ? 'No traffic level was simulated completely, so there is no measurement to report.'
    : firstFailing ? `Targets were met up to ${lastPassingRps === null ? 'none of the simulated levels' : `${lastPassingRps.toLocaleString()} req/s`} and first violated at ${firstFailing.rps.toLocaleString()} req/s (simulated).`
      : `Every simulated level, up to ${measured[measured.length - 1].rps.toLocaleString()} req/s, met the targets. Higher traffic was not simulated.`;

  let prediction: SweepAnalysis['prediction'] = null;
  const top = measured[measured.length - 1];
  const busiest = top?.measurements!.components.find(component => component.kind !== 'client');
  if (!firstFailing && top && busiest && busiest.utilization > 0 && busiest.utilization < 1) {
    const estimate = Math.round(top.rps / busiest.utilization);
    prediction = { componentId: busiest.id, label: busiest.label, atRps: top.rps, utilization: busiest.utilization, estimatedSaturationRps: estimate,
      statement: `Heuristic estimate, not simulated: ${busiest.label} was ${Math.round(busiest.utilization * 1000) / 10}% busy at ${top.rps.toLocaleString()} req/s. If its utilization grew in proportion to traffic, it would be fully busy near ${estimate.toLocaleString()} req/s. Queueing usually degrades latency before that point. Simulate that level to measure it.` };
  }
  const firstAt = new Map<string, { id: string; label: string; rps: number; utilization: number }>();
  for (const point of measured) for (const component of point.measurements!.components) if (component.utilization >= 0.85 && !firstAt.has(component.id)) firstAt.set(component.id, { id: component.id, label: component.label, rps: point.rps, utilization: component.utilization });
  return { measured: { lastPassingRps, firstFailingRps: firstFailing?.rps ?? null, violated, statement }, prediction, firstToSaturate: [...firstAt.values()].sort((a, b) => a.rps - b.rps || b.utilization - a.utilization), excluded };
}

// ── Comparing runs ─────────────────────────────────────────────────────────────
export type MetricChange = { key: string; label: string; unit: string; a: number | null; b: number | null; delta: number | null; lowerIsBetter: boolean; verdict: 'improved' | 'regressed' | 'unchanged' | 'n/a' };
export type RunComparison = {
  /** False when benchmarks or simulator revisions differ: values are shown, but not as equivalent measurements. */
  comparable: boolean; benchmarkDifferences: string[];
  structural: { components: ComponentChange[]; connectionsAdded: string[]; connectionsRemoved: string[] };
  simulationChanges: string[];
  attribution: { kind: 'not-comparable' | 'identical-inputs' | 'single-change' | 'multiple-changes'; message: string };
  metrics: MetricChange[];
  components: Array<{ id: string; label: string; utilization: [number | null, number | null]; maxQueue: [number | null, number | null]; averageWaitMs: [number | null, number | null] }>;
  targets: Array<{ id: string; label: string; a: boolean | null; b: boolean | null }>;
  improvements: string[]; regressions: string[];
  newFailureModes: string[]; resolvedFailureModes: string[];
  bottleneck: {
    before: { id: string; label: string; utilization: number } | null; after: { id: string; label: string; utilization: number } | null; shifted: boolean;
    /** How busy the experiment's busiest component already was in the baseline (to avoid overstating a shift between near-equals). */
    afterInBaseline: number | null;
  };
};

export function benchmarkDifferences(a: LabBenchmark, b: LabBenchmark, revisionA: number, revisionB: number): string[] {
  const details: string[] = [];
  if (a.rps !== b.rps) details.push(`offered traffic ${a.rps.toLocaleString()} vs ${b.rps.toLocaleString()} req/s`);
  if (a.durationMs !== b.durationMs) details.push(`traffic window ${a.durationMs / 1000} vs ${b.durationMs / 1000} s`);
  if (a.drainMs !== b.drainMs) details.push(`drain window ${a.drainMs / 1000} vs ${b.drainMs / 1000} s`);
  if (a.seed !== b.seed) details.push(`seed ${a.seed} vs ${b.seed}`);
  const faults = (benchmark: LabBenchmark) => JSON.stringify([...benchmark.faults].map(fault => [fault.nodeId, fault.startMs, fault.endMs]).sort());
  if (faults(a) !== faults(b)) details.push('injected failures');
  if (revisionA !== revisionB) details.push(`simulator revision ${revisionA} vs ${revisionB}`);
  return details;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const failureKey = (failure: LabMeasurements['failures'][number]) => `${failure.kind} at ${failure.label}`;

/** Baseline (a) vs experiment (b). Deterministic; both records are only read. */
export function compareRuns(a: LabRun, b: LabRun): RunComparison {
  const labels = new Map([...a.architecture.nodes, ...b.architecture.nodes].map(node => [node.id, node.label || node.id]));
  const labelOf = (id: string) => labels.get(id) ?? id;
  const benchmarkDiffs = benchmarkDifferences(a.benchmark, b.benchmark, a.simulatorRevision, b.simulatorRevision);
  const comparable = benchmarkDiffs.length === 0;
  const simulationChanges = simulationInputChanges(a.input, b.input, labelOf);
  const attribution: RunComparison['attribution'] = !comparable
    ? { kind: 'not-comparable', message: `The runs used different benchmarks (${benchmarkDiffs.join(', ')}). Their numbers are shown side by side but are not equivalent measurements, and no design change can be credited for a difference.` }
    : simulationChanges.length === 0 ? { kind: 'identical-inputs', message: 'Both runs had identical simulation inputs, so any difference is cosmetic.' }
      : simulationChanges.length === 1 ? { kind: 'single-change', message: `The benchmark was identical and exactly one simulation input changed (${simulationChanges[0]}). The simulator is deterministic, so the measured differences follow from that change, under this benchmark.` }
        : { kind: 'multiple-changes', message: `${simulationChanges.length} simulation inputs changed. The measured differences are real, but this comparison cannot tell which change, or combination, caused them.` };

  const ma = a.measurements; const mb = b.measurements;
  const metric = (key: keyof Pick<LabMeasurements, 'p50' | 'p95' | 'p99' | 'successThroughput' | 'successPct' | 'errorRatePct'>, label: string, unit: string, lowerIsBetter: boolean): MetricChange => {
    const va = ma[key]; const vb = mb[key]; const delta = va === null || vb === null ? null : round(vb - va);
    const verdict = delta === null ? 'n/a' : Math.abs(delta) < 1e-9 ? 'unchanged' : (lowerIsBetter ? delta < 0 : delta > 0) ? 'improved' : 'regressed';
    return { key, label, unit, a: va, b: vb, delta, lowerIsBetter, verdict };
  };
  const metrics = [metric('p50', 'Latency p50', 'ms', true), metric('p95', 'Latency p95', 'ms', true), metric('p99', 'Latency p99', 'ms', true),
    metric('successThroughput', 'Successful throughput', 'req/s', false), metric('successPct', 'Offered requests that succeeded', '%', false), metric('errorRatePct', 'Error rate', '%', true)];

  const byIdA = new Map(ma.components.map(component => [component.id, component])); const byIdB = new Map(mb.components.map(component => [component.id, component]));
  const components = [...new Set([...byIdA.keys(), ...byIdB.keys()])].sort().map(id => {
    const ca = byIdA.get(id); const cb = byIdB.get(id);
    return { id, label: labelOf(id), utilization: [ca?.utilization ?? null, cb?.utilization ?? null] as [number | null, number | null], maxQueue: [ca?.maxQueueDepth ?? null, cb?.maxQueueDepth ?? null] as [number | null, number | null], averageWaitMs: [ca?.averageWaitMs ?? null, cb?.averageWaitMs ?? null] as [number | null, number | null] };
  });
  const targets = a.targetResults.map(result => ({ id: result.id, label: result.label, a: result.met, b: b.targetResults.find(entry => entry.id === result.id)?.met ?? null }));

  const improvements: string[] = []; const regressions: string[] = [];
  for (const entry of metrics) if (entry.verdict === 'improved' || entry.verdict === 'regressed') (entry.verdict === 'improved' ? improvements : regressions).push(`${entry.label}: ${round(entry.a!)} → ${round(entry.b!)} ${entry.unit}`);
  for (const target of targets) if (target.a !== target.b) (target.b === true ? improvements : regressions).push(`${target.label}: ${target.a === true ? 'met' : target.a === false ? 'missed' : 'not measurable'} → ${target.b === true ? 'met' : target.b === false ? 'missed' : 'not measurable'}`);
  const failuresA = new Map(ma.failures.map(failure => [failureKey(failure), failure])); const failuresB = new Map(mb.failures.map(failure => [failureKey(failure), failure]));
  const newFailureModes = [...failuresB].filter(([key]) => !failuresA.has(key)).map(([key, failure]) => `${failure.count.toLocaleString()} requests ${key}`).sort();
  const resolvedFailureModes = [...failuresA].filter(([key]) => !failuresB.has(key)).map(([key, failure]) => `${key} (${failure.count.toLocaleString()} before)`).sort();

  const busiest = (measurements: LabMeasurements) => { const top = measurements.components.find(component => component.kind !== 'client'); return top ? { id: top.id, label: top.label, utilization: top.utilization } : null; };
  const before = busiest(ma); const after = busiest(mb);
  return {
    comparable, benchmarkDifferences: benchmarkDiffs, structural: diffSnapshots(a.architecture, b.architecture, a.input, b.input, labelOf), simulationChanges, attribution,
    metrics, components, targets, improvements, regressions, newFailureModes, resolvedFailureModes,
    bottleneck: { before, after, shifted: Boolean(before && after && before.id !== after.id), afterInBaseline: after ? ma.components.find(component => component.id === after.id)?.utilization ?? null : null },
  };
}

// ── Explanations ───────────────────────────────────────────────────────────────
export type Insight = { topic: 'capacity' | 'time' | 'queues' | 'cache' | 'replicas' | 'database' | 'shift' | 'jobs'; title: string; evidence: string[]; basis: 'measured' | 'heuristic' };
const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
const ms = (value: number) => `${Math.round(value * 10) / 10} ms`;

/** Explanations of one run, each citing the measurements it rests on. */
export function explainRun(run: LabRun): Insight[] {
  const m = run.measurements; const insights: Insight[] = [];
  if (!m.complete) return [{ topic: 'capacity', basis: 'measured', title: 'The run is incomplete', evidence: [`the engine stopped at its limit of ${LAB_LIMITS.maxEventsPerRun.toLocaleString()} events before the run ended; no conclusion is drawn from partial data`] }];
  const busy = m.components.filter(component => component.kind !== 'client').slice(0, 3);
  if (busy.length) insights.push({ topic: 'capacity', basis: 'measured', title: `Closest to capacity: ${busy[0].label} (${pct(busy[0].utilization)} busy)`, evidence: busy.map(component => `${component.label}: ${pct(component.utilization)} of ${component.capacity} slot${component.capacity === 1 ? '' : 's'} busy, ${component.requestsProcessed.toLocaleString()} requests processed`) });
  const total = m.timeShare.reduce((sum, entry) => sum + entry.waitMs + entry.processingMs, 0);
  if (m.completedRequests && total > 0) {
    const top = m.timeShare[0];
    insights.push({ topic: 'time', basis: 'measured', title: `Most of a successful request’s time is spent at ${top.label}`, evidence: m.timeShare.slice(0, 4).map(entry => `${entry.label}: ${ms(entry.waitMs)} waiting + ${ms(entry.processingMs)} processing per successful request (${pct((entry.waitMs + entry.processingMs) / total)} of the total)`) });
  }
  const queued = m.components.filter(component => component.maxQueueDepth > 0).sort((a, b) => b.maxQueueDepth - a.maxQueueDepth).slice(0, 3);
  insights.push(queued.length
    ? { topic: 'queues', basis: 'measured', title: `Requests queued at ${queued.map(component => component.label).join(', ')}`, evidence: queued.map(component => `${component.label}: backlog peaked at ${component.maxQueueDepth.toLocaleString()}, average wait ${ms(component.averageWaitMs)}, ${component.rejected.toLocaleString()} rejected or timed out`) }
    : { topic: 'queues', basis: 'measured', title: 'No queue formed', evidence: ['every component had a peak backlog of 0'] });
  for (const cache of m.cache) {
    const behind = run.input.edges.find(edge => edge.source === cache.id)?.target;
    const reached = behind ? m.components.find(component => component.id === behind)?.requestsProcessed ?? 0 : null;
    insights.push({ topic: 'cache', basis: 'measured', title: cache.lookups ? `${cache.label} served ${pct(cache.hits / cache.lookups)} of its lookups` : `${cache.label} received no requests`,
      evidence: [`${cache.lookups.toLocaleString()} lookups, ${cache.hits.toLocaleString()} hits`, ...(behind && reached !== null ? [`${reached.toLocaleString()} of ${m.simulatedRequests.toLocaleString()} requests reached ${labels(run)[behind] ?? behind}`] : [])] });
  }
  if (m.jobs.total) insights.push({ topic: 'jobs', basis: 'measured', title: m.jobs.pending ? `${m.jobs.pending.toLocaleString()} background jobs were still waiting when the run ended` : 'Every background job finished within the run', evidence: [`${m.jobs.total.toLocaleString()} jobs: ${m.jobs.completed.toLocaleString()} completed, ${m.jobs.failed.toLocaleString()} failed, ${m.jobs.pending.toLocaleString()} pending, ${m.jobs.deadLettered.toLocaleString()} dead-lettered`] });
  for (const finding of m.findings.filter(entry => entry.kind === 'failures' || entry.kind === 'saturation').slice(0, 2)) insights.push({ topic: 'capacity', basis: 'heuristic', title: finding.title, evidence: finding.evidence });
  return insights;
}
const labels = (run: LabRun) => Object.fromEntries(run.architecture.nodes.map(node => [node.id, node.label || node.id]));

/** Explanations of a baseline → experiment comparison. Causal wording only when the comparison supports it. */
export function explainComparison(a: LabRun, b: LabRun, comparison = compareRuns(a, b)): Insight[] {
  const insights: Insight[] = [];
  const causal = comparison.attribution.kind === 'single-change';
  /** What the comparison can say about cause, phrased for whether this metric actually changed. */
  const qualifier = (changed: boolean) => causal
    ? (changed ? 'This was the only simulation input that changed, so the difference follows from it under this benchmark.' : 'This was the only simulation input that changed, and it had no measurable effect on this under this benchmark.')
    : comparison.attribution.kind === 'multiple-changes' ? `Observed alongside ${comparison.simulationChanges.length} input changes; this comparison cannot attribute ${changed ? 'it' : 'the lack of change'} to one of them.`
      : comparison.attribution.kind === 'not-comparable' ? 'The benchmarks differ, so this is not a like-for-like measurement.' : '';
  const basis: Insight['basis'] = causal ? 'measured' : 'heuristic';
  if (!a.measurements.complete || !b.measurements.complete) return [{ topic: 'capacity', basis: 'measured', title: 'A run is incomplete', evidence: ['at least one run hit the engine’s event limit, so the comparison draws no conclusions'] }];

  if (a.measurements.computeSlots !== b.measurements.computeSlots) {
    const throughput = comparison.metrics.find(entry => entry.key === 'successThroughput')!;
    const p95 = comparison.metrics.find(entry => entry.key === 'p95')!;
    insights.push({ topic: 'replicas', basis, title: `Compute slots ${a.measurements.computeSlots} → ${b.measurements.computeSlots}: successful throughput ${throughput.verdict === 'unchanged' ? 'did not change' : throughput.verdict === 'improved' ? 'rose' : 'fell'}`,
      evidence: [`successful throughput ${round(throughput.a ?? 0)} → ${round(throughput.b ?? 0)} req/s (offered ${a.benchmark.rps.toLocaleString()} → ${b.benchmark.rps.toLocaleString()} req/s)`, `p95 ${p95.a ?? '—'} → ${p95.b ?? '—'} ms`, ...[qualifier(throughput.verdict !== 'unchanged' || p95.verdict !== 'unchanged')].filter(Boolean)] });
  }
  const databases = new Set([...a.input.nodes, ...b.input.nodes].filter(node => node.kind === 'database' || node.kind === 'nosql').map(node => node.id));
  for (const id of databases) {
    const ra = a.measurements.components.find(component => component.id === id); const rb = b.measurements.components.find(component => component.id === id);
    if (!ra || !rb) continue;
    const name = labels(b)[id] ?? id;
    insights.push({ topic: 'database', basis, title: `${name}: ${ra.requestsProcessed.toLocaleString()} → ${rb.requestsProcessed.toLocaleString()} requests, ${pct(ra.utilization)} → ${pct(rb.utilization)} busy`,
      evidence: [`requests reaching ${name}: ${pct(ra.requestsProcessed / Math.max(1, a.measurements.simulatedRequests))} → ${pct(rb.requestsProcessed / Math.max(1, b.measurements.simulatedRequests))} of all requests`, `peak backlog ${ra.maxQueueDepth} → ${rb.maxQueueDepth}`, ...(b.measurements.cache.length && !a.measurements.cache.length ? ['the experiment adds a cache'] : []),
        ...[qualifier(ra.requestsProcessed !== rb.requestsProcessed || Math.abs(ra.utilization - rb.utilization) > 0.005)].filter(Boolean)] });
  }
  const { before, after, shifted, afterInBaseline } = comparison.bottleneck;
  // Within 2 points in the baseline, the "new" busiest component was already a co-bottleneck: say so instead of claiming a shift.
  const nearTie = shifted && afterInBaseline !== null && before !== null && before.utilization - afterInBaseline < 0.02;
  if (before && after) insights.push({ topic: 'shift', basis: 'measured',
    title: !shifted ? `${after.label} remains the busiest component` : nearTie ? `${after.label}, already about as busy as ${before.label} in the baseline, is now the busiest component` : `The busiest component moved from ${before.label} to ${after.label}`,
    evidence: [`baseline: ${before.label} ${pct(before.utilization)} busy${shifted && afterInBaseline !== null ? `, ${after.label} ${pct(afterInBaseline)}` : ''}`, `experiment: ${after.label} ${pct(after.utilization)} busy`, ...(shifted ? [`${before.label} in the experiment: ${pct(comparison.components.find(entry => entry.id === before.id)?.utilization[1] ?? 0)} busy`] : [])] });
  if (comparison.newFailureModes.length) insights.push({ topic: 'capacity', basis: 'measured', title: 'New failure modes in the experiment', evidence: comparison.newFailureModes });
  return insights;
}
