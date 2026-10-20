import { describe, expect, it } from 'vitest';
import { simulate } from '../simulation/engine';
import type { FlowEdge, FlowNode } from '../app/model';
import { validateArchitecture } from '../app/validation';
import {
  ARCHITECTURE_SCHEMA_VERSION, buildAttemptRecord, compareAttempts, historicalChallenge, parseAttemptRecord, reproductionInput, reproductionMatches,
  snapshotArchitecture, snapshotToDraft, type AttemptRecord,
} from './attempts';
import { challengeById, challenges, type Challenge } from './definitions';
import { grade } from './grading';
import { HISTORY_SIZE, emptyProgress, loadProgress, recordAttempt, saveDraft, saveProgress, type Progress } from './progress';
import { starterArchitecture, toArchitecture, withLocks } from './starter';
import { prepareSubmission } from './submission';

type Canvas = { nodes: FlowNode[]; edges: FlowEdge[] };
const slow = challengeById('slow-api')!;
const configure = (canvas: Canvas, id: string, patch: Record<string, string>): Canvas => ({ ...canvas, nodes: canvas.nodes.map(node => node.id === id ? { ...node, data: { ...node.data, config: { ...node.data.config, ...patch } } } : node) });
/** Submits a canvas exactly as the app does: snapshot at submit time, benchmark run, grade, record. */
function submit(challenge: Challenge, canvas: Canvas, number = 1, at = 1000): AttemptRecord {
  const snapshot = snapshotArchitecture(canvas.nodes, canvas.edges);
  const prepared = prepareSubmission(challenge, toArchitecture(canvas.nodes, canvas.edges), input => validateArchitecture(input), snapshot);
  const graded = grade(challenge, prepared.input, simulate(prepared.input), prepared.validation);
  return buildAttemptRecord(challenge, prepared.snapshot!, prepared.input, graded, number, at);
}
const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } }; };
const roundTrip = (record: AttemptRecord) => JSON.parse(JSON.stringify(record));

describe('architecture snapshots and attempt records', () => {
  it('captures ids, types, names, configurations, positions and connections as a frozen deep copy', () => {
    const canvas = starterArchitecture(slow);
    const snapshot = snapshotArchitecture(canvas.nodes, canvas.edges);
    expect(snapshot).toMatchObject({ schema: 'flowzen.architecture', version: ARCHITECTURE_SCHEMA_VERSION });
    expect(snapshot.nodes.map(node => [node.id, node.kind, node.label])).toEqual([['users', 'client', 'Mobile App'], ['api', 'server', 'Profile API']]);
    expect(snapshot.nodes[1].config.instances).toBe('2'); expect(snapshot.nodes[1].position).toEqual({ x: 300, y: 120 });
    expect(snapshot.edges).toEqual([{ source: 'users', target: 'api' }]);
    // Later edits to the live canvas objects cannot reach it.
    canvas.nodes[1].data.config.instances = '99'; canvas.nodes[1].position.x = 5; canvas.edges.pop();
    expect(snapshot.nodes[1].config.instances).toBe('2'); expect(snapshot.nodes[1].position.x).toBe(300); expect(snapshot.edges).toHaveLength(1);
    expect(Object.isFrozen(snapshot.nodes[1].config)).toBe(true);
  });

  it('stores the benchmark, seed, criteria definitions, measurements and verdict with each attempt', () => {
    const record = submit(slow, configure(starterArchitecture(slow), 'api', { instances: '14' }));
    expect(record.benchmark).toMatchObject({ rps: 300, durationMs: 11_000, trafficDurationMs: 10_000, seed: 101 });
    expect(record.benchmark.input.seed).toBe(101);
    expect(record.benchmark.input.nodes.find(node => node.id === 'api')!.config!.processingLatencyMs).toBe('40');
    expect(record.criteriaDefinitions.map(criterion => criterion.id)).toEqual(slow.criteria.map(criterion => criterion.id));
    expect(record.result.passed).toBe(true); expect(record.result.summary!.p95).toBeGreaterThan(0);
    expect(record.result.criteria.every(entry => typeof entry.threshold === 'number')).toBe(true);
    expect(Object.isFrozen(record) && Object.isFrozen(record.result.criteria[0]) && Object.isFrozen(record.benchmark.input.nodes[0])).toBe(true);
  });

  it('is unaffected by later changes to the challenge definition', () => {
    const changed: Challenge = structuredClone(slow);
    const record = submit(changed, configure(starterArchitecture(slow), 'api', { instances: '14' }));
    changed.criteria[0].threshold = 1; changed.workload.seed = 999; changed.title = 'Renamed';
    expect(record.criteriaDefinitions[0].threshold).toBe(100); expect(record.benchmark.seed).toBe(101); expect(record.challengeTitle).toBe('The Slow API');
  });
});

