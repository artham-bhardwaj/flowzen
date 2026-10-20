import { describe, expect, it } from 'vitest';
import { simulate, type SimulationInput } from '../simulation/engine';
import { place, type FlowEdge, type FlowNode } from '../app/model';
import { snapshotArchitecture, snapshotToDraft, type ArchitectureSnapshot } from '../challenges/attempts';
import {
  DEFAULT_TARGETS, LAB_LIMITS, analyzeSweep, compareRuns, curveSeries, explainComparison, explainRun, labInput, makeRun, makeSweep, measure, planSweep, runSweepSync,
  validateBenchmark, type LabBenchmark, type LabRun,
} from './lab';
import { LESSONS, type LessonContext } from './lessons';
import { LAB_STORAGE_KEY, MAX_VARIANTS, deleteVariant, emptyLab, loadLab, recordExperiment, recordSweep, saveLab, saveVariant, setBaseline, setDraft } from './store';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const BENCH: LabBenchmark = { rps: 300, durationMs: 4000, drainMs: 1000, seed: 7, faults: [] };
const with_ = (node: FlowNode, config: Record<string, string>): FlowNode => ({ ...node, data: { ...node.data, config: { ...node.data.config, ...config } } });
const wire = (pairs: Array<[string, string]>): FlowEdge[] => pairs.map(([source, target]) => ({ id: `${source}-${target}`, source, target }));
const snap = (nodes: FlowNode[], edges: FlowEdge[]) => snapshotArchitecture(nodes, edges);
/** Client → LB → two servers → database; capacities set per test. */
function webTier({ instances = '4', dbConnections = '4', queryMs = '20' } = {}): ArchitectureSnapshot {
  return snap([
    place('client', 'client', 'Users', 0, 0), place('lb', 'loadBalancer', 'LB', 280, 0),
    with_(place('app-a', 'server', 'App A', 560, -100), { instances }), with_(place('app-b', 'server', 'App B', 560, 100), { instances }),
    with_(place('db', 'database', 'Orders DB', 840, 0), { concurrency: dbConnections, queryLatencyMs: queryMs }),
  ], wire([['client', 'lb'], ['lb', 'app-a'], ['lb', 'app-b'], ['app-a', 'db'], ['app-b', 'db']]));
}
function cached(kind: 'cache' | 'distributedCache', options = {}): ArchitectureSnapshot {
  const base = webTier(options);
  return snap([...base.nodes.map(node => place(node.id, node.kind, node.label, node.position.x, node.position.y)).map((node, i) => with_(node, base.nodes[i].config)), place('cache', kind, 'Cache', 700, 0)],
    wire([['client', 'lb'], ['lb', 'app-a'], ['lb', 'app-b'], ['app-a', 'cache'], ['app-b', 'cache'], ['cache', 'db']]));
}
function queued(workerSlots: string, rate: string): ArchitectureSnapshot {
  return snap([place('client', 'client', 'Uploads', 0, 0), with_(place('api', 'server', 'API', 280, 0), { instances: '8' }), place('queue', 'queue', 'Jobs', 560, 0), with_(place('worker', 'worker', 'Resizer', 840, 0), { concurrency: workerSlots, processingRate: rate })],
    wire([['client', 'api'], ['api', 'queue'], ['queue', 'worker']]));
}
const labelsOf = (architecture: ArchitectureSnapshot) => Object.fromEntries(architecture.nodes.map(node => [node.id, node.label]));
const simulateLevel = (architecture: ArchitectureSnapshot) => (input: SimulationInput) => measure(simulate(input), input, labelsOf(architecture));
let counter = 0;
function runOf(architecture: ArchitectureSnapshot, benchmark = BENCH, targets = DEFAULT_TARGETS): LabRun {
  const input = labInput(architecture, benchmark);
  return makeRun({ id: `run-${++counter}`, at: counter, label: 'run', architecture, benchmark, targets, measurements: measure(simulate(input), input, labelsOf(architecture)) });
}
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };

