import { CACHE_KINDS, TELEMETRY_KINDS, param, type ComponentKind, type RequestRecord, type SimulationInput, type SimulationNode, type SimulationResult } from '../simulation/engine';
import type { Validation } from '../app/validation';
import type { Challenge, Comparator, Criterion } from './definitions';

/** A component in the user's architecture, as the grader sees it. */
export type ArchitectureNode = SimulationNode & { label?: string };
export type Architecture = { nodes: ArchitectureNode[]; edges: Array<{ source: string; target: string }> };

export type CriterionStatus = 'pass' | 'fail' | 'unsupported' | 'unavailable';
/** Runtime criteria are measured from the benchmark run; architecture criteria from the design itself and its validation. */
export type CriterionCategory = 'runtime' | 'architecture';
export type CriterionResult = {
  id: string; label: string; mandatory: boolean; category: CriterionCategory; status: CriterionStatus; measured: number | null; threshold: number; comparator: Comparator; unit: string;
  /** For a failed criterion, how far the measurement is from the threshold, in the criterion's unit. */
  missedBy: number | null;
  detail: string; advice?: string;
};
/** An explanation of the run's behavior, backed by engine measurements listed in `evidence`. */
export type Finding = { kind: 'failures' | 'saturation' | 'backlog' | 'cache' | 'jobs'; severity: 'high' | 'medium' | 'info'; component?: string; title: string; evidence: string[] };
export type PerformanceSummary = {
  offeredRequests: number; offeredRps: number; completedRequests: number; failedRequests: number; successThroughput: number; errorRate: number;
  p50: number | null; p95: number | null; p99: number | null;
  utilization: Array<{ id: string; label: string; utilization: number; maxQueueDepth: number; rejected: number }>;
};
export type Grade = {
  challengeId: string; passed: boolean; criteria: CriterionResult[]; summary: PerformanceSummary | null;
  /** Ranked explanations of the run. `mainBottleneck` is the most severe one that limits performance, if any. */
  findings: Finding[]; mainBottleneck: Finding | null; validation: Pick<Validation, 'counts' | 'issues'>;
  /** Why performance criteria could not be evaluated, if they could not. */
  invalidReason: string | null;
};

/** Settings the benchmark applies to a node: per-kind workload costs, then locked settings of given systems. */
export function lockedConfig(challenge: Challenge, node: { id: string; kind: ComponentKind }): Record<string, string> {
  const locked: Record<string, string> = {};
  const fixture = challenge.fixtures[node.id];
  if (fixture && fixture.kind === node.kind) return { ...fixture.locked };
  for (const override of challenge.workload.overrides) if (override.kinds.includes(node.kind)) Object.assign(locked, override.config);
  return locked;
}

/** The exact benchmark the grader runs: the challenge's workload and seed, never the toolbar's settings. */
export function benchmarkInput(challenge: Challenge, architecture: Architecture): SimulationInput & { nodes: ArchitectureNode[] } {
  const { workload } = challenge;
  return {
    nodes: architecture.nodes.map(node => ({ id: node.id, kind: node.kind, label: node.label, config: { ...node.config, ...lockedConfig(challenge, node) } })),
    edges: architecture.edges.map(edge => ({ source: edge.source, target: edge.target })),
    durationMs: workload.durationMs, trafficDurationMs: workload.trafficDurationMs, offeredRps: workload.rps, seed: workload.seed,
    faults: workload.faults.map(({ nodeId, startMs, endMs }) => ({ nodeId, startMs, endMs })),
    ...(workload.maxEvents ? { maxEvents: workload.maxEvents } : {}),
  };
}

/** Compute slots: what a design spends on application capacity. */
export function computeSlots(nodes: SimulationNode[]) {
  let total = 0;
  for (const node of nodes) {
    if (node.kind === 'server') total += Math.floor(param(node, 'instances'));
    else if (node.kind === 'containerService') total += Math.floor(param(node, 'maxTasks')) * Math.floor(param(node, 'slotsPerTask'));
    else if (node.kind === 'serverless') total += Math.floor(param(node, 'concurrency'));
  }
  return total;
}