describe('attempt history retention and immutability', () => {
  it('keeps at most 20 attempts with records, numbered consistently, and never edits a recorded one', () => {
    const canvas = starterArchitecture(slow); const base = submit(slow, canvas);
    let progress: Progress = emptyProgress();
    const graded = grade(slow, base.benchmark.input, simulate(base.benchmark.input), validateArchitecture(base.benchmark.input));
    progress = recordAttempt(progress, graded, 1, number => buildAttemptRecord(slow, base.architecture, base.benchmark.input, graded, number, 1));
    const first = JSON.stringify(progress.challenges['slow-api'].history![0]);
    progress = saveDraft(progress, 'slow-api', { nodes: [], edges: [] });
    for (let at = 2; at <= 25; at += 1) progress = recordAttempt(progress, graded, at, number => buildAttemptRecord(slow, base.architecture, base.benchmark.input, graded, number, at));
    const history = progress.challenges['slow-api'].history!;
    expect(history).toHaveLength(HISTORY_SIZE);
    expect(history.map(entry => entry.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 6));
    for (const entry of history) { const parsed = parseAttemptRecord(entry.record); expect(parsed.status).toBe('ok'); if (parsed.status === 'ok') expect(parsed.record.number).toBe(entry.number); }
    // The first attempt was dropped by retention, but while it was retained it never changed.
    expect(JSON.parse(first).number).toBe(1);
    expect(() => { (history[0].record as AttemptRecord).architecture.nodes[0].label = 'edited'; }).toThrow();
  });

  it('survives storage round trips frozen, and loads legacy attempts without records as summary-only', () => {
    const storage = memory(); const record = submit(slow, starterArchitecture(slow));
    const graded = grade(slow, record.benchmark.input, simulate(record.benchmark.input), validateArchitecture(record.benchmark.input));
    let progress = recordAttempt(emptyProgress(), graded, 1); // legacy: no record
    progress = recordAttempt(progress, graded, 2, () => record);
    saveProgress(progress, storage);
    const loaded = loadProgress(storage).challenges['slow-api'].history!;
    expect(parseAttemptRecord(loaded[0].record)).toEqual({ status: 'missing' });
    const parsed = parseAttemptRecord(loaded[1].record);
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') { expect(parsed.record).toEqual(roundTrip(record)); expect(Object.isFrozen(parsed.record.architecture.nodes[0])).toBe(true); }
  });
});

