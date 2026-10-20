import { byKind, type Kind } from '../app/catalog';
import type { ArchitectureSnapshot, SnapshotNode } from '../challenges/attempts';
import { deepFreeze } from '../challenges/grading';
import type { Fault, SimulationInput } from '../simulation/engine';
import { labInput, type LabBenchmark, type LabMeasurements } from '../lab/measure';

/**
 * Guided, controlled experiments shared by lessons and the Playground.
 *
 * Every variant of a template runs with the same benchmark and seed. A template may declare one workload
 * variable instead (a different traffic level or an injected outage), and says so in `variable`. Conclusions
 * are computed from measurements only; `theory` is explanation that the run does not prove, and `limitations`
 * lists what the simulator does not model. Only effects the engine actually simulates are offered here.
 */
export type ExperimentMetric = {
  id: string; label: string; unit: string;
  /** Whether a lower value is better, for highlighting; null when neither direction is "better". */
  lowerIsBetter: boolean | null;
  read: (measurements: LabMeasurements) => number | null;
};
export type ExperimentVariant = {
  id: string; name: string; description: string; architecture: ArchitectureSnapshot;
  /** Workload overrides; only allowed when the template's variable is the workload. */
  rps?: number; faults?: Fault[];
};
export type VariantResult = { variantId: string; measurements: LabMeasurements | null; error?: string };
export type ExperimentConclusion = { status: 'supports' | 'does-not-support' | 'inconclusive'; summary: string; evidence: string[] };
export type ExperimentTemplate = {
  id: string; title: string;
  /** The question being investigated. */
  question: string; hypothesis: string;
  /** What is held constant across variants. */
  controlled: string[];
  /** The one thing that differs between variants. */
  variable: string;
  benchmark: LabBenchmark;
  variants: ExperimentVariant[];
  metrics: ExperimentMetric[];
  analyze: (results: VariantResult[]) => ExperimentConclusion;
  /** Explanation of why the result happens. Not measured. */
  theory: string[];
  /** What this experiment cannot show, because the simulator does not model it. */
  limitations: string[];
  /** Lessons and components this experiment illustrates. */
  lessons: string[]; components: Kind[];
};

// ── Building blocks ─────────────────────────────────────────────────────────────
type NodeSpec = [id: string, kind: Kind, label: string, x: number, y: number, config?: Record<string, string>];
const node = ([id, kind, label, x, y, config]: NodeSpec): SnapshotNode => ({ id, kind, label, config: { ...byKind[kind].defaults, ...config }, position: { x, y } });
export const architecture = (nodes: NodeSpec[], edges: Array<[string, string]>): ArchitectureSnapshot =>
  deepFreeze({ schema: 'flowzen.architecture', version: 1, nodes: nodes.map(node), edges: edges.map(([source, target]) => ({ source, target })) });

const pct = (value: number) => `${(Math.round(value * 10) / 10).toLocaleString()}%`;
const num = (value: number | null) => value === null ? '—' : (Math.round(value * 10) / 10).toLocaleString();
const component = (m: LabMeasurements, id: string) => m.components.find(entry => entry.id === id);
/** Share of simulated requests (and jobs) whose trace was processed at a component, as a percentage. */
const reachShare = (m: LabMeasurements, id: string) => { const entry = component(m, id); return entry && m.simulatedRequests ? entry.requestsProcessed / m.simulatedRequests * 100 : entry ? 0 : null; };
const busiest = (m: LabMeasurements) => m.components.find(entry => entry.kind !== 'client');

export const METRICS = {
  p50: { id: 'p50', label: 'Latency p50', unit: 'ms', lowerIsBetter: true, read: m => m.p50 },
  p95: { id: 'p95', label: 'Latency p95', unit: 'ms', lowerIsBetter: true, read: m => m.p95 },
  p99: { id: 'p99', label: 'Latency p99', unit: 'ms', lowerIsBetter: true, read: m => m.p99 },
  throughput: { id: 'throughput', label: 'Successful throughput', unit: 'req/s', lowerIsBetter: false, read: m => m.successThroughput },
  success: { id: 'success', label: 'Offered requests that succeeded', unit: '%', lowerIsBetter: false, read: m => m.successPct },
  errors: { id: 'errors', label: 'Error rate', unit: '%', lowerIsBetter: true, read: m => m.errorRatePct },
  slots: { id: 'slots', label: 'Compute slots', unit: 'slots', lowerIsBetter: null, read: m => m.computeSlots },
  busiest: { id: 'busiest', label: 'Busiest component (traffic window)', unit: '%', lowerIsBetter: true, read: m => { const top = busiest(m); return top ? top.utilization * 100 : null; } },
} satisfies Record<string, ExperimentMetric>;
const utilization = (id: string, label: string): ExperimentMetric => ({ id: `util-${id}`, label: `${label} busy`, unit: '%', lowerIsBetter: true, read: m => { const entry = component(m, id); return entry ? entry.utilization * 100 : null; } });
const reach = (id: string, label: string): ExperimentMetric => ({ id: `reach-${id}`, label: `Share of requests processed by ${label}`, unit: '%', lowerIsBetter: true, read: m => reachShare(m, id) });
const peakQueue = (id: string, label: string): ExperimentMetric => ({ id: `queue-${id}`, label: `Peak backlog at ${label}`, unit: 'items', lowerIsBetter: true, read: m => component(m, id)?.maxQueueDepth ?? null });
const jobs = {
  completed: { id: 'jobs-completed', label: 'Background jobs completed', unit: 'jobs', lowerIsBetter: false, read: m => m.jobs.total ? m.jobs.completed : null },
  pending: { id: 'jobs-pending', label: 'Jobs still pending at the end', unit: 'jobs', lowerIsBetter: true, read: m => m.jobs.total ? m.jobs.pending : null },
} satisfies Record<string, ExperimentMetric>;
const failuresAt = (id: string, label: string): ExperimentMetric => ({ id: `fail-${id}`, label: `Failures at ${label}`, unit: 'requests', lowerIsBetter: true, read: m => m.failures.filter(entry => entry.componentId === id).reduce((sum, entry) => sum + entry.count, 0) });

