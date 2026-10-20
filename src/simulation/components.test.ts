import { describe, expect, it } from 'vitest';
import { simulate, type SimulationNode } from './engine';

const node = (id: string, kind: SimulationNode['kind'], config: Record<string, string | number> = {}): SimulationNode => ({ id, kind, config });
const run = (nodes: SimulationNode[], edges: Array<[string, string]>, offeredRps = 20, durationMs = 1000, seed = 3) =>
  simulate({ nodes, edges: edges.map(([source, target]) => ({ source, target })), durationMs, offeredRps, seed });
const metric = (result: ReturnType<typeof simulate>, id: string) => result.components.find(component => component.id === id)!;

describe('dead ends and telemetry', () => {
  it('fails requests at a forwarding component with nowhere to send them instead of counting them as successes', () => {
    const result = run([node('c', 'client'), node('lb', 'loadBalancer')], [['c', 'lb']]);
    expect(result.completedRequests).toBe(0);
    expect(result.requests[0]).toMatchObject({ failedAt: 'lb', failureKind: 'unrouted', error: 'loadBalancer has no downstream connection' });
  });
  it('fails cache misses without an origin but still completes hits', () => {
    const result = run([node('c', 'client'), node('cache', 'cache', { hitRatio: 50 })], [['c', 'cache']], 50);
    expect(result.completedRequests).toBe(result.cache.hits);
    expect(result.failuresByKind.unrouted).toBe(result.cache.misses);
  });
  it('never routes requests into telemetry sinks and leaves them out of metrics', () => {
    const result = run([node('c', 'client'), node('app', 'server'), node('m', 'metricsCollector'), node('db', 'database')], [['c', 'app'], ['app', 'm'], ['app', 'db']]);
    expect(result.requests.every(request => request.processing.map(span => span.component).join() === 'app,db')).toBe(true);
    expect(result.components.some(component => component.id === 'm')).toBe(false);
  });
});

describe('traffic and networking', () => {
  it('DNS charges the lookup only for uncached resolutions', () => {
    const cached = run([node('c', 'client'), node('dns', 'dns', { cachedPct: 100 }), node('app', 'server')], [['c', 'dns'], ['dns', 'app']]);
    const uncached = run([node('c', 'client'), node('dns', 'dns', { cachedPct: 0, lookupLatencyMs: 20 }), node('app', 'server')], [['c', 'dns'], ['dns', 'app']]);
    expect(cached.latency.p50).toBe(25); expect(uncached.latency.p50).toBe(45);
    expect(uncached.requests[0].processing[0].note).toBe('resolver lookup');
  });
  it('CDN serves hits at the edge and forwards misses to the origin', () => {
    const result = run([node('c', 'client'), node('cdn', 'cdn', { hitRatio: 70 }), node('origin', 'server')], [['c', 'cdn'], ['cdn', 'origin']], 100);
    expect(result.cache.hits + result.cache.misses).toBe(100);
    expect(result.requests.filter(request => request.processing.some(span => span.component === 'origin')).length).toBe(result.cache.misses);
    expect(result.failedRequests).toBe(result.failuresByKind.unfinished ?? 0);
  });
  it('reverse proxy round-robins across every upstream, not only application servers', () => {
    const result = run([node('c', 'client'), node('rp', 'reverseProxy'), node('a', 'server'), node('s', 'objectStorage')], [['c', 'rp'], ['rp', 'a'], ['rp', 's']]);
    expect(metric(result, 'a').completed).toBe(10); expect(metric(result, 's').completed).toBe(10);
  });
  it('WAF blocks the configured share of requests with an explicit cause', () => {
    const all = run([node('c', 'client'), node('waf', 'waf', { blockRatePct: 100 }), node('app', 'server')], [['c', 'waf'], ['waf', 'app']]);
    const none = run([node('c', 'client'), node('waf', 'waf', { blockRatePct: 0 }), node('app', 'server')], [['c', 'waf'], ['waf', 'app']]);
    expect(all.failuresByKind.blocked).toBe(20); expect(all.requests[0].error).toBe('blocked by WAF rule');
    expect(none.completedRequests).toBe(20);
  });
});