const ARCHITECTURE_METRICS = new Set(['deadComponents', 'fixturesIntact', 'computeSlots']);
/** Architecture criteria are checked on the design; everything else is measured from the benchmark run. */
export const categoryOf = (criterion: Pick<Criterion, 'metric'>): CriterionCategory => ARCHITECTURE_METRICS.has(criterion.metric.kind) ? 'architecture' : 'runtime';

/** Graded results are records of what happened: freeze them so nothing can edit them afterwards. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item); }
  return value;
}

const compare = (value: number, comparator: Comparator, threshold: number) =>
  comparator === '<=' ? value <= threshold : comparator === '<' ? value < threshold : comparator === '>=' ? value >= threshold : value > threshold;
const round = (value: number) => Math.round(value * 100) / 100;
const fmt = (value: number, unit: string) => `${round(value).toLocaleString()}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
/** Differences between percentages are percentage points. */
const fmtGap = (value: number, unit: string) => unit === '%' ? `${round(value).toLocaleString()} percentage points` : fmt(value, unit);

/** A request "processed by" a target counts if it, or a completed job it dispatched, has a real processing span there. */
function processedBy(request: RequestRecord, jobs: RequestRecord[], matches: (component: string) => boolean) {
  const visited = (record: RequestRecord) => record.processing.some(span => span.note !== 'read routed to replica' && matches(span.component));
  return visited(request) || jobs.some(job => job.status === 'completed' && visited(job));
}

/**
 * Grades a benchmark run. Performance criteria use the engine's measurements of the benchmark
 * workload; structural criteria use the architecture and its validation. A challenge passes only if
 * every mandatory criterion passes. Unsupported or unavailable measurements never pass.
 */
