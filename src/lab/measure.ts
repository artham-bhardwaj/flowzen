import { CACHE_KINDS, TELEMETRY_KINDS, type ComponentKind, type Fault, type FailureKind, type SimulationInput, type SimulationResult } from '../simulation/engine';
import { computeSlots, diagnose, type Finding } from '../challenges/grading';
import type { ArchitectureSnapshot } from '../challenges/attempts';

/**
 * Lab benchmarks and measurement extraction. Kept free of UI and catalog imports because it also runs inside
 * the simulation worker, where measurements are extracted so large request traces never cross threads.
 */
/** Bounds that keep a run or sweep from freezing the browser. */
export const LAB_LIMITS = {
  minRps: 1, maxRps: 5000,
  minDurationMs: 1000, maxDurationMs: 30_000, maxDrainMs: 10_000,
  maxLevels: 8,
  /** Engine event budget per run; a run that hits it is reported as incomplete, never as measured. */
  maxEventsPerRun: 1_500_000,
  /** Offered requests across all levels of one sweep. */
  maxSweepRequests: 400_000,
} as const;
export const SWEEP_MULTIPLIERS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6] as const;

export type LabBenchmark = {
  /** Offered requests per second during the traffic window. */
  rps: number;
  /** Traffic window; arrivals stop after it. */
  durationMs: number;
  /** Extra run time after arrivals stop so in-flight and queued work can finish. */
  drainMs: number;
  seed: number;
  /** Scheduled dependency outages (the engine's only failure model). */
  faults: Fault[];
};
export type LabTargets = { p95Ms: number; maxErrorRatePct: number; minSuccessPct: number };
export const DEFAULT_BENCHMARK: LabBenchmark = { rps: 400, durationMs: 10_000, drainMs: 2000, seed: 42, faults: [] };
export const DEFAULT_TARGETS: LabTargets = { p95Ms: 200, maxErrorRatePct: 1, minSuccessPct: 99 };

export function validateBenchmark(benchmark: LabBenchmark, nodeIds?: Set<string>): string[] {
  const errors: string[] = [];
  const integer = (value: number) => Number.isFinite(value) && Math.round(value) === value;
  if (!integer(benchmark.rps) || benchmark.rps < LAB_LIMITS.minRps || benchmark.rps > LAB_LIMITS.maxRps) errors.push(`Traffic must be a whole number from ${LAB_LIMITS.minRps} to ${LAB_LIMITS.maxRps.toLocaleString()} req/s.`);
  if (!integer(benchmark.durationMs) || benchmark.durationMs < LAB_LIMITS.minDurationMs || benchmark.durationMs > LAB_LIMITS.maxDurationMs) errors.push(`The traffic window must be ${LAB_LIMITS.minDurationMs / 1000}–${LAB_LIMITS.maxDurationMs / 1000} s.`);
  if (!integer(benchmark.drainMs) || benchmark.drainMs < 0 || benchmark.drainMs > LAB_LIMITS.maxDrainMs) errors.push(`The drain window must be 0–${LAB_LIMITS.maxDrainMs / 1000} s.`);
  if (!integer(benchmark.seed) || benchmark.seed < 0) errors.push('The seed must be a non-negative whole number.');
  const runMs = benchmark.durationMs + benchmark.drainMs;
  for (const fault of benchmark.faults) {
    if (nodeIds && !nodeIds.has(fault.nodeId)) errors.push(`A failure targets a component that is not in the architecture (${fault.nodeId}).`);
    if (!(fault.startMs >= 0 && fault.endMs > fault.startMs && fault.endMs <= runMs)) errors.push('Each failure window must start at or after 0 s, end after it starts, and end within the run.');
  }
  return errors;
}

/** The engine input for an architecture under a benchmark (optionally at another traffic level). */
export function labInput(architecture: ArchitectureSnapshot, benchmark: LabBenchmark, rps = benchmark.rps): SimulationInput {
  return {
    nodes: architecture.nodes.map(node => ({ id: node.id, kind: node.kind, config: { ...node.config } })),
    edges: architecture.edges.map(edge => ({ source: edge.source, target: edge.target })),
    durationMs: benchmark.durationMs + benchmark.drainMs, trafficDurationMs: benchmark.durationMs,
    offeredRps: rps, seed: benchmark.seed, faults: benchmark.faults.map(fault => ({ ...fault })), maxEvents: LAB_LIMITS.maxEventsPerRun,
  };
}

// ── Measurements ───────────────────────────────────────────────────────────────
export type ComponentMeasurement = {
  id: string; label: string; kind: ComponentKind;
  /**
   * Fraction of its slots busy during the traffic window (0–1), from the processing spans in the traces.
   * Used for ranking and saturation, because a drain window would otherwise dilute a saturated component.
   */
  utilization: number;
  /** The engine's own figure: busy fraction over the whole run, including the drain window. */
  runUtilization: number;
  capacity: number; maxQueueDepth: number; averageWaitMs: number; completed: number; rejected: number;
  /** Requests whose trace has a processing span here. */
  requestsProcessed: number;
};
export type LabMeasurements = {
  /** False when the engine hit its event limit: the run is incomplete and must not be read as a measurement. */
  complete: boolean;
  offeredRps: number; offeredRequests: number; simulatedRequests: number; completedRequests: number; failedRequests: number;
  successThroughput: number;
  /** Completed requests as a share of offered requests. */
  successPct: number; errorRatePct: number;
  p50: number | null; p95: number | null; p99: number | null;
  failures: Array<{ componentId: string; label: string; kind: FailureKind | 'failed'; count: number }>;
  components: ComponentMeasurement[];
  /** Mean time per successful request at each component, from traces (queue wait and processing separately). */
  timeShare: Array<{ id: string; label: string; waitMs: number; processingMs: number }>;
  cache: Array<{ id: string; label: string; lookups: number; hits: number }>;
  jobs: { total: number; completed: number; failed: number; pending: number; deadLettered: number };
  computeSlots: number;
  /** Heuristic explanations derived from the measurements above (from the challenge grader's diagnosis). */
  findings: Finding[];
};

