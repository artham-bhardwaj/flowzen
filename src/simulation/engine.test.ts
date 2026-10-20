import { describe, expect, it } from 'vitest';
import { simulate, SimulationClock, type SimulationNode } from './engine';

const node = (id: string, kind: SimulationNode['kind'], config: Record<string, string | number> = {}): SimulationNode => ({ id, kind, config });
const base = () => ({ nodes: [node('client', 'client'), node('app', 'server', { processingLatencyMs: 10, instances: 1 })], edges: [{ source: 'client', target: 'app' }], durationMs: 1000, offeredRps: 10, seed: 7 });

describe('discrete event simulation', () => {
  it('routes requests across actual graph connections and measures completion latency', () => {
    const result = simulate(base());
    expect(result.completedRequests).toBe(10);
    expect(result.failedRequests).toBe(0);
    expect(result.latency.p50).toBe(10);
    expect(result.components.find(c => c.id === 'app')?.completed).toBe(10);
  });

  it('reports missing client destinations without inventing a route', () => {
    const result = simulate({ ...base(), edges: [] });
    expect(result.completedRequests).toBe(0);
    expect(result.failedRequests).toBe(10);
    expect(result.requests[0].error).toMatch(/no connected destination/);
  });

  it('handles architectures with no client without generating traffic', () => {
    const result = simulate({ nodes: [node('app', 'server')], edges: [], durationMs: 1000, offeredRps: 10 });
    expect(result.offeredRequests).toBe(0);
    expect(result.completedRequests).toBe(0);
    expect(result.events[0]).toMatch(/No client/);
  });

  it('rejects overload when a finite queue is full', () => {
    const result = simulate({ ...base(), offeredRps: 1000, nodes: [node('client', 'client'), node('app', 'server', { processingLatencyMs: 100, instances: 1, queueLimit: 2 })] });
    expect(result.failedRequests).toBeGreaterThan(900);
    expect(result.components.find(c => c.id === 'app')?.maxQueueDepth).toBe(2);
    expect(result.errorRate).toBeGreaterThan(.9);
  });

  it('records cache hit and miss behavior deterministically', () => {
    const graph = { nodes: [node('client', 'client'), node('cache', 'cache', { hitRatio: 100, lookupLatencyMs: 2 }), node('db', 'database')], edges: [{ source: 'client', target: 'cache' }, { source: 'cache', target: 'db' }], durationMs: 1000, offeredRps: 10, seed: 3 };
    const hit = simulate(graph); const miss = simulate({ ...graph, nodes: [graph.nodes[0], node('cache', 'cache', { hitRatio: 0, lookupLatencyMs: 2 }), graph.nodes[2]] });
    expect(hit.cache).toEqual({ hits: 10, misses: 0, hitRatio: 1 });
    expect(miss.cache).toEqual({ hits: 0, misses: 10, hitRatio: 0 });
    expect(miss.latency.p50).toBeGreaterThan(hit.latency.p50!);
  });

  it('uses repeatable seeded outcomes', () => {
    const input = { nodes: [node('client', 'client'), node('cache', 'cache', { hitRatio: 55 }), node('db', 'database')], edges: [{ source: 'client', target: 'cache' }, { source: 'cache', target: 'db' }], durationMs: 1000, offeredRps: 25, seed: 99 };
    expect(simulate(input)).toEqual(simulate(input));
  });

  it('models queue to worker routing and fails queues without workers', () => {
    const connected = simulate({ nodes: [node('client', 'client'), node('queue', 'queue'), node('worker', 'worker', { processingRate: 100 })], edges: [{ source: 'client', target: 'queue' }, { source: 'queue', target: 'worker' }], durationMs: 500, offeredRps: 5 });
    const disconnected = simulate({ nodes: [node('client', 'client'), node('queue', 'queue')], edges: [{ source: 'client', target: 'queue' }], durationMs: 500, offeredRps: 5 });
    expect(connected.completedRequests).toBe(3);
    expect(disconnected.failedRequests).toBe(3);
  });

  it('pauses, resumes, and resets playback without altering simulated time rules', () => {
    const clock = new SimulationClock(1000, 2); clock.run(); expect(clock.tick(100)).toBe(200); clock.pause(); expect(clock.tick(100)).toBe(200); clock.run(); expect(clock.tick(400)).toBe(1000); clock.reset(); expect(clock.elapsedMs).toBe(0); expect(clock.running).toBe(false);
  });

  it('keeps worker jobs separate from client requests and links them to the enqueuing request', () => {
    const result = simulate({ nodes: [node('client', 'client'), node('queue', 'queue'), node('worker', 'worker', { concurrency: 1, processingRate: 5 })], edges: [{ source: 'client', target: 'queue' }, { source: 'queue', target: 'worker' }], durationMs: 1000, offeredRps: 20, seed: 1 });
    expect(result.requests.every(request => request.processing.every(span => span.component === 'queue'))).toBe(true);
    expect(result.requests.every(request => request.latency === 1)).toBe(true);
    expect(result.jobs.length).toBe(20);
    expect(result.jobs.every((job, index) => job.id === -(index + 1) && job.parentId === index && job.destination === 'worker')).toBe(true);
  });

  it('measures worker utilization from the actual worker processing time', () => {
    const result = simulate({ nodes: [node('client', 'client'), node('queue', 'queue'), node('worker', 'worker', { concurrency: 1, processingRate: 5 })], edges: [{ source: 'client', target: 'queue' }, { source: 'queue', target: 'worker' }], durationMs: 1000, offeredRps: 20, seed: 1 });
    const worker = result.components.find(c => c.id === 'worker')!;
    expect(worker.busyMs).toBe(worker.completed * 200);
  });

  it('records the origin, failing component, and failure kind', () => {
    const timeout = simulate({ ...base(), offeredRps: 100, nodes: [node('client', 'client'), node('app', 'server', { processingLatencyMs: 100, instances: 1, timeoutMs: 50 })] });
    const failed = timeout.requests.find(request => request.status === 'failed')!;
    expect(failed).toMatchObject({ origin: 'client', failedAt: 'app', failureKind: 'timeout' });
    const unrouted = simulate({ ...base(), edges: [] });
    expect(unrouted.requests[0]).toMatchObject({ failedAt: 'client', failureKind: 'unrouted' });
    const unfinished = simulate({ ...base(), durationMs: 100, nodes: [node('client', 'client'), node('app', 'server', { processingLatencyMs: 1000, instances: 1 })] });
    expect(unfinished.requests[0]).toMatchObject({ failedAt: 'app', failureKind: 'unfinished' });
    expect(unfinished.components.find(c => c.id === 'app')?.queueLimit).toBe(500);
  });
});