// ── Measurements ──────────────────────────────────────────────────────────────
describe('lab measurements', () => {
  it('report exactly what the engine measured, separating offered from successful traffic', () => {
    const architecture = webTier(); const input = labInput(architecture, BENCH); const result = simulate(input);
    const m = measure(result, input, labelsOf(architecture));
    expect(m).toMatchObject({ complete: true, offeredRps: 300, offeredRequests: result.offeredRequests, completedRequests: result.completedRequests, failedRequests: result.failedRequests, successThroughput: result.successfulThroughput, p50: result.latency.p50, p95: result.latency.p95, p99: result.latency.p99 });
    expect(m.successPct).toBeCloseTo(result.completedRequests / result.offeredRequests * 100, 9);
    expect(m.successPct).toBeLessThan(100); // the database caps successful throughput below offered traffic
    for (const component of m.components) {
      const engine = result.components.find(entry => entry.id === component.id)!;
      expect(component.runUtilization).toBe(engine.utilization);
      expect(component.utilization).toBeGreaterThanOrEqual(0); expect(component.utilization).toBeLessThanOrEqual(1);
    }
    const db = m.components.find(component => component.id === 'db')!;
    const spans = [...result.requests, ...result.jobs].flatMap(record => record.processing).filter(span => span.component === 'db');
    const busy = spans.reduce((sum, span) => sum + Math.max(0, Math.min(span.end, BENCH.durationMs) - Math.max(span.start, 0)), 0);
    expect(db.utilization).toBeCloseTo(busy / (db.capacity * BENCH.durationMs), 9);
    expect(db.utilization).toBeGreaterThan(db.runUtilization); // the drain window dilutes the whole-run figure
    expect(m.failures.reduce((sum, failure) => sum + failure.count, 0)).toBe(result.failedRequests);
    // Time breakdown from traces adds up to the mean end-to-end latency of successful requests.
    const successes = result.requests.filter(request => request.status === 'completed');
    const meanLatency = successes.reduce((sum, request) => sum + request.latency!, 0) / successes.length;
    expect(m.timeShare.reduce((sum, entry) => sum + entry.waitMs + entry.processingMs, 0)).toBeCloseTo(meanLatency, 6);
  });

  it('validates benchmarks and refuses out-of-range settings', () => {
    expect(validateBenchmark(BENCH)).toEqual([]);
    expect(validateBenchmark({ ...BENCH, rps: LAB_LIMITS.maxRps + 1 })).toHaveLength(1);
    expect(validateBenchmark({ ...BENCH, durationMs: 120_000, seed: -1 })).toHaveLength(2);
    expect(validateBenchmark({ ...BENCH, faults: [{ nodeId: 'ghost', startMs: 0, endMs: 1000 }] }, new Set(['db']))).toHaveLength(1);
    expect(validateBenchmark({ ...BENCH, faults: [{ nodeId: 'db', startMs: 3000, endMs: 9000 }] }, new Set(['db']))).toHaveLength(1);
  });

  it('models injected dependency failures through the engine’s scheduled outages', () => {
    const architecture = webTier({ dbConnections: '40' });
    const healthy = runOf(architecture); const outage = runOf(architecture, { ...BENCH, faults: [{ nodeId: 'db', startMs: 1000, endMs: 2000 }] });
    expect(outage.measurements.failures.find(failure => failure.kind === 'unavailable')?.componentId).toBe('db');
    expect(outage.measurements.errorRatePct).toBeGreaterThan(healthy.measurements.errorRatePct);
  });
});

