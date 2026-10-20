import { byKind, type Kind } from '../app/catalog';
import type { FlowEdge, FlowNode } from '../app/model';
import type { Issue } from '../app/validation';
import type { Fault, SimulationInput } from '../simulation/engine';
import type { Challenge, Criterion, Workload } from './definitions';
import { deepFreeze, type CriterionResult, type Finding, type Grade, type PerformanceSummary } from './grading';

/**
 * Historical attempt records.
 *
 * Every submission stores a self-contained, immutable record: the architecture exactly as submitted, the
 * benchmark that was simulated (workload, seed, faults and the per-node settings after locks), the criteria
 * definitions it was graded against, and the grade. Nothing in a record refers to the live canvas or to the
 * current challenge definition, so later edits, Undo/Redo, new submissions or changed challenges cannot alter it.
 *
 * Two schema versions are tracked separately:
 * - `ARCHITECTURE_SCHEMA_VERSION` for the architecture snapshot;
 * - `ATTEMPT_SCHEMA_VERSION` for the record around it.
 * Readers accept versions they know (migrating older ones) and report anything else as unsupported or invalid.
 * They never substitute the current architecture for a missing or unreadable snapshot.
 */
export const ARCHITECTURE_SCHEMA_VERSION = 1;
export const ATTEMPT_SCHEMA_VERSION = 1;
/**
 * Bump when the engine's behavior changes in a way that alters results for the same input. Reproductions of
 * records made with another revision are labelled as possibly different.
 */
export const SIMULATOR_REVISION = 1;

export type SnapshotNode = { id: string; kind: Kind; label: string; config: Record<string, string>; position: { x: number; y: number }; fixture?: boolean };
export type ArchitectureSnapshot = { schema: 'flowzen.architecture'; version: 1; nodes: SnapshotNode[]; edges: Array<{ source: string; target: string }> };

/** The exact benchmark that was simulated: workload description plus the engine input after locks were applied. */
export type BenchmarkRecord = {
  rps: number; durationMs: number; trafficDurationMs?: number; seed: number; pattern: string;
  faults: Array<Fault & { description?: string }>;
  overrides: Workload['overrides'];
  /** Engine input exactly as run (node configs include locked settings). */
  input: SimulationInput;
};
export type AttemptRecord = {
  schema: 'flowzen.attempt'; version: 1;
  challengeId: string; challengeTitle: string; number: number; at: number; simulatorRevision: number;
  architecture: ArchitectureSnapshot; benchmark: BenchmarkRecord;
  /** Criteria definitions as they were when graded (thresholds, metrics, advice). */
  criteriaDefinitions: Criterion[];
  fixtures: Challenge['fixtures'];
  result: {
    passed: boolean; invalidReason: string | null;
    /** Measured by the simulator for this benchmark run. */
    criteria: CriterionResult[]; summary: PerformanceSummary | null;
    /** Heuristic explanations derived from those measurements at grading time. */
    findings: Finding[]; mainBottleneck: Finding | null;
    validation: { counts: Record<'functional' | 'warning' | 'dead', number>; issues: Issue[] };
  };
};

export type ParsedAttempt =
  | { status: 'ok'; record: AttemptRecord }
  | { status: 'missing' }
  | { status: 'unsupported'; version: unknown; reason: string }
  | { status: 'invalid'; reason: string };

/** Captures the canvas as submitted. A deep copy: nothing in it is shared with live editor state. */
export function snapshotArchitecture(nodes: FlowNode[], edges: FlowEdge[]): ArchitectureSnapshot {
  return deepFreeze(structuredClone({
    schema: 'flowzen.architecture' as const, version: 1 as const,
    nodes: nodes.map(node => ({ id: node.id, kind: node.data.kind, label: node.data.label, config: { ...node.data.config }, position: { x: node.position.x, y: node.position.y }, ...(node.data.fixture ? { fixture: true } : {}) })),
    edges: edges.map(edge => ({ source: edge.source, target: edge.target })),
  }));
}