describe('snapshot schema versioning', () => {
  const valid = () => roundTrip(submit(slow, starterArchitecture(slow)));
  it('accepts the current versions', () => { expect(parseAttemptRecord(valid()).status).toBe('ok'); });
  it('reports newer or unknown versions as unsupported instead of guessing', () => {
    expect(parseAttemptRecord({ ...valid(), version: 2 })).toMatchObject({ status: 'unsupported', version: 2 });
    const record = valid(); record.architecture.version = 7;
    expect(parseAttemptRecord(record)).toMatchObject({ status: 'unsupported', version: 7 });
  });
  it('reports damaged data as invalid and never substitutes anything for it', () => {
    const cases: Array<[string, (record: ReturnType<typeof valid>) => unknown]> = [
      ['not an object', () => 'oops'],
      ['wrong schema', record => ({ ...record, schema: 'other' })],
      ['missing architecture', record => ({ ...record, architecture: undefined })],
      ['unknown component type', record => { record.architecture.nodes[0].kind = 'mainframe'; return record; }],
      ['malformed config', record => { record.architecture.nodes[0].config = { instances: 5 }; return record; }],
      ['duplicate ids', record => { record.architecture.nodes[1].id = record.architecture.nodes[0].id; return record; }],
      ['dangling connection', record => { record.architecture.edges.push({ source: 'users', target: 'ghost' }); return record; }],
      ['missing benchmark', record => ({ ...record, benchmark: undefined })],
      ['malformed criterion', record => { record.result.criteria[0].measured = 'fast'; return record; }],
    ];
    for (const [name, damage] of cases) {
      const parsed = parseAttemptRecord(damage(valid()));
      expect(parsed.status, name).toBe('invalid');
      expect('record' in parsed, name).toBe(false);
    }
    expect(parseAttemptRecord(undefined)).toEqual({ status: 'missing' });
  });
});

describe('loading a snapshot as a new draft', () => {
  it('returns an independent editable copy and leaves the record untouched', () => {
    const record = submit(slow, configure(starterArchitecture(slow), 'api', { instances: '14' }));
    const before = JSON.stringify(record);
    const draft = snapshotToDraft(record.architecture);
    draft.nodes[1].config.instances = '3'; draft.nodes[1].label = 'Edited'; draft.edges.length = 0;
    expect(JSON.stringify(record)).toBe(before);
    // Converting back to canvas nodes (as the app does) reproduces the submitted architecture exactly.
    const fresh = snapshotToDraft(record.architecture);
    const nodes = fresh.nodes.map(entry => withLocks(slow, { id: entry.id, type: 'architecture' as const, position: entry.position, data: { label: entry.label, kind: entry.kind, config: entry.config } }));
    const edges = fresh.edges.map(edge => ({ id: `${edge.source}-${edge.target}`, source: edge.source, target: edge.target }));
    expect(snapshotArchitecture(nodes, edges)).toEqual(record.architecture);
  });
});

describe('reproducing an attempt', () => {
  it('re-runs the original benchmark and seed and matches every recorded measurement', () => {
    for (const challenge of challenges.slice(0, 3)) {
      const record = submit(challenge, starterArchitecture(challenge));
      const input = reproductionInput(record); const replay = historicalChallenge(record, challenge);
      const regraded = grade(replay, input, simulate(input), validateArchitecture(input));
      expect(reproductionMatches(record, regraded.criteria, regraded.summary), challenge.id).toEqual({ identical: true, differences: [] });
    }
  });
  it('uses the recorded criteria and workload even if the challenge has changed since', () => {
    const record = submit(slow, configure(starterArchitecture(slow), 'api', { instances: '14' }));
    const changed: Challenge = { ...structuredClone(slow), criteria: slow.criteria.map(criterion => ({ ...criterion, threshold: 0 })), workload: { ...slow.workload, rps: 5, seed: 1 } };
    const replay = historicalChallenge(record, changed); const input = reproductionInput(record);
    expect(input.offeredRps).toBe(300); expect(input.seed).toBe(101);
    const regraded = grade(replay, input, simulate(input), validateArchitecture(input));
    expect(regraded.passed).toBe(true); expect(reproductionMatches(record, regraded.criteria, regraded.summary).identical).toBe(true);
  });
  it('reports differences instead of hiding them', () => {
    const record = submit(slow, starterArchitecture(slow));
    const other = submit(slow, configure(starterArchitecture(slow), 'api', { instances: '14' }));
    const check = reproductionMatches(record, other.result.criteria, other.result.summary);
    expect(check.identical).toBe(false); expect(check.differences.join(' ')).toMatch(/p95/);
  });
});