// ── Traffic sweeps ────────────────────────────────────────────────────────────
describe('traffic sweeps', () => {
  it('bounds sweep size before running anything', () => {
    expect(planSweep(BENCH, [100]).errors).toHaveLength(1);
    expect(planSweep(BENCH, [1, 2, 3, 4, 5, 6, 7, 8, 9]).errors.join()).toMatch(/at most 8/);
    expect(planSweep(BENCH, [100, 9000]).errors.join()).toMatch(/Levels must be/);
    expect(planSweep({ ...BENCH, durationMs: 30_000 }, [5000, 4000, 3000, 2000]).errors.join()).toMatch(/limit is 400,000/);
    expect(planSweep(BENCH, [400, 100, 100.2, 200]).levels).toEqual([100, 200, 400]);
    expect(() => runSweepSync(webTier(), BENCH, planSweep(BENCH, [100]), DEFAULT_TARGETS, simulateLevel(webTier()))).toThrow();
  });

  it('is deterministic and reports exactly the planned levels', () => {
    const architecture = webTier(); const plan = planSweep(BENCH, [50, 150, 300, 600]);
    const first = runSweepSync(architecture, BENCH, plan, DEFAULT_TARGETS, simulateLevel(architecture));
    const second = runSweepSync(architecture, BENCH, plan, DEFAULT_TARGETS, simulateLevel(architecture));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.map(point => point.rps)).toEqual([50, 150, 300, 600]);
    expect(first.every(point => point.status === 'measured' && point.measurements!.offeredRps === point.rps)).toBe(true);
  });

  it('records cancelled levels as not run and never interpolates them', () => {
    const architecture = webTier(); let ran = 0;
    const points = runSweepSync(architecture, BENCH, planSweep(BENCH, [50, 100, 200, 400]), DEFAULT_TARGETS, input => { ran += 1; return simulateLevel(architecture)(input); }, () => ran >= 2);
    expect(points.map(point => point.status)).toEqual(['measured', 'measured', 'cancelled', 'cancelled']);
    expect(points.slice(2).every(point => point.measurements === null && point.targetResults === null)).toBe(true);
    const series = curveSeries(points);
    expect(series.map(point => point.rps)).toEqual([50, 100]); // only simulated levels are plotted
    expect(analyzeSweep(points).excluded).toEqual([{ rps: 200, status: 'cancelled' }, { rps: 400, status: 'cancelled' }]);
  });

  it('marks runs that hit the event limit as incomplete and excludes them from conclusions', () => {
    const architecture = webTier();
    const points = runSweepSync(architecture, BENCH, planSweep(BENCH, [100, 200]), DEFAULT_TARGETS, input => simulateLevel(architecture)({ ...input, maxEvents: 300 }));
    expect(points.map(point => point.status)).toEqual(['incomplete', 'incomplete']);
    expect(points[0].targetResults!.every(result => result.met === null)).toBe(true);
    const analysis = analyzeSweep(points);
    expect(analysis.measured).toMatchObject({ lastPassingRps: null, firstFailingRps: null }); expect(analysis.measured.statement).toMatch(/No traffic level was simulated completely/);
    expect(analysis.prediction).toBeNull(); expect(curveSeries(points)).toEqual([]);
  });

  it('reports the measured breaking point separately from a heuristic saturation estimate', () => {
    const dbBound = webTier({ dbConnections: '4' }); // ≈ 200 queries/s
    const points = runSweepSync(dbBound, BENCH, planSweep(BENCH, [50, 100, 150, 300]), DEFAULT_TARGETS, simulateLevel(dbBound));
    const analysis = analyzeSweep(points);
    expect(analysis.measured.firstFailingRps).toBe(300); expect(analysis.measured.lastPassingRps).toBe(150);
    expect(analysis.measured.violated.join(' ')).toMatch(/measured/);
    expect(analysis.prediction).toBeNull(); // a measured violation exists, so no prediction is offered
    expect(analysis.firstToSaturate[0].id).toBe('db');

    const roomy = webTier({ dbConnections: '40', instances: '8' });
    const passing = runSweepSync(roomy, BENCH, planSweep(BENCH, [50, 100]), DEFAULT_TARGETS, simulateLevel(roomy));
    const estimate = analyzeSweep(passing);
    expect(estimate.measured.firstFailingRps).toBeNull();
    const top = passing[1].measurements!.components.find(component => component.kind !== 'client')!;
    expect(estimate.prediction).toMatchObject({ componentId: top.id, atRps: 100, estimatedSaturationRps: Math.round(100 / top.utilization) });
    expect(estimate.prediction!.statement).toMatch(/^Heuristic estimate, not simulated/);
  });

  it('freezes sweep records', () => {
    const architecture = webTier(); const plan = planSweep(BENCH, [50, 100]);
    const sweep = makeSweep({ id: 's', at: 1, architecture, benchmark: BENCH, targets: DEFAULT_TARGETS, points: runSweepSync(architecture, BENCH, plan, DEFAULT_TARGETS, simulateLevel(architecture)) });
    expect(Object.isFrozen(sweep.points[0].measurements)).toBe(true);
  });
});