export function grade(challenge: Challenge, input: SimulationInput, result: SimulationResult | null, validation: Pick<Validation, 'counts' | 'issues'>): Grade {
  const kinds = new Map(input.nodes.map(node => [node.id, node.kind]));
  const labelOf = (id: string) => (input.nodes.find(node => node.id === id) as ArchitectureNode | undefined)?.label ?? challenge.fixtures[id]?.label ?? id;
  const trafficMs = challenge.workload.trafficDurationMs ?? challenge.workload.durationMs;
  const expectedOffered = Math.floor(trafficMs / 1000 * challenge.workload.rps);

  // The run must be exactly the benchmark and complete, or performance cannot be judged.
  let invalidReason: string | null = null;
  if (!result) invalidReason = 'No benchmark result is available.';
  else if (!result.offeredRequests) invalidReason = 'The benchmark generated no traffic. Add a Client connected to your entry point.';
  else if (result.durationMs !== challenge.workload.durationMs || result.offeredRequests !== expectedOffered) invalidReason = 'The result does not match the benchmark workload.';
  else if (result.stoppedEarly) invalidReason = 'The engine hit its event limit before the benchmark finished, so the measurements are incomplete.';
  else if (result.requests.length < expectedOffered) invalidReason = 'Not every offered request was simulated.';
  const valid = invalidReason === null && result !== null;

  const jobsByParent = new Map<number, RequestRecord[]>();
  if (valid) for (const job of result.jobs) jobsByParent.set(job.parentId ?? -1, [...(jobsByParent.get(job.parentId ?? -1) ?? []), job]);

  const measure = (criterion: Criterion): { value: number | null; status?: CriterionStatus; detail?: string } => {
    const metric = criterion.metric;
    switch (metric.kind) {
      case 'unsupported': return { value: null, status: 'unsupported', detail: metric.reason };
      case 'deadComponents': return { value: validation.counts.dead, detail: validation.counts.dead ? `${validation.counts.dead} dead component${validation.counts.dead === 1 ? '' : 's'} in the architecture.` : 'Every component can take part in a request flow.' };
      case 'fixturesIntact': {
        const missing = Object.entries(challenge.fixtures).filter(([id, fixture]) => kinds.get(id) !== fixture.kind).map(([, fixture]) => fixture.label);
        return { value: missing.length, detail: missing.length ? `Missing: ${missing.join(', ')}.` : 'All given systems are present.' };
      }
      case 'computeSlots': { const slots = computeSlots(input.nodes); return { value: slots, detail: `${slots} compute slots configured.` }; }
    }
    if (!valid) return { value: null, status: 'unavailable', detail: invalidReason ?? 'No result.' };
    const requests = result.requests; const successes = requests.filter(request => request.status === 'completed'); const failures = requests.filter(request => request.status === 'failed');
    switch (metric.kind) {
      case 'latency': {
        const value = result.latency[metric.percentile];
        return value === null ? { value: null, status: 'unavailable', detail: 'No request completed successfully, so latency cannot be measured.' } : { value, detail: `${metric.percentile} over ${successes.length.toLocaleString()} successful requests.` };
      }
      case 'successThroughput': return { value: result.successfulThroughput, detail: `${result.completedRequests.toLocaleString()} of ${result.offeredRequests.toLocaleString()} offered requests succeeded over ${trafficMs / 1000} s of traffic.` };
      case 'errorRate': return { value: result.errorRate * 100, detail: `${result.failedRequests.toLocaleString()} failed of ${requests.length.toLocaleString()}.` };
      case 'loadShare': {
        if (!kinds.has(metric.nodeId)) return { value: null, status: 'unavailable', detail: `${labelOf(metric.nodeId)} is not in the architecture.` };
        const reached = requests.filter(request => request.processing.some(span => span.component === metric.nodeId && span.note !== 'read routed to replica')).length;
        return { value: reached / requests.length * 100, detail: `${reached.toLocaleString()} of ${requests.length.toLocaleString()} requests were processed by ${labelOf(metric.nodeId)}.` };
      }
      case 'utilization': {
        const component = result.components.find(entry => entry.id === metric.nodeId);
        return component ? { value: component.utilization * 100, detail: `${labelOf(metric.nodeId)}'s ${component.capacity} slots were busy ${Math.round(component.utilization * 1000) / 10}% of the run.` } : { value: null, status: 'unavailable', detail: `${labelOf(metric.nodeId)} is not in the architecture.` };
      }
      case 'maxQueue': {
        const component = result.components.find(entry => entry.id === metric.nodeId);
        return component ? { value: component.maxQueueDepth, detail: `Deepest backlog at ${labelOf(metric.nodeId)} during the run.` } : { value: null, status: 'unavailable', detail: `${labelOf(metric.nodeId)} is not in the architecture.` };
      }
      case 'failureShareAt': {
        const here = failures.filter(request => request.failedAt === metric.nodeId).length;
        return { value: failures.length ? here / failures.length * 100 : 0, detail: failures.length ? `${here.toLocaleString()} of ${failures.length.toLocaleString()} failures happened at ${labelOf(metric.nodeId)}.` : 'No requests failed.' };
      }
      case 'processedBy': {
        if (!successes.length) return { value: null, status: 'unavailable', detail: 'No request succeeded, so there is nothing to check.' };
        const matches = metric.nodeId ? (id: string) => id === metric.nodeId : (id: string) => metric.kinds!.includes(kinds.get(id) as ComponentKind);
        const done = successes.filter(request => processedBy(request, jobsByParent.get(request.id) ?? [], matches)).length;
        return { value: done / successes.length * 100, detail: `${done.toLocaleString()} of ${successes.length.toLocaleString()} successful requests were processed by ${metric.nodeId ? labelOf(metric.nodeId) : 'application compute'}.` };
      }
    }
  };

  const criteria: CriterionResult[] = challenge.criteria.map(criterion => {
    const { value, status, detail } = measure(criterion);
    const base = { id: criterion.id, label: criterion.label, mandatory: criterion.mandatory, threshold: criterion.threshold, comparator: criterion.comparator, unit: criterion.unit,
      category: categoryOf(criterion) };
    if (status === 'unsupported' || status === 'unavailable' || value === null) return { ...base, status: status ?? 'unavailable', measured: null, missedBy: null, detail: detail ?? 'Not measured.', advice: criterion.advice || undefined };
    const ok = compare(value, criterion.comparator, criterion.threshold);
    const gap = Math.abs(value - criterion.threshold);
    const margin = ok ? (gap === 0 ? 'exactly at the limit' : `${fmtGap(gap, criterion.unit)} of headroom`) : `${fmtGap(gap, criterion.unit)} ${criterion.comparator.startsWith('<') ? 'over' : 'short of'} the limit`;
    // Margins describe performance headroom; structural counts (dead components, missing systems) speak for themselves.
    const structural = criterion.metric.kind === 'deadComponents' || criterion.metric.kind === 'fixturesIntact';
    return { ...base, status: ok ? 'pass' : 'fail', measured: value, missedBy: ok ? null : round(gap), detail: structural ? detail ?? '' : `${detail} ${margin[0].toUpperCase()}${margin.slice(1)}.`, advice: ok ? undefined : criterion.advice };
  });
  const passed = criteria.every(entry => !entry.mandatory || entry.status === 'pass');

  const summary: PerformanceSummary | null = valid ? {
    offeredRequests: result.offeredRequests, offeredRps: challenge.workload.rps, completedRequests: result.completedRequests, failedRequests: result.failedRequests,
    successThroughput: result.successfulThroughput, errorRate: result.errorRate * 100, p50: result.latency.p50, p95: result.latency.p95, p99: result.latency.p99,
    utilization: result.components.filter(entry => entry.kind !== 'deadLetterQueue' && !TELEMETRY_KINDS.has(entry.kind)).map(entry => ({ id: entry.id, label: labelOf(entry.id), utilization: entry.utilization, maxQueueDepth: entry.maxQueueDepth, rejected: entry.rejected }))
      .sort((a, b) => b.utilization - a.utilization),
  } : null;
  const findings = valid ? diagnose(result, input, labelOf) : [];
  return deepFreeze({
    challengeId: challenge.id, passed, criteria, summary, findings, mainBottleneck: findings.find(finding => finding.severity !== 'info' && finding.kind !== 'cache') ?? null,
    // Copied, so later validation changes in the editor cannot reach a graded result.
    validation: structuredClone({ counts: validation.counts, issues: validation.issues }), invalidReason,
  });
}

