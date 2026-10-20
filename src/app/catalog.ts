import type { LucideIcon } from 'lucide-react';
import {
  ArchiveX, ArrowLeftRight, ChartLine, CircuitBoard, Cloud, Cog, Container, Copy, Database, DatabaseZap, Earth, Gauge, Globe, HardDrive,
  Inbox, MonitorSmartphone, Radio, ScanSearch, ScrollText, Server, ShieldCheck, Split, SquareFunction, Waypoints, Zap,
} from 'lucide-react';
import { ENGINE_DEFAULTS, GENERIC_DEFAULTS, type ComponentKind } from '../simulation/engine';

export type Kind = ComponentKind;
export type CategoryId = 'entry' | 'compute' | 'storage' | 'caching' | 'messaging' | 'reliability' | 'observability';

export const categories: Record<CategoryId, { label: string; short: string }> = {
  entry: { label: 'Traffic & networking', short: 'Networking' },
  compute: { label: 'Compute', short: 'Compute' },
  storage: { label: 'Data', short: 'Data' },
  caching: { label: 'Caching', short: 'Caching' },
  messaging: { label: 'Messaging', short: 'Messaging' },
  reliability: { label: 'Reliability', short: 'Reliability' },
  observability: { label: 'Observability', short: 'Observability' },
};
export const categoryOrder: CategoryId[] = ['entry', 'compute', 'storage', 'caching', 'messaging', 'reliability', 'observability'];

export type FieldSpec = { key: string; label: string; unit?: string; simulated: boolean; fallback?: number; percent?: boolean; hint?: string };
/**
 * A component's contract. `inputs`/`outputs` describe which connections it uses, `behavior` is what
 * the engine does with a request, and `rules` are the checks the architecture validator applies.
 * `simulated: false` components are drawn for completeness and never carry requests.
 */
export type CatalogItem = {
  kind: Kind; label: string; category: CategoryId; icon: LucideIcon; simulated: boolean;
  description: string; inputs: string; outputs: string; behavior: string; rules: string[];
  defaults: Record<string, string>; fields: FieldSpec[];
};

const fallbackOf = (kind: Kind, key: string) => ENGINE_DEFAULTS[kind][key] ?? GENERIC_DEFAULTS[key];
/** `descriptive` holds defaults for non-simulated fields; `overrides` sets a new component's starting value where it differs from the engine fallback. */
type Draft = Omit<CatalogItem, 'defaults' | 'fields'> & { fields: Array<Omit<FieldSpec, 'fallback'>>; descriptive?: Record<string, string>; overrides?: Record<string, string> };
const sim = (key: string, label: string, unit?: string, hint?: string): Omit<FieldSpec, 'fallback'> => ({ key, label, unit, hint, simulated: true, percent: unit === '%' });
const info = (key: string, label: string, hint?: string): Omit<FieldSpec, 'fallback'> => ({ key, label, hint, simulated: false });
const latency = (key = 'processingLatencyMs', label = 'Processing latency') => sim(key, label, 'ms');
const slots = (label = 'Concurrency', key = 'concurrency') => sim(key, label, 'slots', 'Requests processed at the same time.');
const queueLimit = sim('queueLimit', 'Queue limit', 'requests', 'Arrivals beyond this backlog are rejected.');
const timeout = sim('timeoutMs', 'Queue timeout', 'ms', 'A request that waited longer than this when a slot frees up fails with a timeout.');
const station = [queueLimit, timeout];

/** Builds defaults from engine fallbacks (simulated fields) and the descriptive values. */
function item(draft: Draft): CatalogItem {
  const fields = draft.fields.map(field => ({ ...field, fallback: field.simulated ? fallbackOf(draft.kind, field.key) : undefined }));
  const defaults: Record<string, string> = {};
  for (const field of fields) defaults[field.key] = draft.overrides?.[field.key] ?? (field.simulated ? String(field.fallback) : draft.descriptive?.[field.key] ?? '');
  const { descriptive: _descriptive, overrides: _overrides, ...rest } = draft;
  return { ...rest, fields, defaults };
}

const firstRoute = 'Its first connection (telemetry and dead-letter connections are ignored).';