/** Measurements by variant id, or an inconclusive outcome naming what is missing. */
function measured(results: VariantResult[], ids: string[]): Record<string, LabMeasurements> | ExperimentConclusion {
  const out: Record<string, LabMeasurements> = {};
  for (const id of ids) {
    const result = results.find(entry => entry.variantId === id);
    if (!result?.measurements) return { status: 'inconclusive', summary: `Variant “${id}” has no measurement${result?.error ? ` (${result.error})` : ''}. Run every variant.`, evidence: [] };
    if (!result.measurements.complete) return { status: 'inconclusive', summary: `Variant “${id}” hit the simulator’s event limit, so its run is incomplete and is not used.`, evidence: [] };
    out[id] = result.measurements;
  }
  return out;
}
const isConclusion = (value: unknown): value is ExperimentConclusion => typeof value === 'object' && value !== null && 'status' in value && 'summary' in value;

// ── Templates ───────────────────────────────────────────────────────────────────
const STANDARD: Omit<LabBenchmark, 'rps'> = { durationMs: 10_000, drainMs: 2000, seed: 42, faults: [] };

const cacheTemplate: ExperimentTemplate = (() => {
  const base: NodeSpec[] = [['users', 'client', 'Product Pages', 0, 120], ['api', 'server', 'Catalog API', 286, 120, { instances: '32', processingLatencyMs: '10' }], ['db', 'database', 'Products DB', 1000, 120, { concurrency: '10', queryLatencyMs: '18' }]];
  return {
    id: 'cache-vs-database', title: 'Direct database access vs a cache vs a distributed cache',
    question: 'How does a cache in front of the database change database load, latency and success, and when does a single cache node become the limit?',
    hypothesis: 'Both caches cut the share of requests that reach the database, so the database stops being the bottleneck. A single cache node has its own capacity limit; a distributed cache spreads lookups across nodes and keeps up.',
    controlled: ['2,400 req/s for 10 s, then 2 s to drain; seed 42', 'Catalog API: 32 instances, 10 ms per request', 'Products DB: 10 connections, 18 ms per query (≈ 555 queries/s)', 'Both caches: 85% hit ratio'],
    variable: 'What sits between the API and the database: nothing, one cache node (4 slots, 2 ms), or a 3-node distributed cache (12 slots, 1 ms).',
    benchmark: { ...STANDARD, rps: 2400 },
    variants: [
      { id: 'direct', name: 'Direct database', description: 'Every request queries the database.', architecture: architecture(base, [['users', 'api'], ['api', 'db']]) },
      { id: 'single', name: 'Single cache node', description: 'One cache node with 4 connection slots and 2 ms lookups.', architecture: architecture([...base, ['cache', 'cache', 'Cache', 640, 120, { hitRatio: '85', concurrency: '4', lookupLatencyMs: '2' }]], [['users', 'api'], ['api', 'cache'], ['cache', 'db']]) },
      { id: 'distributed', name: 'Distributed cache', description: 'Three cache nodes with 4 slots each and 1 ms lookups.', architecture: architecture([...base, ['cache', 'distributedCache', 'Distributed Cache', 640, 120, { hitRatio: '85', nodes: '3', connectionsPerNode: '4', lookupLatencyMs: '1' }]], [['users', 'api'], ['api', 'cache'], ['cache', 'db']]) },
    ],
    metrics: [METRICS.p50, METRICS.p95, METRICS.success, METRICS.throughput, reach('db', 'Products DB'), utilization('db', 'Products DB'), utilization('cache', 'Cache'), METRICS.busiest],
    analyze(results) {
      const m = measured(results, ['direct', 'single', 'distributed']); if (isConclusion(m)) return m;
      const dbUtil = (id: string) => (component(m[id], 'db')?.utilization ?? 0) * 100;
      const cacheUtil = (id: string) => (component(m[id], 'cache')?.utilization ?? 0) * 100;
      const hitShare = (id: string) => { const entry = m[id].cache.find(item => item.id === 'cache'); return entry && entry.lookups ? entry.hits / entry.lookups * 100 : 0; };
      const evidence = [
        `Products DB busy: ${pct(dbUtil('direct'))} direct, ${pct(dbUtil('single'))} with one cache node, ${pct(dbUtil('distributed'))} with the distributed cache.`,
        `Cache hits: ${pct(hitShare('single'))} of lookups on the single node, ${pct(hitShare('distributed'))} on the distributed cache.`,
        `Offered requests that succeeded: ${pct(m.direct.successPct)}, ${pct(m.single.successPct)}, ${pct(m.distributed.successPct)}.`,
        `p95 latency: ${num(m.direct.p95)} ms, ${num(m.single.p95)} ms, ${num(m.distributed.p95)} ms (successful requests only).`,
        `Cache busy: one node ${pct(cacheUtil('single'))}, distributed ${pct(cacheUtil('distributed'))}.`,
      ];
      const offloaded = hitShare('single') > 50 && hitShare('distributed') > 50 && dbUtil('distributed') < dbUtil('direct');
      if (!offloaded) return { status: 'does-not-support', summary: 'The caches did not take load off the database. Check that requests pass through the cache before the database and that the hit ratio is above zero.', evidence };
      const singleLimited = cacheUtil('single') >= 85 && m.single.successPct < m.distributed.successPct;
      return {
        status: 'supports', evidence,
        summary: singleLimited
          ? `Both caches answered most lookups, so Products DB was no longer saturated (${pct(dbUtil('direct'))} busy direct, ${pct(dbUtil('distributed'))} behind the distributed cache). But the single cache node was ${pct(cacheUtil('single'))} busy and became the new bottleneck: only ${pct(m.single.successPct)} of requests succeeded, against ${pct(m.distributed.successPct)} with the distributed cache.`
          : `Both caches answered most lookups, and success rose from ${pct(m.direct.successPct)} to ${pct(m.distributed.successPct)}.`,
      };
    },
    theory: [
      'Without a cache, the database must serve 2,400 queries/s with capacity for about 555, so requests queue and then time out.',
      'An 85% hit ratio means only about 15% of requests (≈ 360/s) miss and reach the database, which it can serve.',
      'A cache is also a server with finite capacity. One node with 4 slots at 2 ms can do at most ≈ 2,000 lookups/s, less than the 2,400 offered, so the bottleneck moves from the database to the cache.',
      'A distributed cache partitions keys across nodes. Capacity grows with the number of nodes, at the cost of more machines to run and of keys moving when nodes are added or removed.',
    ],
    limitations: [
      'The hit ratio is a fixed setting. TTLs, eviction, cache warm-up and changing access patterns are not simulated, so this experiment cannot show a cold cache or a stampede.',
      'Staleness is not simulated: cached reads never return out-of-date data here, so the consistency cost of caching does not appear in the results.',
      'There is no in-process (local) cache component. A local cache lives inside each application instance, with no network hop and a separate copy per instance. The single cache node is the closest approximation, and it has a network hop that a local cache would not.',
      'Writes and invalidation are not modelled; every request is treated as a read.',
    ],
    lessons: ['why-caching'], components: ['cache', 'distributedCache', 'database'],
  };
})();