// ── Comparisons and explanations ──────────────────────────────────────────────
describe('baseline vs experiment', () => {
  it('compares identical benchmarks like for like and attributes a single change', () => {
    const baseline = runOf(webTier({ dbConnections: '40', instances: '1' })); const experiment = runOf(webTier({ dbConnections: '40', instances: '4' }));
    const comparison = compareRuns(baseline, experiment);
    expect(comparison.comparable).toBe(true); expect(comparison.attribution.kind).toBe('multiple-changes'); // instances changed on two servers
    const single = compareRuns(runOf(webTier({ dbConnections: '4' })), runOf(webTier({ dbConnections: '12' })));
    expect(single.attribution).toMatchObject({ kind: 'single-change' }); expect(single.attribution.message).toMatch(/Orders DB · Connections: 4 → 12/);
    expect(single.metrics.find(entry => entry.key === 'successThroughput')!.verdict).toBe('improved');
    expect(single.improvements.length).toBeGreaterThan(0);
  });

  it('warns instead of comparing as equivalent when workloads or simulator revisions differ', () => {
    const architecture = webTier();
    const traffic = compareRuns(runOf(architecture), runOf(architecture, { ...BENCH, rps: 600 }));
    expect(traffic.comparable).toBe(false); expect(traffic.attribution.kind).toBe('not-comparable'); expect(traffic.benchmarkDifferences).toEqual(['offered traffic 300 vs 600 req/s']);
    expect(compareRuns(runOf(architecture), runOf(architecture, { ...BENCH, seed: 8 })).benchmarkDifferences).toEqual(['seed 7 vs 8']);
    const old = { ...structuredClone(runOf(architecture)), simulatorRevision: 0 };
    expect(compareRuns(old, runOf(architecture)).benchmarkDifferences).toEqual(['simulator revision 0 vs 1']);
    const faults = compareRuns(runOf(architecture), runOf(architecture, { ...BENCH, faults: [{ nodeId: 'db', startMs: 0, endMs: 500 }] }));
    expect(faults.benchmarkDifferences).toEqual(['injected failures']);
  });

  it('reports new failure modes and bottleneck shifts from measurements', () => {
    const architecture = webTier({ dbConnections: '40' });
    const outage = compareRuns(runOf(architecture), runOf(architecture, { ...BENCH, faults: [{ nodeId: 'db', startMs: 1000, endMs: 2000 }] }));
    expect(outage.newFailureModes.join()).toMatch(/unavailable at Orders DB/);
    const shift = compareRuns(runOf(webTier({ instances: '2', dbConnections: '6' }), { ...BENCH, rps: 250 }), runOf(webTier({ instances: '8', dbConnections: '6' }), { ...BENCH, rps: 250 }));
    expect(shift.bottleneck.before!.id).toMatch(/app-/); expect(shift.bottleneck.after!.id).toBe('db'); expect(shift.bottleneck.shifted).toBe(true);
  });

  it('cites the measurements behind every explanation and marks causal claims carefully', () => {
    const run = runOf(cached('cache'));
    const insights = explainRun(run);
    const capacity = insights.find(insight => insight.topic === 'capacity' && insight.basis === 'measured')!;
    const top = run.measurements.components[0];
    expect(capacity.title).toContain(`${Math.round(top.utilization * 1000) / 10}%`);
    const cache = insights.find(insight => insight.topic === 'cache')!;
    const measured = run.measurements.cache[0];
    expect(cache.evidence[0]).toBe(`${measured.lookups.toLocaleString()} lookups, ${measured.hits.toLocaleString()} hits`);
    expect(insights.every(insight => insight.evidence.length > 0)).toBe(true);
    // Several changes: explanations are not presented as measured causes.
    const several = explainComparison(runOf(webTier({ instances: '1', dbConnections: '4' })), runOf(webTier({ instances: '6', dbConnections: '8' })));
    const replicas = several.find(insight => insight.topic === 'replicas')!;
    expect(replicas.basis).toBe('heuristic'); expect(replicas.evidence.join(' ')).toMatch(/cannot attribute/);
    const incomplete = makeRun({ ...structuredClone(run), id: 'x', measurements: { ...structuredClone(run.measurements), complete: false } });
    expect(explainRun(incomplete)).toHaveLength(1);
  });
});

