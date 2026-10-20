import type { Kind } from '../../app/catalog';
import type { Diagram } from '../../learn/types';
import type { ApiConsideration, Benchmark, Concept, RequirementExpectation } from '../types';

/** Small constructors that keep problem files readable as data. */
export const c = (id: string, label: string, any: string[]): Concept => ({ id, label, any });
export const fr = (id: string, label: string, any: string[], critical: boolean, why: string): RequirementExpectation => ({ id, kind: 'functional', label, any, critical, why });
export const nfr = (id: string, label: string, any: string[], critical: boolean, why: string): RequirementExpectation => ({ id, kind: 'non-functional', label, any, critical, why });
export const flag = (id: string, label: string, which: 'auth' | 'idempotent' | 'paginated', why: string): ApiConsideration => ({ id, label, why, check: { flag: which } });
export const text = (id: string, label: string, where: 'request' | 'response' | 'errors' | 'any', any: string[], why = `A complete endpoint documents its ${where === 'any' ? 'behaviour' : where} here.`): ApiConsideration => ({ id, label, why, check: { text: where, any } });

/** Common concept vocabularies reused across problems. */
export const V = {
  stateless: c('stateless', 'stateless or horizontally scaled compute', ['stateless', 'horizontal', 'scale out', 'replicas', 'instances', 'autoscal']),
  redundancy: c('redundancy', 'redundancy and health checks', ['redundan', 'health check', 'failover', 'single point of failure', 'spof', 'multiple']),
  readHeavy: c('read-heavy', 'read-heavy access', ['read-heavy', 'read heavy', 'reads dominate', 'mostly reads', 'hot', 'popular', 'repeated']),
  hitRatio: c('hit-ratio', 'hit ratio or offloading the store', ['hit ratio', 'hit rate', 'offload', 'fewer queries', 'reduce load', 'protect the database']),
  staleness: c('staleness', 'staleness, TTL or invalidation', ['stale', 'ttl', 'invalidat', 'expire', 'eventual']),
  durability: c('durability', 'durability or source of truth', ['durab', 'source of truth', 'persist', 'replicat', 'backup']),
  keyAccess: c('key-access', 'access by key', ['by key', 'primary key', 'lookup', 'point read', 'key-value', 'key value', 'partition key']),
  decoupling: c('decoupling', 'decoupling or absorbing bursts', ['decouple', 'absorb', 'burst', 'buffer', 'smooth', 'asynchron', 'background']),
  retries: c('retries', 'retries and failures', ['retry', 'retries', 'redeliver', 'dead-letter', 'dlq']),
  idempotency: c('idempotency', 'idempotency or deduplication', ['idempoten', 'dedup', 'unique key', 'idempotency key']),
  partitioning: c('partitioning', 'partitioning or sharding', ['partition', 'shard', 'consistent hash']),
};

/** Benchmarks share these forced settings so results depend on the design, not on tuning per-request costs. */
type Override = Benchmark['overrides'][number];
export const routing: Override = { kinds: ['loadBalancer', 'reverseProxy', 'gateway'] as Kind[], config: { processingLatencyMs: '1', concurrency: '200' }, reason: 'Routing components take 1 ms and handle 200 requests at once.' };
export const compute = (ms: number): Override[] => [
  { kinds: ['server', 'containerService'] as Kind[], config: { processingLatencyMs: String(ms) }, reason: `Application work takes ${ms} ms per request, wherever it runs.` },
  { kinds: ['serverless'] as Kind[], config: { executionMs: String(ms) }, reason: `Functions run the same ${ms} ms of work.` },
];
export const store = (connections: number, ms: number): Override => ({ kinds: ['database', 'nosql'] as Kind[], config: { concurrency: String(connections), queryLatencyMs: String(ms), readLatencyMs: String(ms), writeLatencyMs: String(ms) }, reason: `The primary store handles ${connections} queries at once at ${ms} ms each (≈ ${Math.round(connections / ms * 1000).toLocaleString()} queries/s).` });
export const bench = (rps: number, p95Ms: number, overrides: Benchmark['overrides'], description: string, minSuccessPct = 99): Benchmark => ({ rps, durationMs: 5000, drainMs: 1500, seed: 7, overrides, targets: { p95Ms, minSuccessPct }, description });

type NodeSpec = [id: string, label: string, col: number, row: number, kind?: Kind, note?: string];
export const diagram = (id: string, title: string, caption: string, nodes: NodeSpec[], edges: Array<[string, string, string?]>): Diagram => ({
  id, title, caption,
  nodes: nodes.map(([nodeId, label, col, row, kind, note]) => ({ id: nodeId, label, col, row, ...(kind ? { kind } : {}), ...(note ? { note } : {}) })),
  edges: edges.map(([from, to, label]) => ({ from, to, ...(label ? { label } : {}) })),
});