/** Builds the immutable record for a graded submission. */
export function buildAttemptRecord(challenge: Challenge, architecture: ArchitectureSnapshot, input: SimulationInput, grade: Grade, number: number, at: number): AttemptRecord {
  const { workload } = challenge;
  return deepFreeze(structuredClone({
    schema: 'flowzen.attempt' as const, version: 1 as const,
    challengeId: challenge.id, challengeTitle: challenge.title, number, at, simulatorRevision: SIMULATOR_REVISION,
    architecture,
    benchmark: { rps: workload.rps, durationMs: workload.durationMs, trafficDurationMs: workload.trafficDurationMs, seed: workload.seed, pattern: workload.pattern, faults: workload.faults, overrides: workload.overrides, input },
    criteriaDefinitions: challenge.criteria, fixtures: challenge.fixtures,
    result: { passed: grade.passed, invalidReason: grade.invalidReason, criteria: grade.criteria, summary: grade.summary, findings: grade.findings, mainBottleneck: grade.mainBottleneck, validation: grade.validation },
  }));
}

// ── Reading stored records ─────────────────────────────────────────────────────
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Returns why a value is not a valid architecture snapshot, or null when it is. */
export function validateArchitectureSnapshot(value: unknown): string | null {
  if (!isObject(value)) return 'The architecture snapshot is missing.';
  if (value.schema !== 'flowzen.architecture') return 'The architecture snapshot has an unknown format.';
  if (value.version !== ARCHITECTURE_SCHEMA_VERSION) return `Architecture snapshot version ${String(value.version)} is not supported by this version of Flowzen.`;
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return 'The architecture snapshot is incomplete.';
  const ids = new Set<string>();
  for (const node of value.nodes) {
    if (!isObject(node) || !isString(node.id) || !isString(node.kind) || !isString(node.label) || !isObject(node.config) || !isObject(node.position) || !isNumber(node.position.x) || !isNumber(node.position.y)) return 'A component in the snapshot is malformed.';
    if (!(node.kind in byKind)) return `The snapshot contains an unknown component type “${node.kind}”.`;
    if (!Object.values(node.config).every(isString)) return 'A component configuration in the snapshot is malformed.';
    if (ids.has(node.id)) return 'The snapshot contains duplicate component ids.';
    ids.add(node.id);
  }
  for (const edge of value.edges) if (!isObject(edge) || !isString(edge.source) || !isString(edge.target) || !ids.has(edge.source) || !ids.has(edge.target)) return 'A connection in the snapshot is malformed or refers to a missing component.';
  return null;
}

/**
 * Validates a stored record. Unknown versions are reported as unsupported (a newer Flowzen wrote them);
 * damaged data is reported as invalid. Neither is ever "repaired" with current state.
 */
export function parseAttemptRecord(raw: unknown): ParsedAttempt {
  if (raw === undefined || raw === null) return { status: 'missing' };
  if (!isObject(raw) || raw.schema !== 'flowzen.attempt') return { status: 'invalid', reason: 'The stored attempt has an unknown format.' };
  if (raw.version !== ATTEMPT_SCHEMA_VERSION) return { status: 'unsupported', version: raw.version, reason: `Attempt record version ${String(raw.version)} is not supported by this version of Flowzen.` };
  const architecture = validateArchitectureSnapshot(raw.architecture);
  if (architecture) return isObject(raw.architecture) && raw.architecture.version !== ARCHITECTURE_SCHEMA_VERSION && raw.architecture.schema === 'flowzen.architecture'
    ? { status: 'unsupported', version: raw.architecture.version, reason: architecture } : { status: 'invalid', reason: architecture };
  if (!isString(raw.challengeId) || !isNumber(raw.number) || !isNumber(raw.at) || !isNumber(raw.simulatorRevision)) return { status: 'invalid', reason: 'The attempt’s identity fields are malformed.' };
  const benchmark = raw.benchmark;
  if (!isObject(benchmark) || !isNumber(benchmark.rps) || !isNumber(benchmark.durationMs) || !isNumber(benchmark.seed) || !isObject(benchmark.input) || !Array.isArray(benchmark.input.nodes) || !Array.isArray(benchmark.input.edges)) return { status: 'invalid', reason: 'The benchmark settings are missing or malformed.' };
  const result = raw.result;
  if (!Array.isArray(raw.criteriaDefinitions) || !isObject(result) || typeof result.passed !== 'boolean' || !Array.isArray(result.criteria) || !Array.isArray(result.findings) || !isObject(result.validation)) return { status: 'invalid', reason: 'The graded result is missing or malformed.' };
  for (const criterion of result.criteria) if (!isObject(criterion) || !isString(criterion.id) || !isString(criterion.status) || !(criterion.measured === null || isNumber(criterion.measured)) || !isNumber(criterion.threshold)) return { status: 'invalid', reason: 'A stored criterion result is malformed.' };
  return { status: 'ok', record: deepFreeze(raw as unknown as AttemptRecord) };
}