const FAILURE_VERBS: Record<string, string> = {
  timeout: 'timed out waiting at', rejected: 'were rejected (queue full) at', unrouted: 'had no route at', unfinished: 'were still in progress at the end of the run at', blocked: 'were blocked at',
  'rate-limited': 'were rate-limited at', 'circuit-open': 'failed fast (circuit open) at', throttled: 'were throttled at', unavailable: 'hit the scheduled outage at',
};
const SEVERITY_RANK = { high: 0, medium: 1, info: 2 } as const;
const pct = (value: number) => `${Math.round(value * 1000) / 10}%`;
const count = (value: number) => value.toLocaleString();

/**
 * Explains why the run behaved as it did. Every statement comes from engine output (request traces and
 * component metrics); a finding is only produced when those measurements support it.
 */
export function diagnose(result: SimulationResult, input: SimulationInput, labelOf: (id: string) => string): Finding[] {
  const ranked: Array<Finding & { weight: number }> = [];
  const total = result.requests.length || 1;
  const metrics = new Map(result.components.map(component => [component.id, component]));
  const usage = (id: string) => {
    const metric = metrics.get(id); if (!metric) return [];
    return [
      `${pct(metric.utilization)} of its ${metric.capacity} slot${metric.capacity === 1 ? '' : 's'} busy over the run`,
      metric.maxQueueDepth ? `backlog peaked at ${count(metric.maxQueueDepth)} waiting` : 'no backlog formed',
      metric.averageWaitMs >= 0.5 ? `average queue wait ${Math.round(metric.averageWaitMs * 10) / 10} ms` : '',
    ].filter(Boolean);
  };

  // Where requests failed, and why.
  const failures = new Map<string, { at: string; kind: string; count: number }>();
  for (const request of result.requests) {
    if (request.status !== 'failed') continue;
    const key = `${request.failedAt}|${request.failureKind}`; const entry = failures.get(key) ?? { at: request.failedAt ?? '', kind: request.failureKind ?? 'failed', count: 0 };
    entry.count += 1; failures.set(key, entry);
  }
  const failedAt = new Set<string>();
  for (const { at, kind, count: n } of failures.values()) {
    failedAt.add(at);
    const fault = kind === 'unavailable' ? input.faults?.find(entry => entry.nodeId === at) : undefined;
    ranked.push({
      kind: 'failures', severity: n / total >= 0.01 ? 'high' : 'medium', component: at, weight: n,
      title: `${count(n)} requests ${FAILURE_VERBS[kind] ?? 'failed at'} ${at ? labelOf(at) : 'an unknown component'}`,
      evidence: [`${pct(n / total)} of all requests`, ...(fault ? [`scheduled outage from ${fault.startMs / 1000} s to ${fault.endMs / 1000} s`] : []), ...usage(at), ...(metrics.get(at)?.utilization ?? 0) >= 0.85 ? ['the component was saturated'] : []],
    });
  }

  for (const metric of result.components) {
    if (metric.kind === 'deadLetterQueue' || TELEMETRY_KINDS.has(metric.kind)) continue;
    if (metric.utilization >= 0.85 && !failedAt.has(metric.id)) ranked.push({ kind: 'saturation', severity: 'high', component: metric.id, weight: metric.utilization * total, title: `${labelOf(metric.id)} is saturated`, evidence: usage(metric.id) });
    else if (metric.maxQueueDepth >= 10 && !failedAt.has(metric.id)) ranked.push({ kind: 'backlog', severity: 'medium', component: metric.id, weight: metric.maxQueueDepth, title: `Requests queued at ${labelOf(metric.id)}`, evidence: usage(metric.id) });
  }

  // Did each cache actually take load off the component behind it?
  const kinds = new Map(input.nodes.map(node => [node.id, node.kind]));
  for (const node of input.nodes) {
    if (!CACHE_KINDS.has(node.kind)) continue;
    const behind = input.edges.find(edge => edge.source === node.id && !TELEMETRY_KINDS.has(kinds.get(edge.target) as ComponentKind) && kinds.get(edge.target) !== 'deadLetterQueue')?.target;
    const visits = (request: RequestRecord, id: string) => request.processing.some(span => span.component === id && span.note !== 'read routed to replica');
    const lookups = result.requests.filter(request => visits(request, node.id));
    const hits = lookups.filter(request => request.cache === 'hit' && request.processing[request.processing.length - 1]?.component === node.id).length;
    if (!lookups.length) { ranked.push({ kind: 'cache', severity: 'medium', component: node.id, weight: 0, title: `${labelOf(node.id)} received no requests`, evidence: ['no request passed through it during the benchmark, so it could not reduce load on anything'] }); continue; }
    const reached = behind ? result.requests.filter(request => visits(request, behind)) : [];
    const bypassed = behind ? reached.filter(request => !visits(request, node.id)).length : 0;
    const evidence = [`${count(lookups.length)} lookups, ${count(hits)} served from the cache (${pct(hits / lookups.length)})`];
    if (behind) evidence.push(`${pct(reached.length / total)} of all requests reached ${labelOf(behind)}`);
    if (bypassed) evidence.push(`${count(bypassed)} of them reached ${labelOf(behind!)} without passing through ${labelOf(node.id)}`);
    const ineffective = behind !== undefined && reached.length > 0 && bypassed / reached.length > 0.5;
    ranked.push({
      kind: 'cache', severity: ineffective ? 'medium' : 'info', component: node.id, weight: lookups.length, evidence,
      title: ineffective ? `${labelOf(node.id)} is bypassed: most requests reach ${labelOf(behind!)} directly` : `${labelOf(node.id)} served ${pct(hits / lookups.length)} of its lookups`,
    });
  }

  const pending = result.jobs.filter(job => job.status === 'pending');
  if (pending.length) {
    const at = pending[0].destination;
    ranked.push({ kind: 'jobs', severity: 'high', component: at, weight: pending.length, title: `${count(pending.length)} jobs were still pending when the run ended`, evidence: at ? [`waiting for ${labelOf(at)}`, ...usage(at)] : [] });
  }
  for (const metric of result.components) if (metric.kind === 'deadLetterQueue' && metric.counters?.deadLettered) {
    ranked.push({ kind: 'jobs', severity: 'high', component: metric.id, weight: metric.counters.deadLettered, title: `${count(metric.counters.deadLettered)} jobs were dead-lettered at ${labelOf(metric.id)}`, evidence: ['each one failed on every allowed delivery'] });
  }
  return ranked.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.weight - a.weight).slice(0, 8).map(({ weight: _weight, ...finding }) => finding);
}