describe('comparing attempts', () => {
  const starter = () => starterArchitecture(slow);
  it('attributes measured differences to a change only when it is the single simulation input that changed', () => {
    const a = submit(slow, starter(), 1, 1); const b = submit(slow, configure(starter(), 'api', { instances: '14' }), 2, 2);
    const comparison = compareAttempts(a, b);
    expect(comparison.attribution).toMatchObject({ kind: 'single-change', change: 'Profile API · Instances: 2 → 14' });
    expect(comparison.structural.components).toEqual([expect.objectContaining({ type: 'changed', id: 'api', config: [expect.objectContaining({ key: 'instances', before: '2', after: '14', simulated: true, affectsSimulation: true })] })]);
    const p95 = comparison.measured.metrics.find(entry => entry.key === 'p95')!;
    expect(p95.b! < p95.a!).toBe(true); expect(p95.delta).toBeCloseTo(p95.b! - p95.a!, 2);
    expect(comparison.measured.criteria.find(entry => entry.id === 'p95')).toMatchObject({ statusChanged: true, a: { status: 'fail' }, b: { status: 'pass' } });
    expect(comparison.measured.utilization.map(entry => entry.key)).toEqual(['api']);
  });

  it('refuses to attribute when several simulation inputs changed', () => {
    const a = submit(slow, starter(), 1, 1);
    const canvas = configure(configure(starter(), 'api', { instances: '7' }), 'api', { queueLimit: '100' });
    const extra = withLocks(slow, { id: 'api-2', type: 'architecture', position: { x: 600, y: 120 }, data: { label: 'Profile API 2', kind: 'server', config: { ...canvas.nodes[1].data.config } } });
    const b = submit(slow, { nodes: [...canvas.nodes, extra], edges: canvas.edges }, 2, 2);
    const comparison = compareAttempts(a, b);
    expect(comparison.attribution.kind).toBe('multiple-changes');
    expect(comparison.simulationChanges.length).toBe((comparison.attribution as { count: number }).count);
    expect(comparison.attribution.message).toMatch(/cannot tell which change/);
  });

  it('treats names, positions, descriptive fields and edits overridden by locks as non-simulation changes', () => {
    const a = submit(slow, starter(), 1, 1);
    const cosmetic = configure(starter(), 'api', { runtime: 'Go 1.23', processingLatencyMs: '1' }); // descriptive field + a locked value
    cosmetic.nodes = cosmetic.nodes.map(node => node.id === 'api' ? { ...node, position: { x: 999, y: 9 }, data: { ...node.data, label: 'Renamed API' } } : node);
    const comparison = compareAttempts(a, submit(slow, cosmetic, 2, 2));
    expect(comparison.attribution.kind).toBe('identical-inputs');
    const change = comparison.structural.components[0];
    expect(change).toMatchObject({ type: 'changed', renamed: { before: 'Profile API', after: 'Renamed API' }, moved: true });
    expect(comparison.measured.metrics.every(entry => entry.delta === 0)).toBe(true);
    expect((change as { config: Array<{ key: string; simulated: boolean; affectsSimulation: boolean }> }).config).toEqual([
      expect.objectContaining({ key: 'processingLatencyMs', simulated: true, affectsSimulation: false }),
      expect.objectContaining({ key: 'runtime', simulated: false, affectsSimulation: false }),
    ]);
  });

  it('flags different benchmarks as not comparable', () => {
    const a = submit(slow, starter(), 1, 1);
    const harder: Challenge = { ...structuredClone(slow), workload: { ...structuredClone(slow.workload), seed: 7 } };
    const comparison = compareAttempts(a, submit(harder, configure(starter(), 'api', { instances: '14' }), 2, 2));
    expect(comparison.attribution).toMatchObject({ kind: 'benchmarks-differ', details: ['seed 101 vs 7'] });
  });

  it('is deterministic and leaves both source attempts unchanged', () => {
    const a = submit(slow, starter(), 1, 1); const b = submit(slow, configure(starter(), 'api', { instances: '14' }), 2, 2);
    const before = [JSON.stringify(a), JSON.stringify(b)];
    expect(JSON.stringify(compareAttempts(a, b))).toBe(JSON.stringify(compareAttempts(roundTrip(a), roundTrip(b))));
    expect([JSON.stringify(a), JSON.stringify(b)]).toEqual(before);
  });
});