const scalingTemplate: ExperimentTemplate = (() => {
  const vertical = architecture([['users', 'client', 'Clients', 0, 120], ['big', 'server', 'Big Server', 300, 120, { instances: '16', processingLatencyMs: '40' }]], [['users', 'big']]);
  const horizontal = architecture([
    ['users', 'client', 'Clients', 0, 120], ['lb', 'loadBalancer', 'Load Balancer', 286, 120],
    ['s1', 'server', 'Server 1', 572, -120, { instances: '4', processingLatencyMs: '40' }], ['s2', 'server', 'Server 2', 572, 40, { instances: '4', processingLatencyMs: '40' }],
    ['s3', 'server', 'Server 3', 572, 200, { instances: '4', processingLatencyMs: '40' }], ['s4', 'server', 'Server 4', 572, 360, { instances: '4', processingLatencyMs: '40' }],
  ], [['users', 'lb'], ['lb', 's1'], ['lb', 's2'], ['lb', 's3'], ['lb', 's4']]);
  const outage = (nodeId: string): Fault[] => [{ nodeId, startMs: 3000, endMs: 6000 }];
  return {
    id: 'vertical-vs-horizontal', title: 'One big server vs four smaller servers',
    question: 'With the same total capacity, what changes between scaling up (one bigger machine) and scaling out (several machines behind a load balancer)?',
    hypothesis: 'While everything is healthy, both arrangements perform almost the same, because total capacity is the same. When one machine fails, the single big server loses all capacity, while four servers lose only a quarter.',
    controlled: ['300 req/s for 10 s, then 2 s to drain; seed 42', '16 request slots in total, 40 ms of work per request', 'Outage variants: one machine fails from 3 s to 6 s'],
    variable: 'How the 16 slots are arranged (1 × 16 or 4 × 4 behind a load balancer), and whether one machine has an outage.',
    benchmark: { ...STANDARD, rps: 300 },
    variants: [
      { id: 'vertical', name: 'Vertical: 1 × 16', description: 'One server with 16 instances.', architecture: vertical },
      { id: 'horizontal', name: 'Horizontal: 4 × 4', description: 'Four servers with 4 instances each behind a load balancer.', architecture: horizontal },
      { id: 'vertical-outage', name: '1 × 16, one machine fails', description: 'The only server is down from 3 s to 6 s.', architecture: vertical, faults: outage('big') },
      { id: 'horizontal-outage', name: '4 × 4, one machine fails', description: 'Server 1 is down from 3 s to 6 s.', architecture: horizontal, faults: outage('s1') },
    ],
    metrics: [METRICS.p50, METRICS.p95, METRICS.success, METRICS.errors, METRICS.slots, METRICS.busiest],
    analyze(results) {
      const m = measured(results, ['vertical', 'horizontal', 'vertical-outage', 'horizontal-outage']); if (isConclusion(m)) return m;
      const evidence = [
        `Healthy: ${pct(m.vertical.successPct)} vs ${pct(m.horizontal.successPct)} succeeded; p95 ${num(m.vertical.p95)} vs ${num(m.horizontal.p95)} ms.`,
        `With one machine down for 3 s: ${pct(m['vertical-outage'].errorRatePct)} vs ${pct(m['horizontal-outage'].errorRatePct)} of requests failed.`,
        `Compute slots: ${m.vertical.computeSlots} in both arrangements.`,
      ];
      const healthySimilar = Math.abs(m.vertical.successPct - m.horizontal.successPct) < 1;
      const blastRadius = m['horizontal-outage'].errorRatePct < m['vertical-outage'].errorRatePct / 2;
      if (healthySimilar && blastRadius) return { status: 'supports', evidence, summary: `With equal capacity the two arrangements served the healthy workload alike. During the outage the single server failed ${pct(m['vertical-outage'].errorRatePct)} of all requests, while losing one of four servers failed ${pct(m['horizontal-outage'].errorRatePct)}: a smaller blast radius.` };
      return { status: 'does-not-support', evidence, summary: 'The measured results do not match the hypothesis. Check the variants for changes to capacity or the outage window.' };
    },
    theory: [
      'Capacity depends on how many requests can be processed at once, not on how the slots are packaged. Little’s law: 300 req/s × 0.04 s = 12 busy slots on average, out of 16.',
      'The load balancer adds about 1 ms per request, which is why horizontal p95 is slightly higher.',
      'Scaling out turns one failure domain into several. Losing one of four machines removes 25% of capacity instead of 100%.',
      'Vertical scaling is simpler (no load balancer, no distribution) but is limited by the largest machine you can buy and is a single point of failure.',
    ],
    limitations: [
      'The load balancer has no health checks in the simulator: it keeps sending a quarter of requests to the failed server. A real load balancer would detect the failure and route around it after a few seconds, failing even fewer requests.',
      'Machine prices, licensing and per-machine overheads are not modelled, so cost is not compared.',
      'A bigger machine is modelled as more parallel slots with the same per-request time. Real hardware also changes per-request speed (faster CPUs, more memory) and has limits on how many cores one process uses well.',
    ],
    lessons: ['horizontal-vertical'], components: ['server', 'loadBalancer'],
  };
})();