// ── Persistence and isolation ─────────────────────────────────────────────────
describe('lab persistence and isolation', () => {
  it('never changes the baseline when the experiment, sweeps or variants change', () => {
    const architecture = webTier(); const baseline = runOf(architecture);
    let state = setBaseline(emptyLab(), baseline); const before = JSON.stringify(state.baseline);
    const edited = snapshotToDraft(architecture); edited.nodes[2].config.instances = '20';
    state = setDraft(state, snap(edited.nodes.map(node => with_(place(node.id, node.kind, node.label, node.position.x, node.position.y), node.config)), wire(edited.edges.map(edge => [edge.source, edge.target]))));
    state = recordExperiment(state, runOf(state.draft!));
    state = recordSweep(state, makeSweep({ id: 's', at: 1, architecture: state.draft!, benchmark: BENCH, targets: DEFAULT_TARGETS, points: [] }));
    state = saveVariant(state, { id: 'v1', name: 'More instances', savedAt: 2, architecture: state.draft!, benchmark: BENCH, run: state.experiment }).state;
    expect(JSON.stringify(state.baseline)).toBe(before);
    expect(state.baseline!.architecture.nodes[2].config.instances).toBe('4');
    expect(() => { (state.baseline!.architecture.nodes[2].config as Record<string, string>).instances = '99'; }).toThrow();
    expect(edited.nodes[2].config.instances).toBe('20'); // the editable copy is independent
  });

  it('persists variants, rejects duplicates and over-limit saves, and never overwrites one', () => {
    const storage = memory(); const architecture = webTier(); const run = runOf(architecture);
    let state = setBaseline(emptyLab(), run);
    state = saveVariant(state, { id: 'v1', name: 'Bigger DB', savedAt: 1, architecture, benchmark: BENCH, run }).state;
    const duplicate = saveVariant(state, { id: 'v2', name: ' bigger db ', savedAt: 2, architecture, benchmark: BENCH, run: null });
    expect(duplicate.error).toMatch(/already exists/); expect(duplicate.state).toBe(state);
    expect(saveLab(state, storage)).toBe(true);
    const { state: loaded, dropped } = loadLab(storage);
    expect(dropped).toEqual([]); expect(loaded.variants[0]).toEqual(JSON.parse(JSON.stringify(state.variants[0])));
    expect(Object.isFrozen(loaded.variants[0].architecture)).toBe(true); expect(loaded.baseline!.id).toBe(run.id);
    let full = emptyLab();
    for (let i = 0; i < MAX_VARIANTS; i += 1) full = saveVariant(full, { id: `v${i}`, name: `V${i}`, savedAt: i, architecture, benchmark: BENCH, run: null }).state;
    expect(saveVariant(full, { id: 'extra', name: 'Extra', savedAt: 99, architecture, benchmark: BENCH, run: null }).error).toMatch(/up to 20/);
    expect(deleteVariant(full, 'v3').variants).toHaveLength(MAX_VARIANTS - 1); expect(full.variants).toHaveLength(MAX_VARIANTS);
  });

  it('drops unusable records individually and reports them instead of substituting anything', () => {
    const storage = memory(); const architecture = webTier(); const run = runOf(architecture);
    let state = setBaseline(emptyLab(), run);
    state = saveVariant(state, { id: 'good', name: 'Good', savedAt: 1, architecture, benchmark: BENCH, run: null }).state;
    const raw = JSON.parse(JSON.stringify(state));
    raw.variants.push({ ...raw.variants[0], id: 'bad', name: 'Broken', architecture: { ...raw.variants[0].architecture, version: 9 } });
    raw.experiment = { ...raw.baseline, version: 2 };
    storage.setItem(LAB_STORAGE_KEY, JSON.stringify(raw));
    const { state: loaded, dropped } = loadLab(storage);
    expect(loaded.variants.map(variant => variant.name)).toEqual(['Good']); expect(loaded.experiment).toBeNull(); expect(loaded.baseline).not.toBeNull();
    expect(dropped.join(' | ')).toMatch(/variant “Broken”/); expect(dropped.join(' | ')).toMatch(/latest experiment: unsupported version 2/);
    storage.setItem(LAB_STORAGE_KEY, '{oops'); expect(loadLab(storage).state).toEqual(emptyLab());
  });
});