// ── Loading as a new draft and reproducing ────────────────────────────────────
/** A fresh, editable copy of a snapshot's architecture. The record itself is never touched. */
export function snapshotToDraft(snapshot: ArchitectureSnapshot) {
  const copy = structuredClone(snapshot);
  return {
    nodes: copy.nodes.map(node => ({ id: node.id, kind: node.kind, label: node.label, config: node.config, position: node.position })),
    edges: copy.edges,
  };
}

/** A challenge equivalent to the one the attempt was graded against, built only from the record. */
export function historicalChallenge(record: AttemptRecord, current: Challenge | undefined): Challenge {
  const base = current ?? { id: record.challengeId, number: 0, title: record.challengeTitle, difficulty: 'easy', topics: [], estimatedMinutes: 0, learningObjectives: [], relatedDesigns: [], summary: '', statement: '', scenario: '', functional: [], requirements: [], hints: [], starter: { nodes: [], edges: [] } } as unknown as Challenge;
  const { benchmark } = record;
  return {
    ...base, criteria: structuredClone(record.criteriaDefinitions), fixtures: structuredClone(record.fixtures),
    workload: { rps: benchmark.rps, durationMs: benchmark.durationMs, trafficDurationMs: benchmark.trafficDurationMs, seed: benchmark.seed, pattern: benchmark.pattern, overrides: structuredClone(benchmark.overrides), faults: structuredClone(benchmark.faults).map(fault => ({ ...fault, description: fault.description ?? '' })) },
  };
}
/** The exact engine input to reproduce an attempt (a copy, so the record stays frozen). */
export const reproductionInput = (record: AttemptRecord): SimulationInput => structuredClone(record.benchmark.input);

/** Compares a reproduction's measurements with the recorded ones. */
export function reproductionMatches(record: AttemptRecord, criteria: CriterionResult[], summary: PerformanceSummary | null) {
  const differences: string[] = [];
  for (const recorded of record.result.criteria) {
    const now = criteria.find(entry => entry.id === recorded.id);
    if (!now) { differences.push(`${recorded.label}: not evaluated in the reproduction`); continue; }
    if (now.status !== recorded.status || now.measured !== recorded.measured) differences.push(`${recorded.label}: recorded ${recorded.measured ?? '—'} (${recorded.status}), reproduced ${now.measured ?? '—'} (${now.status})`);
  }
  for (const key of ['p50', 'p95', 'p99', 'successThroughput', 'errorRate'] as const) {
    const a = record.result.summary?.[key] ?? null; const b = summary?.[key] ?? null;
    if (a !== b) differences.push(`${key}: recorded ${a ?? '—'}, reproduced ${b ?? '—'}`);
  }
  return { identical: differences.length === 0, differences };
}

// ── Comparing two attempts ─────────────────────────────────────────────────────
export type ConfigChange = {
  key: string; label: string; before: string | undefined; after: string | undefined;
  /** The field is a simulator parameter (descriptive fields are not). */
  simulated: boolean;
  /** The value the simulator actually used changed (false when a benchmark lock overrode the edit in both runs). */
  affectsSimulation: boolean;
};
export type ComponentChange =
  | { type: 'added' | 'removed'; id: string; label: string; kind: Kind }
  | { type: 'changed'; id: string; label: string; kind: Kind; renamed?: { before: string; after: string }; kindChanged?: { before: Kind; after: Kind }; config: ConfigChange[]; moved: boolean };