const bottleneckTemplate: ExperimentTemplate = (() => {
  const servers = (count: number): NodeSpec[] => Array.from({ length: count }, (_, i) => [`app-${i + 1}`, 'server', `App Server ${i + 1}`, 572, i * 150 - 60, { instances: '4', processingLatencyMs: '20' }] as NodeSpec);
  const build = (count: number, connections: string) => architecture(
    [['users', 'client', 'Users', 0, 120], ['lb', 'loadBalancer', 'Load Balancer', 286, 120], ...servers(count), ['db', 'database', 'Orders DB', 900, 120, { concurrency: connections, queryLatencyMs: '18' }]],
    [['users', 'lb'], ...servers(count).map(([id]) => ['lb', id] as [string, string]), ...servers(count).map(([id]) => [id, 'db'] as [string, string])],
  );
  return {
    id: 'find-the-bottleneck', title: 'Finding the bottleneck: servers or database?',
    question: 'If a system is overloaded, does adding application servers fix it?',
    hypothesis: 'Adding servers raises throughput only while the servers are the bottleneck. Once the database is the busiest component, more servers do not help, and the database must get more capacity.',
    controlled: ['600 req/s for 10 s, then 2 s to drain; seed 42', 'Each server: 4 instances, 20 ms per request (≈ 200 req/s)', 'Each query: 18 ms'],
    variable: 'Number of servers (2 or 4) and database connections (8 or 16).',
    benchmark: { ...STANDARD, rps: 600 },
    variants: [
      { id: 'two', name: '2 servers, 8 DB connections', description: '≈ 400 req/s of compute, ≈ 444 queries/s of database capacity.', architecture: build(2, '8') },
      { id: 'four', name: '4 servers, 8 DB connections', description: 'Compute doubled; the database is unchanged.', architecture: build(4, '8') },
      { id: 'four-db', name: '4 servers, 16 DB connections', description: 'Compute doubled and database capacity doubled.', architecture: build(4, '16') },
    ],
    metrics: [METRICS.throughput, METRICS.success, METRICS.p95, utilization('app-1', 'App Server 1'), utilization('db', 'Orders DB'), METRICS.busiest],
    analyze(results) {
      const m = measured(results, ['two', 'four', 'four-db']); if (isConclusion(m)) return m;
      const top = (id: string) => busiest(m[id]);
      const evidence = ['two', 'four', 'four-db'].map(id => `${({ two: '2 servers, 8 conns', four: '4 servers, 8 conns', 'four-db': '4 servers, 16 conns' } as Record<string, string>)[id]}: ${num(m[id].successThroughput)} req/s succeeded; busiest ${top(id)?.label ?? '—'} at ${pct((top(id)?.utilization ?? 0) * 100)}.`);
      const dbLimited = top('four')?.id === 'db';
      const fixedByDb = m['four-db'].successThroughput > m.four.successThroughput * 1.1;
      if (dbLimited && fixedByDb) return { status: 'supports', evidence, summary: `Doubling servers moved the bottleneck to Orders DB (${pct((top('four')?.utilization ?? 0) * 100)} busy), so throughput stayed near the database’s limit (${num(m.four.successThroughput)} req/s). Only adding database capacity raised it to ${num(m['four-db'].successThroughput)} req/s.` };
      return { status: 'does-not-support', evidence, summary: 'The busiest component did not behave as predicted. Compare the busiest component in each variant.' };
    },
    theory: [
      'A system’s throughput is limited by its most constrained resource. Each component’s capacity is slots ÷ time per request: 4 ÷ 0.02 s = 200 req/s per server, 8 ÷ 0.018 s ≈ 444 queries/s for the database.',
      'With 2 servers, compute (≈ 400 req/s) is the limit. With 4 servers, compute rises to ≈ 800 req/s, but the database (≈ 444/s) is now lower, so it becomes the limit.',
      'This is why you measure before scaling: the busiest component, not the most visible one, decides where capacity is needed.',
    ],
    limitations: [
      'Database connections are modelled as parallel slots with a fixed query time. Real databases slow down per query under contention (locks, disk, CPU), so doubling connections rarely doubles throughput.',
      'Arrivals are evenly spaced, so no queue forms until a component is fully busy. Real traffic is bursty and queues form earlier.',
    ],
    lessons: ['bottlenecks'], components: ['server', 'loadBalancer', 'database'],
  };
})();