describe('compute', () => {
  it('serverless pays cold starts only when every warm instance is busy, and throttles over its concurrency limit', () => {
    const result = run([node('c', 'client'), node('fn', 'serverless', { executionMs: 50, coldStartMs: 300, concurrency: 100 })], [['c', 'fn']], 10);
    // Requests 1–3 arrive while every initialised instance is still busy with a 350 ms cold start.
    expect(metric(result, 'fn').counters?.coldStarts).toBe(4);
    expect(result.requests.map(request => request.latency)).toEqual([350, 350, 350, 350, ...Array(6).fill(50)]);
    const throttled = run([node('c', 'client'), node('fn', 'serverless', { executionMs: 500, coldStartMs: 0, concurrency: 1 })], [['c', 'fn']], 10);
    expect(throttled.failuresByKind.throttled).toBeGreaterThan(0);
    expect(throttled.requests.find(request => request.failureKind === 'throttled')?.error).toMatch(/throttled/);
  });
  it('container service scales out after the provisioning delay and stops at max tasks', () => {
    const config = { processingLatencyMs: 100, slotsPerTask: 1, minTasks: 1, maxTasks: 3, scaleOutDelayMs: 200, timeoutMs: 10000, queueLimit: 10000 };
    const result = run([node('c', 'client'), node('svc', 'containerService', config)], [['c', 'svc']], 30, 2000);
    expect(metric(result, 'svc').counters?.scaleOuts).toBe(2);
    expect(metric(result, 'svc').capacity).toBe(3);
    const fixed = run([node('c', 'client'), node('svc', 'containerService', { ...config, maxTasks: 1 })], [['c', 'svc']], 30, 2000);
    expect(result.latency.p95!).toBeLessThan(fixed.latency.p95!);
  });
});

describe('data', () => {
  it('NoSQL uses its write latency for the configured write share', () => {
    const writes = run([node('c', 'client'), node('kv', 'nosql', { writeRatio: 100, writeLatencyMs: 8 })], [['c', 'kv']]);
    const reads = run([node('c', 'client'), node('kv', 'nosql', { writeRatio: 0, readLatencyMs: 3 })], [['c', 'kv']]);
    expect(writes.latency.p50).toBe(8); expect(reads.latency.p50).toBe(3);
  });
  it('the primary database routes reads to connected read replicas', () => {
    const graph = (readRatio: number) => run([node('c', 'client'), node('db', 'database', { readRatio }), node('r1', 'readReplica'), node('r2', 'readReplica')], [['c', 'db'], ['db', 'r1'], ['db', 'r2']]);
    const reads = graph(100); const writes = graph(0);
    expect(metric(reads, 'db').completed).toBe(0); expect(metric(reads, 'r1').completed + metric(reads, 'r2').completed).toBe(20);
    expect(reads.requests[0].processing[0]).toMatchObject({ component: 'db', start: 0, end: 0, note: 'read routed to replica' });
    expect(metric(writes, 'db').completed).toBe(20); expect(metric(writes, 'r1').completed).toBe(0);
  });
  it('object storage and search engine durations follow their configuration', () => {
    const storage = run([node('c', 'client'), node('s3', 'objectStorage', { firstByteLatencyMs: 40, objectSizeKb: 1024, throughputMBps: 100 })], [['c', 's3']]);
    const search = run([node('c', 'client'), node('es', 'searchEngine', { queryLatencyMs: 20, shards: 4, perShardMs: 5 })], [['c', 'es']]);
    expect(storage.latency.p50).toBe(50); expect(search.latency.p50).toBe(40);
  });
});

describe('caching', () => {
  it('distributed cache capacity scales with its nodes', () => {
    const result = run([node('c', 'client'), node('dc', 'distributedCache', { nodes: 4, connectionsPerNode: 5, hitRatio: 100 })], [['c', 'dc']]);
    expect(metric(result, 'dc').capacity).toBe(20); expect(result.cache.hits).toBe(20);
  });
});

describe('messaging', () => {
  it('event streams fan out one job to every connected consumer', () => {
    const result = run([node('c', 'client'), node('s', 'eventStream'), node('w1', 'worker'), node('w2', 'worker')], [['c', 's'], ['s', 'w1'], ['s', 'w2']]);
    expect(result.jobs).toHaveLength(40);
    expect(new Set(result.jobs.map(job => job.destination))).toEqual(new Set(['w1', 'w2']));
    expect(result.completedRequests).toBe(20);
  });
  it('redelivers failed jobs up to max deliveries, then moves them to a connected dead-letter queue', () => {
    const nodes = [node('c', 'client'), node('q', 'queue', { maxDeliveries: 3, redeliveryDelayMs: 10 }), node('w', 'worker', { concurrency: 1, processingRate: 2, queueLimit: 0 }), node('dlq', 'deadLetterQueue')];
    const result = run(nodes, [['c', 'q'], ['q', 'w'], ['q', 'dlq']], 20);
    const dead = result.jobs.filter(job => job.deadLetteredTo === 'dlq');
    expect(dead.length).toBeGreaterThan(0);
    expect(dead.every(job => job.attempts === 3 && job.redeliveredAt?.length === 2 && job.failedAt === 'w')).toBe(true);
    expect(metric(result, 'dlq').counters?.deadLettered).toBe(dead.length);
    expect(metric(result, 'q').counters?.redelivered).toBe(result.jobs.reduce((sum, job) => sum + (job.attempts ?? 1) - 1, 0));
  });
});

