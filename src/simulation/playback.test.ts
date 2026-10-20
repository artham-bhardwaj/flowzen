import { describe, expect, it } from 'vitest';
import { simulate, type SimulationNode } from './engine';
import { HOP_AFTER_MISS, HOP_JOB, burstsAt, componentLive, createPlaybackIndex, findRequest, laneKey, particlesAt, phaseAt, timelineAt, totalsAt, traceSteps } from './playback';

const node = (id: string, kind: SimulationNode['kind'], config: Record<string, string | number> = {}): SimulationNode => ({ id, kind, config });
const chain = (nodes: SimulationNode[], offeredRps: number, durationMs = 1000, seed = 1) => simulate({ nodes, edges: nodes.slice(1).map((target, index) => ({ source: nodes[index].id, target: target.id })), durationMs, offeredRps, seed });
const basic = () => chain([node('client', 'client'), node('app', 'server', { processingLatencyMs: 10 })], 2);

describe('playback index', () => {
  it('builds a bounded, newest-first timeline from real request traces', () => {
    const index = createPlaybackIndex(basic());
    const latest = timelineAt(index, Infinity, 3);
    expect(latest).toHaveLength(3);
    expect(latest[0].at).toBeGreaterThanOrEqual(latest[2].at);
    expect(timelineAt(index, 0, 10).map(event => event.type)).toEqual(['processing', 'arrival']);
  });

  it('finds real request traces and returns null for unknown ids', () => {
    const output = basic();
    expect(findRequest(output, 0)?.latency).toBe(10);
    expect(findRequest(output, 999)).toBeNull();
  });

  it('derives processing and idle component states from recorded spans', () => {
    const index = createPlaybackIndex(basic());
    expect(componentLive(index, 'app', 5, 1)?.state).toBe('processing');
    expect(componentLive(index, 'app', 5, 1)?.active).toBe(1);
    expect(componentLive(index, 'app', 20, 1)?.state).toBe('idle');
    expect(componentLive(index, 'app', 20, 1)?.succeeded).toBe(1);
  });

  it('places particles on the recorded connection, arriving at the recorded transition time', () => {
    const output = chain([node('client', 'client'), node('gateway', 'gateway', { processingLatencyMs: 10 }), node('app', 'server', { processingLatencyMs: 10 })], 1, 100);
    const lane = createPlaybackIndex(output).lanes[laneKey('gateway', 'app')];
    const [particle] = particlesAt(lane, 6, 5, 10).particles;
    expect(particle).toMatchObject({ requestId: 0, kind: 0 }); expect(particle.progress).toBeCloseTo(0.2);
    expect(particlesAt(lane, 10, 5, 10).particles[0].progress).toBe(1);
    expect(particlesAt(lane, 11, 5, 10).total).toBe(0);
  });

  it('samples dense lanes, reports the true total, and keeps the pinned request', () => {
    const output = chain([node('client', 'client'), node('app', 'server', { processingLatencyMs: 1, instances: 100 })], 1000);
    const lane = createPlaybackIndex(output).lanes[laneKey('client', 'app')];
    const { particles, total } = particlesAt(lane, 100, 50, 10, 141);
    expect(total).toBe(51);
    expect(particles.length).toBeLessThanOrEqual(11);
    expect(particles.some(particle => particle.requestId === 141)).toBe(true);
  });

  it('keeps unroutable failures inspectable and attributes them to the client', () => {
    const output = simulate({ nodes: [node('client', 'client')], edges: [], durationMs: 100, offeredRps: 1 });
    const index = createPlaybackIndex(output);
    expect(findRequest(output, 0)?.error).toMatch(/destination/);
    expect(componentLive(index, 'client', 0, 10)?.state).toBe('failed');
    expect(totalsAt(index, 100)).toMatchObject({ arrived: 1, failed: 1, inFlight: 0 });
  });

  it('separates timed-out requests and records their queue wait at the component', () => {
    const output = chain([node('client', 'client'), node('app', 'server', { processingLatencyMs: 100, instances: 1, timeoutMs: 50 })], 100, 300);
    const index = createPlaybackIndex(output);
    const timedOut = output.requests.find(request => request.failureKind === 'timeout')!;
    expect(timedOut.failedAt).toBe('app');
    const steps = traceSteps(output, timedOut);
    expect(steps.at(-1)).toMatchObject({ component: 'app', result: 'timed-out' });
    expect(steps.at(-1)!.wait).toBeGreaterThan(50);
    expect(componentLive(index, 'app', 50, 1)?.queued).toBeGreaterThan(0);
    expect(componentLive(index, 'app', timedOut.completedAt!, 1)?.state).toBe('failed');
    expect(totalsAt(index, 300).timedOut).toBe(output.requests.filter(request => request.failureKind === 'timeout').length);
    expect(phaseAt(timedOut, timedOut.arrivalTime)).toBe('in-flight');
    expect(phaseAt(timedOut, timedOut.completedAt!)).toBe('timeout');
  });

  it('records queue-full rejections at the rejecting component', () => {
    const output = chain([node('client', 'client'), node('app', 'server', { processingLatencyMs: 100, instances: 1, queueLimit: 0 })], 100, 100);
    const rejected = output.requests.find(request => request.failureKind === 'rejected')!;
    expect(traceSteps(output, rejected).at(-1)).toMatchObject({ component: 'app', result: 'rejected', wait: 0 });
    const lane = createPlaybackIndex(output).lanes[laneKey('client', 'app')];
    expect(burstsAt(lane, rejected.completedAt!, 1, 10).some(burst => burst.requestId === rejected.id && burst.outcome === 'failed')).toBe(true);
  });

  it('marks saturated components from real backlog', () => {
    const output = chain([node('client', 'client'), node('app', 'server', { processingLatencyMs: 100, instances: 1, queueLimit: 10, timeoutMs: 10000 })], 100, 400);
    expect(componentLive(createPlaybackIndex(output), 'app', 50, 1)?.state).toBe('saturated');
  });

  it('shows cache hits and misses, including the hop that follows a miss', () => {
    const nodes = [node('client', 'client'), node('cache', 'cache', { hitRatio: 50 }), node('db', 'database')];
    const output = chain(nodes, 50, 1000, 4); const index = createPlaybackIndex(output);
    const live = componentLive(index, 'cache', 1000, 1)!;
    expect(live.hits).toBe(output.cache.hits); expect(live.misses).toBe(output.cache.misses);
    const lane = index.lanes[laneKey('cache', 'db')];
    expect([...lane.hopKind].every(kind => kind === HOP_AFTER_MISS)).toBe(true);
    expect(lane.hopAt.length).toBe(output.cache.misses);
    expect([...index.lanes[laneKey('client', 'cache')].endHit].filter(Boolean).length).toBe(output.cache.hits);
  });

  it('animates queue to worker jobs and links them to the enqueuing request', () => {
    const output = chain([node('client', 'client'), node('queue', 'queue'), node('worker', 'worker', { processingRate: 50 })], 20);
    const index = createPlaybackIndex(output); const lane = index.lanes[laneKey('queue', 'worker')];
    expect(lane.hopAt.length).toBe(output.jobs.length);
    expect([...lane.hopKind].every(kind => kind === HOP_JOB)).toBe(true);
    const job = output.jobs[0];
    expect(findRequest(output, job.id)).toBe(job);
    expect(job.parentId).toBe(0);
    expect(componentLive(index, 'worker', job.processing[0].start, 1)?.active).toBe(1);
    expect(componentLive(index, 'queue', 1000, 1)?.jobs).toBe(output.requests.filter(request => request.status === 'completed').length);
  });

  it('counts busy and waiting requests exactly as a brute-force scan of the traces would', () => {
    const output = chain([node('client', 'client'), node('app', 'server', { processingLatencyMs: 30, instances: 2, timeoutMs: 120 })], 120, 1000, 9);
    const index = createPlaybackIndex(output);
    for (let t = 0; t <= 1000; t += 7.5) {
      const active = output.requests.flatMap(request => request.processing).filter(span => span.start <= t && span.end > t).length;
      const waiting = output.requests.filter(request => {
        const span = request.processing[0];
        if (span) return span.start - span.wait <= t && span.start > t;
        return request.failedAt === 'app' && request.arrivalTime <= t && (request.completedAt ?? Infinity) > t;
      }).length;
      expect(componentLive(index, 'app', t, 1)).toMatchObject({ active, queued: waiting });
    }
  });

  it('indexes the extended component set: replica routing, cold starts, dead letters and admission failures', () => {
    const nodes = [
      node('c', 'client'), node('dns', 'dns'), node('waf', 'waf', { blockRatePct: 10 }), node('rl', 'rateLimiter', { ratePerSecond: 150, burst: 5 }), node('lb', 'loadBalancer'),
      node('fn', 'serverless'), node('db', 'database', { readRatio: 50 }), node('replica', 'readReplica'),
      node('c2', 'client'), node('stream', 'eventStream', { maxDeliveries: 2, redeliveryDelayMs: 5 }), node('w', 'worker', { concurrency: 1, processingRate: 5, queueLimit: 0 }), node('dlq', 'deadLetterQueue'),
    ];
    const edges = [['c', 'dns'], ['dns', 'waf'], ['waf', 'rl'], ['rl', 'lb'], ['lb', 'fn'], ['fn', 'db'], ['db', 'replica'], ['c2', 'stream'], ['stream', 'w'], ['stream', 'dlq']].map(([source, target]) => ({ source, target }));
    const output = simulate({ nodes, edges, durationMs: 1000, offeredRps: 400, seed: 11 });
    const index = createPlaybackIndex(output);
    const routed = output.requests.find(request => request.processing.some(span => span.note === 'read routed to replica'))!;
    expect(traceSteps(output, routed).map(step => step.result)).toContain('routed');
    expect(output.requests.some(request => request.processing.some(span => span.note === 'cold start'))).toBe(true);
    for (const kind of ['blocked', 'rate-limited'] as const) {
      const failed = output.requests.find(request => request.failureKind === kind)!;
      expect(traceSteps(output, failed).at(-1)?.result).toBe(kind);
    }
    const dead = output.jobs.filter(job => job.deadLetteredTo === 'dlq');
    expect(dead.length).toBeGreaterThan(0);
    expect(index.lanes[laneKey('stream', 'dlq')].hopAt.length).toBe(dead.length);
    expect(componentLive(index, 'dlq', 1000, 1)?.jobs).toBe(dead.length);
    expect(timelineAt(index, Infinity, 100000).filter(event => event.type === 'dead-lettered')).toHaveLength(dead.length);
    expect(index.lanes[laneKey('db', 'replica')].hopAt.length).toBe(output.components.find(metric => metric.id === 'db')!.counters!.replicaReads);
  });
});