const loadTemplate: ExperimentTemplate = (() => {
  const arch = architecture([['users', 'client', 'Users', 0, 120], ['api', 'server', 'API', 300, 120, { instances: '8', processingLatencyMs: '20' }]], [['users', 'api']]);
  const levels = [100, 200, 300, 380, 450, 600];
  return {
    id: 'latency-under-load', title: 'Latency and throughput as traffic grows',
    question: 'What happens to latency, throughput and errors as offered traffic approaches and exceeds a service’s capacity?',
    hypothesis: 'Below capacity, throughput follows offered traffic and latency stays near the processing time. Above capacity, throughput stops growing, requests queue, and latency and errors rise.',
    controlled: ['One API: 8 instances, 20 ms per request (capacity ≈ 400 req/s)', '10 s of traffic, then 2 s to drain; seed 42'],
    variable: 'Offered traffic: 100, 200, 300, 380, 450 and 600 req/s.',
    benchmark: { ...STANDARD, rps: 100 },
    variants: levels.map(rps => ({ id: `rps-${rps}`, name: `${rps} req/s`, description: `${rps} requests per second offered.`, architecture: arch, rps })),
    metrics: [METRICS.throughput, METRICS.success, METRICS.p50, METRICS.p95, METRICS.p99, utilization('api', 'API')],
    analyze(results) {
      const m = measured(results, levels.map(rps => `rps-${rps}`)); if (isConclusion(m)) return m;
      const at = (rps: number) => m[`rps-${rps}`];
      const evidence = levels.map(rps => `${rps} req/s offered: ${num(at(rps).successThroughput)} succeeded/s, p95 ${num(at(rps).p95)} ms, ${pct(at(rps).errorRatePct)} errors.`);
      const flatBelow = (at(380).p95 ?? Infinity) <= (at(100).p95 ?? 0) + 2;
      const plateau = at(600).successThroughput < 600 * 0.8 && at(450).successThroughput < 450;
      const degrades = (at(450).p95 ?? 0) > (at(380).p95 ?? 0) * 2 || at(450).errorRatePct > 0;
      if (flatBelow && plateau && degrades) return { status: 'supports', evidence, summary: `Up to 380 req/s, latency stayed at about ${num(at(100).p95)} ms and throughput matched traffic. Above ≈ 400 req/s, throughput levelled off near capacity while latency and errors jumped: at 600 req/s only ${num(at(600).successThroughput)} req/s succeeded.` };
      return { status: 'does-not-support', evidence, summary: 'The measured curve does not show the predicted plateau. Check the API capacity.' };
    },
    theory: [
      'Throughput can never exceed capacity: 8 slots ÷ 0.02 s = 400 req/s. Beyond that, the excess waits in a queue, and once the queue limit or the queue timeout is reached, requests fail.',
      'Little’s law links them: requests in the system = throughput × time in the system. When throughput is capped, extra arrivals can only increase waiting time.',
      'In real systems, arrivals are random, so queues form well before 100% utilization. For a simple single-server queue, waiting time grows like ρ ÷ (1 − ρ): at 80% busy, waiting is 4× the service time; at 90%, 9×. This is why teams target 60–80% utilization, not 100%.',
    ],
    limitations: [
      'The simulator sends requests at evenly spaced intervals and every request takes exactly the configured time. With no randomness, no queue forms until utilization reaches 100%, so you see a sharp cliff instead of the gradual rise real systems show. The curve described in the theory section is not simulated.',
      'Latency percentiles cover successful requests only. At very high load most failures are fast rejections, so read p95 together with the success rate.',
    ],
    lessons: ['performance-metrics'], components: ['server'],
  };
})();

const asyncTemplate: ExperimentTemplate = (() => {
  const sync = architecture([['users', 'client', 'Uploaders', 0, 120], ['api', 'server', 'Upload API', 300, 120, { instances: '20', processingLatencyMs: '5' }], ['work', 'server', 'Thumbnailer', 640, 120, { instances: '20', processingLatencyMs: '80' }]], [['users', 'api'], ['api', 'work']]);
  const asyncArch = architecture([
    ['users', 'client', 'Uploaders', 0, 120], ['api', 'server', 'Upload API', 300, 120, { instances: '20', processingLatencyMs: '5' }],
    ['queue', 'queue', 'Jobs Queue', 600, 120, { concurrency: '20', queueLimit: '5000' }], ['work', 'worker', 'Thumbnailer', 900, 120, { concurrency: '20', processingRate: '12.5', queueLimit: '5000', timeoutMs: '20000' }],
  ], [['users', 'api'], ['api', 'queue'], ['queue', 'work']]);
  return {
    id: 'sync-vs-async', title: 'Synchronous call vs queue and worker',
    question: 'What changes for the user and for the system when slow work moves from a synchronous call to a queue processed by workers?',
    hypothesis: 'With a queue, the request completes as soon as the job is enqueued, so request latency drops to a few milliseconds even when work arrives faster than workers process it. The cost is that the work finishes later, and a backlog builds that must drain.',
    controlled: ['300 uploads/s for 10 s, then 10 s to drain; seed 42', 'Upload API: 20 instances, 5 ms', 'Thumbnail work: 20 slots, 80 ms each (≈ 250 jobs/s)'],
    variable: 'Whether the API calls the thumbnailer directly or enqueues a job for a worker.',
    benchmark: { ...STANDARD, rps: 300, drainMs: 10_000 },
    variants: [
      { id: 'sync', name: 'Synchronous', description: 'The API waits for the thumbnail to be made.', architecture: sync },
      { id: 'async', name: 'Queue + worker', description: 'The API enqueues a job and responds; a worker makes the thumbnail.', architecture: asyncArch },
    ],
    metrics: [METRICS.p50, METRICS.p95, METRICS.success, METRICS.errors, jobs.completed, jobs.pending, peakQueue('work', 'Thumbnailer')],
    analyze(results) {
      const m = measured(results, ['sync', 'async']); if (isConclusion(m)) return m;
      const worker = component(m.async, 'work');
      const evidence = [
        `Request p95: ${num(m.sync.p95)} ms synchronous, ${num(m.async.p95)} ms with a queue.`,
        `Offered requests that succeeded: ${pct(m.sync.successPct)} vs ${pct(m.async.successPct)}.`,
        `Background jobs: ${m.async.jobs.completed.toLocaleString()} completed, ${m.async.jobs.pending.toLocaleString()} pending at the end; peak backlog ${worker?.maxQueueDepth.toLocaleString() ?? '—'}, average wait ${num(worker?.averageWaitMs ?? null)} ms.`,
      ];
      const faster = (m.async.p95 ?? Infinity) < (m.sync.p95 ?? 0) / 2;
      const backlog = (worker?.maxQueueDepth ?? 0) > 0;
      if (faster && backlog) return { status: 'supports', evidence, summary: `The queue made requests fast (${num(m.async.p95)} ms p95) and accepted ${pct(m.async.successPct)} of uploads, but the work itself waited: the backlog peaked at ${worker!.maxQueueDepth.toLocaleString()} jobs with an average wait of ${num(worker!.averageWaitMs)} ms.` };
      return { status: 'does-not-support', evidence, summary: 'The queue did not lower request latency or no backlog formed. Check that the API connects to the queue and the queue to the worker.' };
    },
    theory: [
      'Synchronously, the user waits for the slowest step, and every step must have capacity for the peak rate at the same moment. Work above the thumbnailer’s ≈ 250 jobs/s queues inside the request path and times out.',
      'With a queue, the producer and the consumer are decoupled in time. The queue absorbs the difference between arrival rate and processing rate; the backlog grows at ≈ 300 − 250 = 50 jobs/s during the burst and drains afterwards.',
      'The trade-off is that the user no longer gets the result in the response. You need a way to report completion (polling, notifications), retries, idempotent jobs and monitoring of backlog age.',
    ],
    limitations: [
      'Message durability, broker failure and delivery semantics beyond the configured redelivery count are not modelled.',
      'The simulated queue has no ordering guarantees to observe, and the worker never processes a job twice unless it fails, so duplicate handling (idempotency) cannot be demonstrated here.',
    ],
    lessons: ['sync-async'], components: ['queue', 'worker', 'server'],
  };
})();