export const catalog: CatalogItem[] = [
  // Traffic & networking
  item({
    kind: 'client', label: 'Client', category: 'entry', icon: MonitorSmartphone, simulated: true,
    description: 'Web or mobile users generating requests.', inputs: 'None: it generates traffic.', outputs: firstRoute,
    behavior: 'Sends toolbar traffic to its first connection. Traffic is split round-robin across clients.',
    rules: ['Needs an outgoing connection, or every request it sends fails.', 'Connections into a client are flagged: clients only generate traffic.'],
    fields: [info('protocol', 'Protocol'), info('region', 'Region')], descriptive: { protocol: 'HTTPS', region: 'Global' },
  }),
  item({
    kind: 'dns', label: 'DNS', category: 'entry', icon: Globe, simulated: true,
    description: 'Resolves service names before traffic reaches your edge.', inputs: 'Requests from clients.', outputs: firstRoute,
    behavior: 'A seeded share of requests use a cached resolution (no delay); the rest pay the resolver lookup latency. Then forwards.',
    rules: ['Must have a downstream connection, or every request fails here.', 'Cached share must be 0–100%.'],
    fields: [sim('lookupLatencyMs', 'Lookup latency', 'ms'), sim('cachedPct', 'Cached resolutions', '%', 'Share of requests that skip the lookup.'), slots(), ...station, info('provider', 'Provider'), info('ttl', 'TTL', 'TTL expiry is not simulated; the cached share is used directly.')],
    descriptive: { provider: 'Route 53', ttl: '60 s' },
  }),
  item({
    kind: 'cdn', label: 'CDN', category: 'entry', icon: Earth, simulated: true,
    description: 'Edge cache that serves content close to users.', inputs: 'Requests from clients or DNS.', outputs: 'Its origin (first connection), on cache misses only.',
    behavior: 'Edge hits complete at the CDN. Misses are forwarded to the origin.',
    rules: ['Misses fail if no origin is connected.', 'A 100% hit ratio means the origin never receives traffic.'],
    fields: [sim('edgeLatencyMs', 'Edge latency', 'ms'), sim('hitRatio', 'Edge hit ratio', '%'), slots(), ...station, info('provider', 'Provider')],
    descriptive: { provider: 'CloudFront' },
  }),
  item({
    kind: 'loadBalancer', label: 'Load Balancer', category: 'entry', icon: Split, simulated: true,
    description: 'Distributes traffic across compute.', inputs: 'Requests.', outputs: 'Every connected Application Server, Container Service or Serverless Function.',
    behavior: 'Round-robins across directly connected compute targets.',
    rules: ['Needs at least one compute target, or every request fails here.', 'Connections to non-compute components carry no requests.'],
    fields: [latency(), slots(), ...station, info('algorithm', 'Algorithm', 'The simulator always uses round robin.'), info('healthCheck', 'Health check')],
    descriptive: { algorithm: 'Round Robin', healthCheck: 'Enabled' },
  }),
  item({
    kind: 'reverseProxy', label: 'Reverse Proxy', category: 'entry', icon: ArrowLeftRight, simulated: true,
    description: 'Terminates connections and forwards to upstreams.', inputs: 'Requests.', outputs: 'Every connected upstream, round-robin (any request-carrying component).',
    behavior: 'Adds proxy latency, then round-robins across all upstream connections.',
    rules: ['Must have at least one upstream, or every request fails here.'],
    fields: [latency(), slots(), ...station, info('software', 'Software')], descriptive: { software: 'NGINX' },
  }),
  item({
    kind: 'gateway', label: 'API Gateway', category: 'entry', icon: Waypoints, simulated: true,
    description: 'Authenticates and routes API requests.', inputs: 'Requests.', outputs: firstRoute,
    behavior: 'Processes each request, then forwards it to its first connection.',
    rules: ['Must have a downstream connection, or every request fails here.'],
    fields: [latency(), slots(), ...station, info('rateLimit', 'Rate limit', 'Not enforced; add a Rate Limiter to simulate limiting.'), info('auth', 'Auth')],
    descriptive: { rateLimit: '1,000 req/s', auth: 'JWT' },
  }),
  item({
    kind: 'waf', label: 'WAF', category: 'entry', icon: ShieldCheck, simulated: true,
    description: 'Web application firewall that inspects and blocks requests.', inputs: 'Requests.', outputs: firstRoute,
    behavior: 'Inspects each request; a seeded share is blocked (failed as “blocked”), the rest are forwarded.',
    rules: ['Must have a downstream connection.', 'A 100% block rate blocks all traffic.'],
    fields: [sim('inspectionLatencyMs', 'Inspection latency', 'ms'), sim('blockRatePct', 'Block rate', '%', 'Share of requests rejected as malicious.'), slots(), ...station, info('ruleset', 'Rule set')],
    descriptive: { ruleset: 'OWASP Core' },
  }),
  // Compute
  item({
    kind: 'server', label: 'Application Server', category: 'compute', icon: Server, simulated: true,
    description: 'Runs application code for each request.', inputs: 'Requests.', outputs: `${firstRoute} Optional: it can be the last step.`,
    behavior: 'Processes on parallel instances, then forwards to its first connection or completes the request.',
    rules: ['Only the first outgoing connection carries requests.'],
    fields: [sim('instances', 'Instances', 'slots', 'Requests processed at the same time.'), latency(), ...station, info('runtime', 'Runtime')],
    descriptive: { runtime: 'Node.js 20' },
  }),
  item({
    kind: 'containerService', label: 'Container Service', category: 'compute', icon: Container, simulated: true,
    description: 'Autoscaling container tasks.', inputs: 'Requests.', outputs: `${firstRoute} Optional.`,
    behavior: 'Capacity is tasks × slots per task. While requests are waiting it adds one task after each provisioning delay, up to max tasks. It never scales in.',
    rules: ['Min tasks should not exceed max tasks.'],
    fields: [latency(), sim('slotsPerTask', 'Slots per task', 'slots'), sim('minTasks', 'Min tasks', 'tasks'), sim('maxTasks', 'Max tasks', 'tasks'), sim('scaleOutDelayMs', 'Scale-out delay', 'ms', 'Time to provision one more task.'), ...station, info('platform', 'Platform')],
    descriptive: { platform: 'ECS Fargate' },
  }),
  item({
    kind: 'serverless', label: 'Serverless Function', category: 'compute', icon: SquareFunction, simulated: true,
    description: 'On-demand function instances.', inputs: 'Requests.', outputs: `${firstRoute} Optional.`,
    behavior: 'Each request needs a free instance. If every initialised instance is busy, a new one pays the cold start. Above the concurrency limit, requests are throttled (queue limit 0 by default).',
    rules: ['Throttled requests fail with “throttled”.'],
    fields: [sim('executionMs', 'Execution time', 'ms'), sim('coldStartMs', 'Cold start', 'ms'), slots('Concurrency limit'), sim('queueLimit', 'Queue limit', 'requests', '0 throttles immediately at the concurrency limit.'), timeout, info('runtime', 'Runtime'), info('memory', 'Memory', 'Memory size is not simulated.')],
    descriptive: { runtime: 'Node.js 20', memory: '512 MB' },
  }),
  item({
    kind: 'worker', label: 'Worker', category: 'compute', icon: Cog, simulated: true,
    description: 'Processes background jobs from a queue or stream.', inputs: 'Jobs from a Message Queue or Event Stream.', outputs: 'Optional: its first connection. Each job is forwarded there after processing (e.g. to an external API); otherwise the job completes at the worker.',
    behavior: 'Consumes jobs; each slot handles one job at the processing rate. A job that fails downstream is redelivered by its queue if deliveries remain.',
    rules: ['Needs a Message Queue or Event Stream feeding it.', 'Direct request connections are flagged: those are processed synchronously.'],
    fields: [slots(), sim('processingRate', 'Processing rate', 'jobs/s per slot'), ...station, info('retry', 'Retry policy', 'Retries are set on the source queue (Max deliveries).')],
    descriptive: { retry: 'From queue' }, overrides: { processingRate: '100' },
  }),
  // Data
  item({
    kind: 'database', label: 'SQL Database', category: 'storage', icon: Database, simulated: true,
    description: 'Durable relational storage.', inputs: 'Requests.', outputs: 'Read Replicas (reads) and optionally a first non-replica connection.',
    behavior: 'If Read Replicas are connected, the read share is routed to them round-robin. All other queries run on the connection pool.',
    rules: ['Read ratio of 0% leaves connected replicas unused.'],
    fields: [sim('queryLatencyMs', 'Query latency', 'ms'), slots('Connections'), sim('readRatio', 'Read share to replicas', '%', 'Only applies when Read Replicas are connected.'), ...station, info('engine', 'Engine')],
    descriptive: { engine: 'PostgreSQL' },
  }),
  item({
    kind: 'readReplica', label: 'Read Replica', category: 'storage', icon: Copy, simulated: true,
    description: 'Read-only copy of a SQL Database.', inputs: 'Reads routed from a connected SQL Database (connect primary → replica).', outputs: 'None.',
    behavior: 'Serves routed reads on its own connection pool.',
    rules: ['Needs a connection from a SQL Database with a read share above 0%.'],
    fields: [sim('queryLatencyMs', 'Query latency', 'ms'), slots('Connections'), ...station, info('replicationLag', 'Replication lag', 'Lag is not simulated; reads are served immediately.')],
    descriptive: { replicationLag: '50 ms' },
  }),
  item({
    kind: 'nosql', label: 'NoSQL Database', category: 'storage', icon: DatabaseZap, simulated: true,
    description: 'Key-value / document store.', inputs: 'Requests.', outputs: 'None.',
    behavior: 'A seeded share of requests are writes (write latency); the rest are reads (read latency).',
    rules: ['Write share must be 0–100%.'],
    fields: [sim('readLatencyMs', 'Read latency', 'ms'), sim('writeLatencyMs', 'Write latency', 'ms'), sim('writeRatio', 'Write share', '%'), slots(), ...station, info('engine', 'Engine')],
    descriptive: { engine: 'DynamoDB' },
  }),
  item({
    kind: 'objectStorage', label: 'Object Storage', category: 'storage', icon: HardDrive, simulated: true,
    description: 'Blob storage for files and media.', inputs: 'Requests.', outputs: 'None.',
    behavior: 'Each request takes first-byte latency plus object size ÷ throughput.',
    rules: [],
    fields: [sim('firstByteLatencyMs', 'First-byte latency', 'ms'), sim('objectSizeKb', 'Object size', 'KB'), sim('throughputMBps', 'Throughput', 'MB/s'), slots(), ...station, info('provider', 'Provider')],
    descriptive: { provider: 'S3' },
  }),
  item({
    kind: 'searchEngine', label: 'Search Engine', category: 'storage', icon: ScanSearch, simulated: true,
    description: 'Full-text search cluster.', inputs: 'Requests.', outputs: 'None.',
    behavior: 'Each query fans out to every shard: base latency + shards × per-shard cost, on a fixed search thread pool.',
    rules: [],
    fields: [sim('queryLatencyMs', 'Base query latency', 'ms'), sim('shards', 'Shards'), sim('perShardMs', 'Per-shard cost', 'ms'), slots('Search threads'), ...station, info('engine', 'Engine')],
    descriptive: { engine: 'OpenSearch' },
  }),
  // Caching
  item({
    kind: 'cache', label: 'Cache', category: 'caching', icon: Zap, simulated: true,
    description: 'In-memory store in front of slower storage.', inputs: 'Requests.', outputs: 'Its first connection, on misses only.',
    behavior: 'Hits complete here; misses continue to the first connection.',
    rules: ['Misses fail if nothing is connected behind it.', 'A 100% hit ratio means its downstream never receives traffic.'],
    fields: [sim('lookupLatencyMs', 'Lookup latency', 'ms'), sim('hitRatio', 'Hit ratio', '%'), slots(), ...station, info('engine', 'Engine'), info('ttl', 'TTL', 'Expiry is not simulated; the hit ratio is used directly.')],
    descriptive: { engine: 'Redis', ttl: '3600 seconds' },
  }),
  item({
    kind: 'distributedCache', label: 'Distributed Cache', category: 'caching', icon: Cloud, simulated: true,
    description: 'Sharded cache cluster.', inputs: 'Requests.', outputs: 'Its first connection, on misses only.',
    behavior: 'Capacity is nodes × connections per node. Hits complete here; misses continue.',
    rules: ['Misses fail if nothing is connected behind it.'],
    fields: [sim('lookupLatencyMs', 'Lookup latency', 'ms'), sim('hitRatio', 'Hit ratio', '%'), sim('nodes', 'Nodes'), sim('connectionsPerNode', 'Connections per node', 'slots'), ...station, info('engine', 'Engine')],
    descriptive: { engine: 'Redis Cluster' },
  }),
  // Messaging
  item({
    kind: 'queue', label: 'Message Queue', category: 'messaging', icon: Inbox, simulated: true,
    description: 'Buffers work for asynchronous processing.', inputs: 'Requests.', outputs: 'Its first Worker (jobs) and an optional Dead-Letter Queue.',
    behavior: 'Accepts the request (which completes here) and dispatches one job to its first Worker. Failed jobs are redelivered up to Max deliveries, then sent to a connected DLQ.',
    rules: ['Needs a connected Worker, or enqueued requests fail.'],
    fields: [latency('processingLatencyMs', 'Enqueue latency'), slots(), sim('maxDeliveries', 'Max deliveries', 'attempts'), sim('redeliveryDelayMs', 'Redelivery delay', 'ms'), ...station, info('engine', 'Engine'), info('retention', 'Retention')],
    descriptive: { engine: 'RabbitMQ', retention: '24 hours' },
  }),
  item({
    kind: 'eventStream', label: 'Event Stream', category: 'messaging', icon: Radio, simulated: true,
    description: 'Partitioned log with fan-out to consumers.', inputs: 'Requests (events).', outputs: 'Every connected Worker (one job each) and an optional Dead-Letter Queue.',
    behavior: 'Appends the event (request completes here) on one of its partitions, then delivers a job to every connected consumer Worker.',
    rules: ['Needs at least one consumer Worker.'],
    fields: [sim('appendLatencyMs', 'Append latency', 'ms'), sim('partitions', 'Partitions', 'slots', 'Appends processed at the same time.'), sim('maxDeliveries', 'Max deliveries', 'attempts'), sim('redeliveryDelayMs', 'Redelivery delay', 'ms'), ...station, info('engine', 'Engine'), info('retention', 'Retention')],
    descriptive: { engine: 'Kafka', retention: '7 days' },
  }),
  item({
    kind: 'deadLetterQueue', label: 'Dead-Letter Queue', category: 'messaging', icon: ArchiveX, simulated: true,
    description: 'Holds jobs that exhausted their deliveries.', inputs: 'Failed jobs from a connected Message Queue or Event Stream (connect queue → DLQ).', outputs: 'None.',
    behavior: 'Counts and retains jobs that failed at a worker after their final delivery.',
    rules: ['Needs a connection from a Message Queue or Event Stream that has a Worker.'],
    fields: [info('retention', 'Retention')], descriptive: { retention: '14 days' },
  }),
  // Reliability
  item({
    kind: 'rateLimiter', label: 'Rate Limiter', category: 'reliability', icon: Gauge, simulated: true,
    description: 'Token-bucket admission control.', inputs: 'Requests.', outputs: firstRoute,
    behavior: 'Tokens refill at the rate up to the burst size. A request without a token fails as “rate-limited”; others are forwarded.',
    rules: ['Must have a downstream connection.', 'Rate 0 with burst below 1 admits nothing.'],
    fields: [sim('ratePerSecond', 'Rate', 'req/s'), sim('burst', 'Burst', 'tokens'), sim('checkLatencyMs', 'Check latency', 'ms'), info('algorithm', 'Algorithm')],
    descriptive: { algorithm: 'Token bucket' },
  }),
  item({
    kind: 'circuitBreaker', label: 'Circuit Breaker', category: 'reliability', icon: CircuitBoard, simulated: true,
    description: 'Fails fast while a downstream dependency is failing.', inputs: 'Requests.', outputs: firstRoute,
    behavior: 'Records the final outcome of each request it forwarded. When failures in the rolling window reach the threshold (with at least the minimum requests), it opens and fails requests immediately for the open period, then closes again.',
    rules: ['Must have a downstream connection.', 'A 0% threshold opens on any failure.'],
    fields: [sim('failureThresholdPct', 'Failure threshold', '%'), sim('minimumRequests', 'Minimum requests'), sim('windowMs', 'Rolling window', 'ms'), sim('openMs', 'Open duration', 'ms'), latency(), info('halfOpen', 'Half-open probes', 'Not simulated: the circuit closes fully after the open period.')],
    descriptive: { halfOpen: 'Closes after open period' },
  }),
  // Observability (visual only)
  item({
    kind: 'metricsCollector', label: 'Metrics Collector', category: 'observability', icon: ChartLine, simulated: false,
    description: 'Scrapes metrics from components.', inputs: 'Telemetry connections from any component.', outputs: 'None.',
    behavior: 'Not simulated. Connections to it never carry requests and it does not affect performance.',
    rules: ['Flagged if nothing sends it telemetry.'],
    fields: [info('backend', 'Backend'), info('scrapeInterval', 'Scrape interval')], descriptive: { backend: 'Prometheus', scrapeInterval: '15 s' },
  }),
  item({
    kind: 'logAggregator', label: 'Log Aggregator', category: 'observability', icon: ScrollText, simulated: false,
    description: 'Collects and indexes logs.', inputs: 'Telemetry connections from any component.', outputs: 'None.',
    behavior: 'Not simulated. Connections to it never carry requests and it does not affect performance.',
    rules: ['Flagged if nothing sends it logs.'],
    fields: [info('backend', 'Backend'), info('retention', 'Retention')], descriptive: { backend: 'Loki', retention: '30 days' },
  }),
];