export type MetricDelta = { key: string; label: string; unit: string; a: number | null; b: number | null; delta: number | null; lowerIsBetter: boolean };
export type CriterionDelta = { id: string; label: string; unit: string; a: { status: string; measured: number | null } | null; b: { status: string; measured: number | null } | null; statusChanged: boolean };
export type Attribution =
  | { kind: 'benchmarks-differ'; message: string; details: string[] }
  | { kind: 'identical-inputs'; message: string }
  | { kind: 'single-change'; message: string; change: string }
  | { kind: 'multiple-changes'; message: string; count: number };
export type AttemptComparison = {
  a: { number: number; at: number; passed: boolean }; b: { number: number; at: number; passed: boolean };
  /** Simulator measurements of each attempt's own benchmark run. */
  measured: { metrics: MetricDelta[]; utilization: MetricDelta[]; criteria: CriterionDelta[] };
  /** Differences in the submitted designs; these describe what changed, not what caused a result. */
  structural: { components: ComponentChange[]; connectionsAdded: string[]; connectionsRemoved: string[] };
  /** Changes that alter the simulator's input (cosmetic changes such as names and positions excluded). */
  simulationChanges: string[];
  attribution: Attribution;
};

const edgeId = (edge: { source: string; target: string }) => `${edge.source}→${edge.target}`;
const delta = (a: number | null, b: number | null) => a === null || b === null ? null : Math.round((b - a) * 1000) / 1000;
const sortedKeys = (...records: Array<Record<string, unknown>>) => [...new Set(records.flatMap(record => Object.keys(record)))].sort();

/** Simulation-relevant differences between two engine inputs, described in terms of the design. */
export function simulationInputChanges(a: SimulationInput, b: SimulationInput, labelOf: (id: string) => string): string[] {
  const changes: string[] = [];
  const nodesA = new Map(a.nodes.map(node => [node.id, node])); const nodesB = new Map(b.nodes.map(node => [node.id, node]));
  for (const id of [...new Set([...nodesA.keys(), ...nodesB.keys()])].sort()) {
    const before = nodesA.get(id); const after = nodesB.get(id);
    if (!before && after) { changes.push(`Added ${labelOf(id)} (${byKind[after.kind]?.label ?? after.kind})`); continue; }
    if (before && !after) { changes.push(`Removed ${labelOf(id)} (${byKind[before.kind]?.label ?? before.kind})`); continue; }
    if (!before || !after) continue;
    if (before.kind !== after.kind) { changes.push(`Changed ${labelOf(id)} from ${before.kind} to ${after.kind}`); continue; }
    const simulatedKeys = new Set(byKind[after.kind]?.fields.filter(field => field.simulated).map(field => field.key) ?? []);
    for (const key of sortedKeys(before.config ?? {}, after.config ?? {})) {
      if (!simulatedKeys.has(key) || before.config?.[key] === after.config?.[key]) continue;
      const field = byKind[after.kind].fields.find(entry => entry.key === key);
      changes.push(`${labelOf(id)} · ${field?.label ?? key}: ${before.config?.[key] ?? '—'} → ${after.config?.[key] ?? '—'}`);
    }
  }
  const edgesA = new Set(a.edges.map(edgeId)); const edgesB = new Set(b.edges.map(edgeId));
  const name = (edge: string) => edge.split('→').map(labelOf).join(' → ');
  for (const edge of [...edgesB].filter(edge => !edgesA.has(edge)).sort()) changes.push(`Connected ${name(edge)}`);
  for (const edge of [...edgesA].filter(edge => !edgesB.has(edge)).sort()) changes.push(`Disconnected ${name(edge)}`);
  return changes;
}

/**
 * Structural differences between two architecture snapshots (including cosmetic ones). `inputA`/`inputB` are the
 * engine inputs actually simulated, used to tell whether a configuration edit changed what the simulator used.
 */