const workersTemplate: ExperimentTemplate = (() => {
  const build = (slots: string) => architecture([
    ['events', 'client', 'Order Events', 0, 120], ['queue', 'queue', 'Orders Queue', 286, 120, { concurrency: '20', queueLimit: '10000' }],
    ['worker', 'worker', 'Fulfilment Worker', 572, 120, { concurrency: slots, processingRate: '20', queueLimit: '10000', timeoutMs: '60000' }],
  ], [['events', 'queue'], ['queue', 'worker']]);
  return {
    id: 'worker-count', title: 'How many workers does a queue need?',
    question: 'How does the number of worker slots change backlog, waiting time and whether the work finishes?',
    hypothesis: 'When worker capacity is below the arrival rate, the backlog grows for as long as traffic lasts. Enough workers keep the backlog near zero; extra workers beyond that add cost without reducing waiting time.',
    controlled: ['200 events/s for 10 s, then 10 s to drain; seed 42', 'Each worker slot processes 20 jobs/s (50 ms per job)'],
    variable: 'Worker slots: 5, 10, 15 and 20 (100, 200, 300 and 400 jobs/s).',
    benchmark: { ...STANDARD, rps: 200, drainMs: 10_000 },
    variants: ['5', '10', '15', '20'].map(slots => ({ id: `w${slots}`, name: `${slots} slots`, description: `${slots} slots × 20 jobs/s = ${Number(slots) * 20} jobs/s.`, architecture: build(slots) })),
    metrics: [jobs.completed, jobs.pending, peakQueue('worker', 'Fulfilment Worker'), utilization('worker', 'Fulfilment Worker'), METRICS.p95],
    analyze(results) {
      const m = measured(results, ['w5', 'w10', 'w15', 'w20']); if (isConclusion(m)) return m;
      const worker = (id: string) => component(m[id], 'worker');
      const evidence = ['w5', 'w10', 'w15', 'w20'].map(id => `${id.slice(1)} slots: peak backlog ${worker(id)?.maxQueueDepth.toLocaleString() ?? '—'}, average wait ${num(worker(id)?.averageWaitMs ?? null)} ms, ${m[id].jobs.pending.toLocaleString()} pending at the end.`);
      const under = (worker('w5')?.maxQueueDepth ?? 0) > 100;
      const enough = (worker('w10')?.maxQueueDepth ?? Infinity) <= 5;
      const diminishing = Math.abs((worker('w20')?.averageWaitMs ?? 0) - (worker('w10')?.averageWaitMs ?? 0)) < 5;
      if (under && enough && diminishing) return { status: 'supports', evidence, summary: `With 5 slots (100 jobs/s for 200 arriving) the backlog grew to ${worker('w5')!.maxQueueDepth.toLocaleString()} jobs, and the average job waited ${num(worker('w5')!.averageWaitMs)} ms. From 10 slots on no backlog formed, so 15 and 20 slots did not shorten waiting at all: the extra slots sat idle (${pct((worker('w20')?.utilization ?? 0) * 100)} busy with 20). Exactly matching capacity was enough only because simulated arrivals are perfectly regular; see the limitations.` };
      return { status: 'does-not-support', evidence, summary: 'The backlog did not follow worker capacity as predicted.' };
    },
    theory: [
      'A queue is stable only if the long-run processing rate exceeds the arrival rate. Below that, the backlog grows by (arrival rate − processing rate) every second.',
      'At exactly equal rates there is no spare capacity to drain any backlog that does form, so real systems need headroom.',
      'Beyond the arrival rate, more workers only shorten recovery from bursts; in steady state they sit idle.',
    ],
    limitations: [
      'Arrivals and processing are perfectly regular in the simulator, so with 10 slots (exactly 200 jobs/s) no backlog forms. With real, random arrivals a system at 100% utilization has an unbounded, growing queue.',
      'Worker autoscaling on queue depth is not modelled.',
    ],
    lessons: ['sync-async'], components: ['queue', 'worker'],
  };
})();