export const byKind = Object.fromEntries(catalog.map(entry => [entry.kind, entry])) as Record<Kind, CatalogItem>;

/** Same parsing rule as the engine: digits and dots are kept, anything else falls back. */
export function parseConfig(value: string | undefined): number | null {
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
const read = (config: Record<string, string>, kind: Kind, key: string) => parseConfig(config[key]) ?? fallbackOf(kind, key) ?? 0;
const fmt = (value: number) => Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);

/** Short configuration summary for nodes; only simulated parameters appear. */
export function specSummary(kind: Kind, config: Record<string, string>): string {
  const get = (key: string) => fmt(read(config, kind, key));
  switch (kind) {
    case 'client': return 'Traffic source';
    case 'dns': return `${get('cachedPct')}% cached · ${get('lookupLatencyMs')} ms`;
    case 'cdn': return `${get('hitRatio')}% edge hit · ${get('edgeLatencyMs')} ms`;
    case 'loadBalancer': return `round robin · ${get('processingLatencyMs')} ms`;
    case 'reverseProxy': return `round robin · ${get('processingLatencyMs')} ms`;
    case 'gateway': return `${get('concurrency')} slot · ${get('processingLatencyMs')} ms`;
    case 'waf': return `${get('blockRatePct')}% blocked · ${get('inspectionLatencyMs')} ms`;
    case 'server': return `${get('instances')} instances · ${get('processingLatencyMs')} ms`;
    case 'containerService': return `${get('minTasks')}–${get('maxTasks')} tasks × ${get('slotsPerTask')} · ${get('processingLatencyMs')} ms`;
    case 'serverless': return `≤${get('concurrency')} · ${get('executionMs')} ms · cold ${get('coldStartMs')} ms`;
    case 'worker': return `${get('concurrency')} slots · ${get('processingRate')}/s each`;
    case 'database': return `${get('concurrency')} conns · ${get('queryLatencyMs')} ms`;
    case 'readReplica': return `${get('concurrency')} conns · ${get('queryLatencyMs')} ms`;
    case 'nosql': return `r ${get('readLatencyMs')} / w ${get('writeLatencyMs')} ms · ${get('writeRatio')}% w`;
    case 'objectStorage': return `${get('firstByteLatencyMs')} ms + ${get('objectSizeKb')} KB @ ${get('throughputMBps')} MB/s`;
    case 'searchEngine': return `${get('shards')} shards · ${get('queryLatencyMs')}+${get('perShardMs')}/shard ms`;
    case 'cache': return `${get('hitRatio')}% hit · ${get('lookupLatencyMs')} ms`;
    case 'distributedCache': return `${get('nodes')} nodes · ${get('hitRatio')}% hit · ${get('lookupLatencyMs')} ms`;
    case 'queue': return `limit ${get('queueLimit')} · ${get('maxDeliveries')} deliveries`;
    case 'eventStream': return `${get('partitions')} partitions · ${get('maxDeliveries')} deliveries`;
    case 'deadLetterQueue': return 'Receives exhausted jobs';
    case 'rateLimiter': return `${get('ratePerSecond')} req/s · burst ${get('burst')}`;
    case 'circuitBreaker': return `opens at ${get('failureThresholdPct')}% of ≥${get('minimumRequests')}`;
    case 'metricsCollector': case 'logAggregator': return 'Not simulated';
  }
}
export function limitsSummary(kind: Kind, config: Record<string, string>): string | null {
  if (!byKind[kind].fields.some(field => field.key === 'queueLimit')) return null;
  return `queue ${fmt(read(config, kind, 'queueLimit'))} · timeout ${fmt(read(config, kind, 'timeoutMs'))} ms`;
}