export function diffSnapshots(snapshotA: ArchitectureSnapshot, snapshotB: ArchitectureSnapshot, inputA: SimulationInput, inputB: SimulationInput, labelOf: (id: string) => string) {
  const nodesA = new Map(snapshotA.nodes.map(node => [node.id, node])); const nodesB = new Map(snapshotB.nodes.map(node => [node.id, node]));
  const components: ComponentChange[] = [];
  for (const id of [...new Set([...nodesA.keys(), ...nodesB.keys()])].sort()) {
    const before = nodesA.get(id); const after = nodesB.get(id);
    if (!before && after) { components.push({ type: 'added', id, label: labelOf(id), kind: after.kind }); continue; }
    if (before && !after) { components.push({ type: 'removed', id, label: before.label || id, kind: before.kind }); continue; }
    if (!before || !after) continue;
    const simulated = new Set(byKind[after.kind]?.fields.filter(field => field.simulated).map(field => field.key) ?? []);
    const usedA = inputA.nodes.find(node => node.id === id)?.config ?? {}; const usedB = inputB.nodes.find(node => node.id === id)?.config ?? {};
    const config = sortedKeys(before.config, after.config).filter(key => before.config[key] !== after.config[key])
      .map(key => ({ key, label: byKind[after.kind]?.fields.find(field => field.key === key)?.label ?? key, before: before.config[key], after: after.config[key], simulated: simulated.has(key), affectsSimulation: simulated.has(key) && usedA[key] !== usedB[key] }));
    const renamed = before.label !== after.label ? { before: before.label, after: after.label } : undefined;
    const kindChanged = before.kind !== after.kind ? { before: before.kind, after: after.kind } : undefined;
    const moved = before.position.x !== after.position.x || before.position.y !== after.position.y;
    if (renamed || kindChanged || config.length || moved) components.push({ type: 'changed', id, label: labelOf(id), kind: after.kind, renamed, kindChanged, config, moved });
  }
  const edgesA = new Set(snapshotA.edges.map(edgeId)); const edgesB = new Set(snapshotB.edges.map(edgeId));
  const describeEdge = (edge: string) => edge.split('→').map(labelOf).join(' → ');
  const connectionsAdded = [...edgesB].filter(edge => !edgesA.has(edge)).sort().map(describeEdge);
  const connectionsRemoved = [...edgesA].filter(edge => !edgesB.has(edge)).sort().map(describeEdge);

  return { components, connectionsAdded, connectionsRemoved };
}

function benchmarkDifferences(a: BenchmarkRecord, b: BenchmarkRecord, revisionA: number, revisionB: number): string[] {
  const details: string[] = [];
  if (a.rps !== b.rps) details.push(`offered traffic ${a.rps} vs ${b.rps} req/s`);
  if (a.durationMs !== b.durationMs || a.trafficDurationMs !== b.trafficDurationMs) details.push('run length or traffic window');
  if (a.seed !== b.seed) details.push(`seed ${a.seed} vs ${b.seed}`);
  if (JSON.stringify(a.faults.map(({ nodeId, startMs, endMs }) => [nodeId, startMs, endMs])) !== JSON.stringify(b.faults.map(({ nodeId, startMs, endMs }) => [nodeId, startMs, endMs]))) details.push('scheduled failures');
  if (JSON.stringify(a.overrides.map(entry => [entry.kinds, entry.config])) !== JSON.stringify(b.overrides.map(entry => [entry.kinds, entry.config]))) details.push('locked workload costs');
  if (revisionA !== revisionB) details.push(`simulator revision ${revisionA} vs ${revisionB}`);
  return details;
}

/**
 * Compares attempt `a` (earlier) with attempt `b` (later). Deterministic: every list is sorted, and the
 * records are only read. Causal language is limited to what the comparison supports: the simulator is
 * deterministic, so when the benchmarks match and exactly one simulation input differs, that difference is
 * the only possible source of a measured change.
 */