const rateLimitTemplate: ExperimentTemplate = (() => {
  const base: NodeSpec[] = [['users', 'client', 'Shoppers', 0, 120], ['api', 'server', 'Payments API', 600, 120, { instances: '40', processingLatencyMs: '5' }], ['ledger', 'database', 'Ledger', 900, 120, { concurrency: '10', queryLatencyMs: '20' }]];
  return {
    id: 'rate-limiting', title: 'Rate limiting on vs off under overload',
    question: 'When traffic exceeds what the database can take, where do failures happen and how slow are the requests that succeed?',
    hypothesis: 'Without a limit, excess requests pile up at the database and fail slowly (timeouts) while successful requests wait. With a rate limiter at the edge, excess requests are rejected immediately and admitted requests stay fast.',
    controlled: ['800 req/s for 10 s, then 2 s to drain; seed 42', 'Ledger: 10 connections, 20 ms (≈ 500 queries/s)'],
    variable: 'A token-bucket rate limiter at 450 req/s (burst 20) in front of the API, or none.',
    benchmark: { ...STANDARD, rps: 800 },
    variants: [
      { id: 'off', name: 'No rate limiter', description: 'Every request reaches the database.', architecture: architecture(base, [['users', 'api'], ['api', 'ledger']]) },
      { id: 'on', name: 'Rate limiter at 450 req/s', description: 'Requests above 450/s are rejected at the edge.', architecture: architecture([...base, ['limiter', 'rateLimiter', 'Rate Limiter', 300, 120, { ratePerSecond: '450', burst: '20' }]], [['users', 'limiter'], ['limiter', 'api'], ['api', 'ledger']]) },
    ],
    metrics: [METRICS.p95, METRICS.p99, METRICS.success, METRICS.throughput, peakQueue('ledger', 'Ledger'), failuresAt('ledger', 'Ledger'), failuresAt('limiter', 'Rate Limiter')],
    analyze(results) {
      const m = measured(results, ['off', 'on']); if (isConclusion(m)) return m;
      const ledgerFail = (id: string) => m[id].failures.filter(entry => entry.componentId === 'ledger').reduce((sum, entry) => sum + entry.count, 0);
      const evidence = [
        `p95 of successful requests: ${num(m.off.p95)} ms without a limit, ${num(m.on.p95)} ms with one.`,
        `Failures at the Ledger: ${ledgerFail('off').toLocaleString()} vs ${ledgerFail('on').toLocaleString()}.`,
        `Successful throughput: ${num(m.off.successThroughput)} vs ${num(m.on.successThroughput)} req/s.`,
        `Peak backlog at the Ledger: ${component(m.off, 'ledger')?.maxQueueDepth.toLocaleString() ?? '—'} vs ${component(m.on, 'ledger')?.maxQueueDepth.toLocaleString() ?? '—'}.`,
      ];
      if ((m.on.p95 ?? Infinity) < (m.off.p95 ?? 0) && ledgerFail('on') < ledgerFail('off')) return { status: 'supports', evidence, summary: `The limiter moved rejection to the edge: failures at the Ledger fell from ${ledgerFail('off').toLocaleString()} to ${ledgerFail('on').toLocaleString()}, and admitted requests stayed fast (p95 ${num(m.off.p95)} → ${num(m.on.p95)} ms). Successful throughput fell from ${num(m.off.successThroughput)} to ${num(m.on.successThroughput)} req/s, because the limit (450/s) sits below the Ledger’s ≈ 500/s capacity: the safety margin has a price, and a limiter protects a dependency without adding capacity.` };
      return { status: 'does-not-support', evidence, summary: 'The limiter did not reduce failures at the Ledger or latency.' };
    },
    theory: [
      'Overload is unavoidable when demand exceeds capacity; the question is where and how requests fail. Rejecting early is cheap and fast, while timeouts deep in the system hold resources for the whole timeout.',
      'A token bucket admits a steady rate plus short bursts up to the bucket size. Set it below the capacity of the most fragile dependency.',
      'Real clients retry rejected requests; with backoff and jitter, a rate limit spreads retries out instead of amplifying the overload.',
    ],
    limitations: ['Clients never retry in the simulator, so retry storms and the benefit of Retry-After headers cannot be shown.', 'Limits are global; per-user or per-key limits are not modelled.'],
    lessons: [], components: ['rateLimiter', 'database'],
  };
})();

const breakerTemplate: ExperimentTemplate = (() => {
  const base: NodeSpec[] = [['users', 'client', 'Shoppers', 0, 120], ['api', 'server', 'Checkout API', 300, 120, { instances: '60', processingLatencyMs: '5' }], ['provider', 'server', 'Payment Provider', 900, 120, { instances: '20', processingLatencyMs: '40', timeoutMs: '1000' }]];
  const fault: Fault[] = [{ nodeId: 'provider', startMs: 2000, endMs: 7000 }];
  return {
    id: 'circuit-breaker', title: 'Circuit breaker on vs off during a dependency outage',
    question: 'When a dependency fails, does a circuit breaker change how many requests fail, or how fast they fail?',
    hypothesis: 'A circuit breaker does not make the failing dependency work. It makes callers fail fast while the dependency is down and stops sending it traffic. Because it stays open for a fixed period, it can also reject requests after the dependency has recovered.',
    controlled: ['300 req/s for 10 s, then 2 s to drain; seed 42', 'Payment Provider is down from 2 s to 7 s (scheduled outage)'],
    variable: 'A circuit breaker (opens at 50% failures over ≥ 20 requests, stays open 2 s) between the API and the provider, or none.',
    benchmark: { ...STANDARD, rps: 300, faults: fault },
    variants: [
      { id: 'off', name: 'No circuit breaker', description: 'Every request is sent to the provider, even while it is down.', architecture: architecture(base, [['users', 'api'], ['api', 'provider']]) },
      { id: 'on', name: 'Circuit breaker', description: 'The breaker fails requests immediately while open.', architecture: architecture([...base, ['breaker', 'circuitBreaker', 'Circuit Breaker', 600, 120]], [['users', 'api'], ['api', 'breaker'], ['breaker', 'provider']]) },
    ],
    metrics: [METRICS.success, METRICS.errors, failuresAt('provider', 'Payment Provider'), failuresAt('breaker', 'Circuit Breaker'), utilization('provider', 'Payment Provider'), METRICS.p95],
    analyze(results) {
      const m = measured(results, ['off', 'on']); if (isConclusion(m)) return m;
      const at = (id: string, node: string) => m[id].failures.filter(entry => entry.componentId === node).reduce((sum, entry) => sum + entry.count, 0);
      const evidence = [
        `Requests sent to the failing provider and failed there: ${at('off', 'provider').toLocaleString()} without a breaker, ${at('on', 'provider').toLocaleString()} with one.`,
        `Requests failed fast by the open breaker: ${at('on', 'breaker').toLocaleString()}.`,
        `Offered requests that succeeded: ${pct(m.off.successPct)} vs ${pct(m.on.successPct)}.`,
      ];
      if (at('on', 'breaker') > 0 && at('on', 'provider') < at('off', 'provider')) {
        const cost = m.on.successPct < m.off.successPct - 1;
        return { status: 'supports', evidence, summary: `The breaker opened and failed ${at('on', 'breaker').toLocaleString()} requests immediately, so failures at the provider fell from ${at('off', 'provider').toLocaleString()} to ${at('on', 'provider').toLocaleString()}.${cost ? ` It also cost successes: ${pct(m.off.successPct)} → ${pct(m.on.successPct)} succeeded, because the breaker was still open, or re-opened, after the provider recovered at 7 s. Here outages already fail instantly, so failing fast saved little; see the limitations.` : ` The success rate was ${pct(m.off.successPct)} → ${pct(m.on.successPct)}: a breaker limits damage, it does not restore the dependency.`}` };
      }
      return { status: 'does-not-support', evidence, summary: 'The breaker did not open or did not reduce traffic to the failed provider.' };
    },
    theory: [
      'Without a breaker, callers keep sending requests to a dependency that cannot answer. Each one ties up a caller slot until it fails, which in real systems exhausts thread pools and spreads the outage upstream (a cascading failure).',
      'The breaker watches the recent failure rate. When it is too high it opens, and calls fail immediately for a cool-down period. Afterwards it lets traffic through again (real breakers probe with a few half-open requests first).',
      'Failing fast is only useful if callers do something sensible with the failure: a fallback, a cached answer, or a clear error.',
    ],
    limitations: [
      'In the simulator an outage rejects requests instantly, so failures are already fast without a breaker; the protective effect on caller threads and latency is smaller here than in real systems where calls hang until a timeout.',
      'Half-open probing is not simulated: the breaker closes fully after the open period.',
      'Fallbacks are not modelled: a request failed by the breaker is a failed request.',
    ],
    lessons: [], components: ['circuitBreaker'],
  };
})();