/** Reads a run's measurements from engine output. Never estimates: missing data stays null or empty. */
export function measure(result: SimulationResult, input: SimulationInput, labels: Record<string, string>): LabMeasurements {
  const labelOf = (id: string) => labels[id] ?? id;
  const requests = result.requests;
  const visits = (record: { processing: Array<{ component: string; note?: string }> }, id: string) => record.processing.some(span => span.component === id && span.note !== 'read routed to replica');

  const failures = new Map<string, { componentId: string; label: string; kind: FailureKind | 'failed'; count: number }>();
  for (const request of requests) {
    if (request.status !== 'failed') continue;
    const key = `${request.failedAt}|${request.failureKind}`;
    const entry = failures.get(key) ?? { componentId: request.failedAt ?? '', label: request.failedAt ? labelOf(request.failedAt) : 'unknown', kind: request.failureKind ?? 'failed', count: 0 };
    entry.count += 1; failures.set(key, entry);
  }

  const processed = new Map<string, number>();
  for (const request of requests) for (const id of new Set(request.processing.filter(span => span.note !== 'read routed to replica').map(span => span.component))) processed.set(id, (processed.get(id) ?? 0) + 1);
  for (const job of result.jobs) for (const id of new Set(job.processing.map(span => span.component))) processed.set(id, (processed.get(id) ?? 0) + 1);

  // Busy time inside the traffic window, per component, from every processing span (requests and jobs).
  const trafficMs = input.trafficDurationMs ?? input.durationMs;
  const busyInWindow = new Map<string, number>();
  for (const record of [...requests, ...result.jobs]) for (const span of record.processing) {
    const overlap = Math.min(span.end, trafficMs) - Math.max(span.start, 0);
    if (overlap > 0) busyInWindow.set(span.component, (busyInWindow.get(span.component) ?? 0) + overlap);
  }
  const components = result.components.filter(metric => !TELEMETRY_KINDS.has(metric.kind) && metric.kind !== 'deadLetterQueue').map(metric => ({
    id: metric.id, label: labelOf(metric.id), kind: metric.kind,
    utilization: metric.capacity > 0 && trafficMs > 0 ? Math.min(1, (busyInWindow.get(metric.id) ?? 0) / (metric.capacity * trafficMs)) : 0,
    runUtilization: metric.utilization, capacity: metric.capacity, maxQueueDepth: metric.maxQueueDepth,
    averageWaitMs: metric.averageWaitMs, completed: metric.completed, rejected: metric.rejected, requestsProcessed: processed.get(metric.id) ?? 0,
  })).sort((a, b) => b.utilization - a.utilization || a.id.localeCompare(b.id));

  const successes = requests.filter(request => request.status === 'completed');
  const time = new Map<string, { waitMs: number; processingMs: number }>();
  for (const request of successes) for (const span of request.processing) {
    const entry = time.get(span.component) ?? { waitMs: 0, processingMs: 0 };
    entry.waitMs += span.wait; entry.processingMs += span.end - span.start; time.set(span.component, entry);
  }
  const timeShare = [...time].map(([id, entry]) => ({ id, label: labelOf(id), waitMs: successes.length ? entry.waitMs / successes.length : 0, processingMs: successes.length ? entry.processingMs / successes.length : 0 }))
    .sort((a, b) => (b.waitMs + b.processingMs) - (a.waitMs + a.processingMs) || a.id.localeCompare(b.id));

  const cache = input.nodes.filter(node => CACHE_KINDS.has(node.kind)).map(node => {
    const lookups = requests.filter(request => visits(request, node.id));
    const hits = lookups.filter(request => request.cache === 'hit' && request.processing[request.processing.length - 1]?.component === node.id).length;
    return { id: node.id, label: labelOf(node.id), lookups: lookups.length, hits };
  });

  const deadLettered = result.components.filter(metric => metric.kind === 'deadLetterQueue').reduce((sum, metric) => sum + (metric.counters?.deadLettered ?? 0), 0);
  return {
    complete: !result.stoppedEarly,
    offeredRps: input.offeredRps ?? 0, offeredRequests: result.offeredRequests, simulatedRequests: requests.length,
    completedRequests: result.completedRequests, failedRequests: result.failedRequests, successThroughput: result.successfulThroughput,
    successPct: result.offeredRequests ? result.completedRequests / result.offeredRequests * 100 : 0, errorRatePct: result.errorRate * 100,
    p50: result.latency.p50, p95: result.latency.p95, p99: result.latency.p99,
    failures: [...failures.values()].sort((a, b) => b.count - a.count || a.componentId.localeCompare(b.componentId)),
    components, timeShare, cache,
    jobs: { total: result.jobs.length, completed: result.jobs.filter(job => job.status === 'completed').length, failed: result.jobs.filter(job => job.status === 'failed').length, pending: result.jobs.filter(job => job.status === 'pending').length, deadLettered },
    computeSlots: computeSlots(input.nodes),
    findings: diagnose(result, input, labelOf),
  };
}