export function compareAttempts(a: AttemptRecord, b: AttemptRecord): AttemptComparison {
  const labels = new Map([...a.architecture.nodes, ...b.architecture.nodes].map(node => [node.id, node.label || byKind[node.kind]?.label || node.id]));
  for (const node of b.architecture.nodes) labels.set(node.id, node.label || byKind[node.kind]?.label || node.id);
  const labelOf = (id: string) => labels.get(id) ?? id;

  // Measured differences.
  const sa = a.result.summary; const sb = b.result.summary;
  const metric = (key: keyof Pick<PerformanceSummary, 'p50' | 'p95' | 'p99' | 'successThroughput' | 'errorRate'>, label: string, unit: string, lowerIsBetter: boolean): MetricDelta =>
    ({ key, label, unit, a: sa?.[key] ?? null, b: sb?.[key] ?? null, delta: delta(sa?.[key] ?? null, sb?.[key] ?? null), lowerIsBetter });
  const metrics = [metric('p50', 'Latency p50', 'ms', true), metric('p95', 'Latency p95', 'ms', true), metric('p99', 'Latency p99', 'ms', true), metric('successThroughput', 'Successful throughput', 'req/s', false), metric('errorRate', 'Error rate', '%', true)];
  const utilA = new Map(sa?.utilization.map(entry => [entry.id, entry.utilization * 100]) ?? []); const utilB = new Map(sb?.utilization.map(entry => [entry.id, entry.utilization * 100]) ?? []);
  const utilization = [...new Set([...utilA.keys(), ...utilB.keys()])].sort().map(id => ({ key: id, label: labelOf(id), unit: '%', a: utilA.get(id) ?? null, b: utilB.get(id) ?? null, delta: delta(utilA.get(id) ?? null, utilB.get(id) ?? null), lowerIsBetter: true }));
  const criterionIds = [...new Set([...a.result.criteria.map(entry => entry.id), ...b.result.criteria.map(entry => entry.id)])];
  const criteria = criterionIds.map(id => {
    const ca = a.result.criteria.find(entry => entry.id === id); const cb = b.result.criteria.find(entry => entry.id === id);
    return { id, label: (cb ?? ca)!.label, unit: (cb ?? ca)!.unit, a: ca ? { status: ca.status, measured: ca.measured } : null, b: cb ? { status: cb.status, measured: cb.measured } : null, statusChanged: ca?.status !== cb?.status };
  });

  const { components, connectionsAdded, connectionsRemoved } = diffSnapshots(a.architecture, b.architecture, a.benchmark.input, b.benchmark.input, labelOf);

  // What the comparison can and cannot say about cause.
  const simulationChanges = simulationInputChanges(a.benchmark.input, b.benchmark.input, labelOf);
  const benchDetails = benchmarkDifferences(a.benchmark, b.benchmark, a.simulatorRevision, b.simulatorRevision);
  const attribution: Attribution = benchDetails.length
    ? { kind: 'benchmarks-differ', details: benchDetails, message: 'The two attempts were run under different benchmark settings, so their measurements are not directly comparable and no design change can be credited for a difference.' }
    : simulationChanges.length === 0
      ? { kind: 'identical-inputs', message: 'The simulator received identical inputs for both attempts. Any differences are cosmetic (names or positions), which do not affect simulation results.' }
      : simulationChanges.length === 1
        ? { kind: 'single-change', change: simulationChanges[0], message: 'The benchmark was identical and this was the only change to the simulator’s input. Because the simulator is deterministic, the measured differences follow from this change (in this benchmark only).' }
        : { kind: 'multiple-changes', count: simulationChanges.length, message: `${simulationChanges.length} simulation inputs changed between these attempts. The comparison shows what changed and what was measured, but it cannot tell which change, or which combination, produced a given difference.` };

  return {
    a: { number: a.number, at: a.at, passed: a.result.passed }, b: { number: b.number, at: b.at, passed: b.result.passed },
    measured: { metrics, utilization, criteria }, structural: { components, connectionsAdded, connectionsRemoved }, simulationChanges, attribution,
  };
}