export const EXPERIMENTS: ExperimentTemplate[] = [loadTemplate, bottleneckTemplate, scalingTemplate, asyncTemplate, workersTemplate, cacheTemplate, rateLimitTemplate, breakerTemplate];
export const experimentById = (id: string) => EXPERIMENTS.find(entry => entry.id === id);

/** Experiments the simulator cannot meaningfully run, with the reason. Shown instead of a fabricated result. */
export const UNSUPPORTED_EXPERIMENTS: Array<{ title: string; reason: string }> = [
  { title: 'Load-balancing strategies (round robin, least connections, consistent hashing)', reason: 'The simulator’s load balancer always uses round robin, and every server takes the same time per request, so there is nothing for a smarter strategy to improve.' },
  { title: 'Retries, exponential backoff and jitter', reason: 'Simulated clients never retry, so retry storms and backoff cannot be observed.' },
  { title: 'Cache stampedes, TTL expiry and invalidation', reason: 'Cache hit ratio is a fixed setting; entries never expire or get invalidated.' },
  { title: 'Replication lag and stale reads', reason: 'Read replicas serve reads immediately; lag is descriptive only.' },
  { title: 'Bursty or diurnal traffic', reason: 'Traffic is constant-rate. A burst can only be approximated as a window of higher traffic.' },
];

// ── Running ─────────────────────────────────────────────────────────────────────
/** The benchmark one variant runs with: the template's, plus that variant's declared workload overrides. */
export const variantBenchmark = (template: ExperimentTemplate, variant: ExperimentVariant): LabBenchmark =>
  ({ ...template.benchmark, rps: variant.rps ?? template.benchmark.rps, faults: (variant.faults ?? template.benchmark.faults).map(fault => ({ ...fault })) });
export const experimentInput = (template: ExperimentTemplate, variant: ExperimentVariant): SimulationInput => labInput(variant.architecture, variantBenchmark(template, variant));
export const variantLabels = (variant: Pick<ExperimentVariant, 'architecture'>) => Object.fromEntries(variant.architecture.nodes.map(entry => [entry.id, entry.label]));

/** A user's own design run under a template's benchmark, as an extra (uncontrolled) column. */
export const customVariant = (snapshot: ArchitectureSnapshot): ExperimentVariant => ({ id: 'yours', name: 'Your design', description: 'The current Playground canvas under the same benchmark.', architecture: snapshot });

// ── Stored results ──────────────────────────────────────────────────────────────
export type ExperimentRecord = {
  schema: 'flowzen.learn-experiment'; version: 1; experimentId: string; at: number;
  benchmark: LabBenchmark;
  variants: Array<{ id: string; name: string; rps: number; values: Record<string, number | null>; complete: boolean; error?: string }>;
  conclusion: ExperimentConclusion;
};
/** A compact, immutable record of one complete experiment run (metric values only, no traces). */
export function makeExperimentRecord(template: ExperimentTemplate, results: VariantResult[], at: number, extra: ExperimentVariant[] = []): ExperimentRecord {
  const variants = [...template.variants, ...extra];
  return deepFreeze(structuredClone({
    schema: 'flowzen.learn-experiment' as const, version: 1 as const, experimentId: template.id, at, benchmark: template.benchmark,
    variants: variants.map(variant => {
      const result = results.find(entry => entry.variantId === variant.id);
      const m = result?.measurements ?? null;
      return { id: variant.id, name: variant.name, rps: variant.rps ?? template.benchmark.rps, complete: m?.complete ?? false, ...(result?.error ? { error: result.error } : {}),
        values: Object.fromEntries(template.metrics.map(metric => [metric.id, m && m.complete ? metric.read(m) : null])) };
    }),
    conclusion: template.analyze(results),
  }));
}