// ── Lessons ───────────────────────────────────────────────────────────────────
describe('guided lessons conclude from the user’s actual runs', () => {
  const lesson = (id: string) => LESSONS.find(entry => entry.id === id)!;
  const pairOf = (a: ArchitectureSnapshot, b: ArchitectureSnapshot, benchmark = BENCH): LessonContext => ({ baseline: runOf(a, benchmark), experiment: runOf(b, benchmark), sweep: null });

  it('asks for data instead of guessing', () => {
    for (const entry of LESSONS) expect(entry.evaluate({ baseline: null, experiment: null, sweep: null }).status).toBe('needs-data');
    const mismatched = { baseline: runOf(webTier()), experiment: runOf(webTier(), { ...BENCH, rps: 500 }), sweep: null };
    expect(lesson('servers-vs-database').evaluate(mismatched).status).toBe('inconclusive');
  });

  it('servers vs database: supported by a database-bound design, not by a compute-bound one', () => {
    const outcome = lesson('servers-vs-database').evaluate(pairOf(webTier({ instances: '4', dbConnections: '4' }), webTier({ instances: '12', dbConnections: '4' })));
    expect(outcome.status).toBe('supports'); expect(outcome.evidence.join(' ')).toMatch(/compute slots 8 → 24/);
    expect(outcome.caveat).toMatch(/2 simulation inputs changed/);
    expect(lesson('servers-vs-database').evaluate(pairOf(webTier({ instances: '2', dbConnections: '40' }), webTier({ instances: '6', dbConnections: '40' }))).status).toBe('inconclusive');
  });

  it('caching: works with a Cache or a Distributed Cache', () => {
    for (const kind of ['cache', 'distributedCache'] as const) {
      const outcome = lesson('caching').evaluate(pairOf(webTier(), cached(kind)));
      expect(outcome.status, kind).toBe('supports'); expect(outcome.evidence.join(' ')).toMatch(/requests reaching Orders DB/);
    }
  });

  it('queues: distinguishes an absorbed backlog from one that does not drain', () => {
    const slow = lesson('queues-backlog').evaluate({ baseline: null, experiment: runOf(queued('2', '20'), { ...BENCH, rps: 100 }), sweep: null });
    expect(slow.status).toBe('supports'); expect(slow.summary).toMatch(/still waiting when the run ended/);
    const fast = lesson('queues-backlog').evaluate({ baseline: null, experiment: runOf(queued('20', '100'), { ...BENCH, rps: 100 }), sweep: null });
    expect(fast.status).toBe('inconclusive');
  });

  it('traffic degrades: uses only simulated sweep levels', () => {
    const architecture = webTier({ dbConnections: '4' });
    const points = runSweepSync(architecture, BENCH, planSweep(BENCH, [50, 150, 300]), DEFAULT_TARGETS, simulateLevel(architecture));
    const outcome = lesson('traffic-degrades').evaluate({ baseline: null, experiment: null, sweep: makeSweep({ id: 's', at: 1, architecture, benchmark: BENCH, targets: DEFAULT_TARGETS, points }) });
    expect(outcome.status).toBe('supports'); expect(outcome.summary).toMatch(/failed at 300 req\/s/);
  });

  it('bottleneck shift: relieving compute exposes the database', () => {
    const outcome = lesson('bottleneck-shift').evaluate(pairOf(webTier({ instances: '2', dbConnections: '6' }), webTier({ instances: '8', dbConnections: '6' }), { ...BENCH, rps: 250 }));
    expect(outcome.status).toBe('supports'); expect(outcome.summary).toMatch(/made Orders DB the busiest component/);
  });
});