describe('reliability', () => {
  it('rate limiter admits the burst plus the refill rate and rejects the rest', () => {
    const result = run([node('c', 'client'), node('rl', 'rateLimiter', { ratePerSecond: 10, burst: 5 }), node('app', 'server')], [['c', 'rl'], ['rl', 'app']], 100);
    expect(result.completedRequests).toBeGreaterThanOrEqual(14); expect(result.completedRequests).toBeLessThanOrEqual(15);
    expect(result.failuresByKind['rate-limited']).toBe(100 - result.completedRequests);
  });
  it('circuit breaker opens on downstream failures, fails fast while open, and closes after the open period', () => {
    const nodes = [node('c', 'client'), node('cb', 'circuitBreaker', { minimumRequests: 5, failureThresholdPct: 50, windowMs: 1000, openMs: 300 }), node('app', 'server', { processingLatencyMs: 1000, instances: 1, queueLimit: 0 })];
    const result = run(nodes, [['c', 'cb'], ['cb', 'app']], 50, 2000);
    expect(metric(result, 'cb').counters?.opened).toBeGreaterThan(1);
    const fast = result.requests.filter(request => request.failureKind === 'circuit-open');
    expect(fast.length).toBeGreaterThan(0); expect(fast.every(request => request.latency === 0 && request.failedAt === 'cb')).toBe(true);
    expect(result.requests.some(request => request.failureKind === 'rejected' && request.arrivalTime > fast[0].arrivalTime)).toBe(true);
  });
});

describe('benchmark extensions', () => {
  it('stops arrivals at the traffic window and measures throughput over it', () => {
    const result = simulate({ nodes: [node('c', 'client'), node('app', 'server')], edges: [{ source: 'c', target: 'app' }], durationMs: 2000, trafficDurationMs: 1000, offeredRps: 20, seed: 1 });
    expect(result.offeredRequests).toBe(20); expect(result.requests).toHaveLength(20);
    expect(result.requests.at(-1)!.arrivalTime).toBeLessThan(1000);
    expect(result.successfulThroughput).toBe(20);
  });
  it('fails requests offered to a component during a scheduled outage, and only then', () => {
    const result = simulate({ nodes: [node('c', 'client'), node('app', 'server'), node('dep', 'server')], edges: [{ source: 'c', target: 'app' }, { source: 'app', target: 'dep' }], durationMs: 1000, offeredRps: 10, seed: 1, faults: [{ nodeId: 'dep', startMs: 300, endMs: 600 }] });
    const failed = result.requests.filter(request => request.status === 'failed');
    expect(failed.map(request => request.arrivalTime)).toEqual([300, 400, 500]);
    expect(failed.every(request => request.failureKind === 'unavailable' && request.failedAt === 'dep' && /scheduled outage/.test(request.error!))).toBe(true);
    expect(metric(result, 'dep').counters?.outageRejections).toBe(3);
  });
  it('workers forward jobs downstream and retries carry them through an outage', () => {
    const nodes = [node('c', 'client'), node('q', 'queue', { maxDeliveries: 4, redeliveryDelayMs: 300 }), node('w', 'worker', { processingRate: 100 }), node('api', 'server', { processingLatencyMs: 20 })];
    const edges = [{ source: 'c', target: 'q' }, { source: 'q', target: 'w' }, { source: 'w', target: 'api' }];
    const result = simulate({ nodes, edges, durationMs: 2000, trafficDurationMs: 1000, offeredRps: 20, seed: 1, faults: [{ nodeId: 'api', startMs: 200, endMs: 700 }] });
    expect(result.jobs).toHaveLength(20);
    expect(result.jobs.every(job => job.status === 'completed' && job.processing.at(-1)!.component === 'api')).toBe(true);
    expect(result.jobs.some(job => (job.attempts ?? 1) > 1)).toBe(true);
    const once = simulate({ nodes: [nodes[0], node('q', 'queue'), nodes[2], nodes[3]], edges, durationMs: 2000, trafficDurationMs: 1000, offeredRps: 20, seed: 1, faults: [{ nodeId: 'api', startMs: 200, endMs: 700 }] });
    expect(once.jobs.filter(job => job.failureKind === 'unavailable').length).toBeGreaterThan(0);
  });
});