describe('structural experiment edits', () => {
  it('adds a replica behind the same router with the same downstream, and refuses when nothing would route to it', async () => {
    const { addReplica, canAddReplica, insertCacheBefore } = await import('./edits');
    const { sampleNodes, sampleEdges } = await import('../app/model');
    const nodes = sampleNodes(); const edges = sampleEdges();
    const next = addReplica(nodes, edges, 'app-a', 'app-c')!;
    expect(next.nodes.find(node => node.id === 'app-c')!.data.config).toEqual(nodes.find(node => node.id === 'app-a')!.data.config);
    expect(next.edges.filter(edge => edge.source === 'app-c' || edge.target === 'app-c').map(edge => `${edge.source}->${edge.target}`).sort()).toEqual(['app-c->cache', 'lb->app-c']);
    expect(nodes).toHaveLength(9); // inputs untouched
    expect(canAddReplica(nodes, edges, 'worker')).toBe(false); expect(addReplica(nodes, edges, 'cache', 'x')).toBeNull();
    // More replicas behind the load balancer raise compute slots in the simulated input.
    const before = runOf(snap(nodes, edges)); const after = runOf(snap(next.nodes, next.edges));
    expect(after.measurements.computeSlots).toBeGreaterThan(before.measurements.computeSlots);
    // Insert a cache in front of a database: every caller now goes through it.
    const base = webTier();
    const flow = base.nodes.map(node => with_(place(node.id, node.kind, node.label, node.position.x, node.position.y), node.config));
    const withCache = insertCacheBefore(flow, wire(base.edges.map(edge => [edge.source, edge.target])), 'db', 'c1')!;
    expect(withCache.edges.filter(edge => edge.target === 'db').map(edge => edge.source)).toEqual(['c1']);
    expect(withCache.edges.filter(edge => edge.target === 'c1').map(edge => edge.source).sort()).toEqual(['app-a', 'app-b']);
    expect(insertCacheBefore(withCache.nodes, withCache.edges, 'db', 'c2')).toBeNull();
  });
});

describe('careful wording in explanations', () => {
  it('says a single change had no measurable effect when nothing changed, and does not overstate a shift between near-equals', () => {
    // One input changes that does not touch the database (load balancer concurrency at low traffic).
    const base = webTier({ instances: '8', dbConnections: '40' });
    const lbChanged = snap(base.nodes.map(node => with_(place(node.id, node.kind, node.label, node.position.x, node.position.y), node.id === 'lb' ? { ...node.config, concurrency: '4' } : node.config)), wire(base.edges.map(edge => [edge.source, edge.target])));
    const a = runOf(base, { ...BENCH, rps: 100 }); const b = runOf(lbChanged, { ...BENCH, rps: 100 });
    expect(compareRuns(a, b).attribution.kind).toBe('single-change');
    const insight = explainComparison(a, b).find(entry => entry.topic === 'database')!;
    // The database's load did not change, so the single change is reported as having no measurable effect on it.
    expect(insight.evidence.join(' ')).toMatch(/had no measurable effect on this/);
    expect(insight.evidence.join(' ')).not.toMatch(/difference follows from it/);
    // Two equally loaded servers: relieving one makes the other "busiest", which must not be presented as a new bottleneck.
    const equal = webTier({ instances: '2', dbConnections: '40' });
    const relieved = snap(equal.nodes.map(node => with_(place(node.id, node.kind, node.label, node.position.x, node.position.y), node.id === 'app-a' ? { ...node.config, instances: '6' } : node.config)), wire(equal.edges.map(edge => [edge.source, edge.target])));
    const comparison = compareRuns(runOf(equal, { ...BENCH, rps: 120 }), runOf(relieved, { ...BENCH, rps: 120 }));
    const shift = explainComparison(runOf(equal, { ...BENCH, rps: 120 }), runOf(relieved, { ...BENCH, rps: 120 }), comparison).find(entry => entry.topic === 'shift')!;
    expect(comparison.bottleneck.shifted).toBe(true);
    expect(shift.title).toMatch(/already about as busy/);
  });
});
