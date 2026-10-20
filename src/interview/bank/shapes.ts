import type { Kind } from '../../app/catalog';
import { V, bench, c, compute, routing, store } from '../problems/helpers';
import type { ArchitectureRole, Benchmark, Category, Concept } from '../types';

/**
 * Workload shapes for question-bank problems. Each shape reuses the simulated benchmark of one of the 12 curated
 * interviews (`base`): the same rate, forced settings, seed and targets, so the curated interview's reference
 * architectures are proven (by tests) to meet it. Benchmark reasons and role explanations are written generically
 * here, so nothing problem-specific from the base problem leaks into another question.
 */
export type ShapeId =
  | 'read-cache' | 'catalog-read' | 'async-delivery' | 'blob' | 'transactional' | 'stream-fanout'
  | 'feed' | 'index-lookup' | 'media-pipeline' | 'realtime-ingest' | 'scheduler' | 'gatekeeper';
type NodeSpec = [id: string, label: string, col: number, row: number, kind: Kind];
export type Shape = {
  id: ShapeId; base: string; label: string; categories: Category[];
  benchmark: Benchmark; roles: ArchitectureRole[];
  unnecessary: Array<{ kinds: Kind[]; why: string }>;
  sharedFollowUps: string[]; lessons: string[]; lld: Kind[];
  /** A generic reference diagram for the shape; questions relabel nodes. */
  diagram: { nodes: NodeSpec[]; edges: Array<[string, string]> };
  designHint: string;
};
const role = (id: string, label: string, kinds: Kind[], required: boolean, why: string, explain: Concept[]): ArchitectureRole => ({ id, label, kinds, required, why, explain });
const hit = (pct: number): Benchmark['overrides'][number] => ({ kinds: ['cache', 'distributedCache', 'cdn'], config: { hitRatio: String(pct) }, reason: `About ${pct}% of reads are served from memory or the edge in this workload shape.` });
const job = (rate: number): Benchmark['overrides'][number] => ({ kinds: ['worker'], config: { processingRate: String(rate) }, reason: `A background job takes about ${Math.round(1000 / rate)} ms per worker slot in this scaled-down benchmark.` });
const STATELESS = [V.stateless]; const REDUNDANT = [V.redundancy];
const ASYNC_FOLLOW_UPS = ['async-retries', 'async-duplicates', 'dedupe-how', 'async-backlog', 'async-ordering', 'traffic-10x', 'partitioning', 'db-down', 'slow-dependency', 'estimate-peak', 'api-abuse'];
const CACHE_FOLLOW_UPS = ['traffic-10x', 'partitioning', 'cache-what', 'cache-miss', 'cache-stampede', 'cache-invalidation', 'cache-down', 'no-cache', 'replica-reads', 'replica-lag', 'replica-failover', 'db-down', 'single-instance', 'consistency-change', 'estimate-peak', 'api-abuse'];

export const SHAPES: Record<ShapeId, Shape> = {
  'read-cache': {
    id: 'read-cache', base: 'url-shortener', label: 'Read-heavy service with a cache', categories: ['caching', 'api'],
    benchmark: bench(2000, 50, [routing, ...compute(5), store(10, 10), hit(90)], 'read-heavy load: 2,000 req/s, most reads repeat, against a store that serves about 1,000 queries/s'),
    roles: [
      role('compute', 'Application tier', ['server', 'containerService', 'serverless'], true, 'Runs the read and write logic; stateless so it can scale out.', STATELESS),
      role('entry', 'Load balancing for availability', ['loadBalancer', 'reverseProxy'], true, 'Spreads requests and survives the loss of a server.', REDUNDANT),
      role('store', 'Durable store', ['database', 'nosql'], true, 'The source of truth must survive failures.', [V.keyAccess, V.durability]),
      role('read-path', 'Read offloading (cache, CDN or replicas)', ['cache', 'distributedCache', 'cdn', 'readReplica'], true, 'Reads far outnumber writes; the store alone cannot serve them at low latency.', [V.readHeavy, V.hitRatio]),
      role('side-effects', 'Asynchronous side effects', ['queue', 'eventStream'], false, 'Counters and events must not slow the read path.', [V.decoupling]),
    ],
    unnecessary: [{ kinds: ['searchEngine'], why: 'Nothing in the core requirements needs full-text search.' }],
    sharedFollowUps: CACHE_FOLLOW_UPS, lessons: ['approach', 'capacity-estimation', 'why-caching', 'horizontal-vertical'], lld: ['cache', 'loadBalancer', 'database'],
    diagram: { nodes: [['u', 'Clients', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['app', 'App servers', 2, 0, 'server'], ['cache', 'Distributed cache', 3, 0, 'distributedCache'], ['db', 'Primary store', 4, 0, 'nosql'], ['events', 'Event stream', 3, 1, 'eventStream'], ['agg', 'Aggregator', 4, 1, 'worker']], edges: [['u', 'lb'], ['lb', 'app'], ['app', 'cache'], ['cache', 'db'], ['app', 'events'], ['events', 'agg']] },
    designHint: 'Reads dominate: what keeps them away from the store, and what happens on a miss?',
  },
  'catalog-read': {
    id: 'catalog-read', base: 'product-catalog', label: 'Browse-heavy service with cached reads', categories: ['caching', 'storage'],
    benchmark: bench(3000, 50, [routing, ...compute(5), store(10, 10), hit(85)], 'browse-heavy load: 3,000 req/s, most reads for popular items, against a database that serves about 1,000 queries/s'),
    roles: [
      role('entry', 'Load balancing for availability', ['loadBalancer', 'reverseProxy'], true, 'Availability across servers.', REDUNDANT),
      role('compute', 'Application tier', ['server', 'containerService', 'serverless'], true, 'Serves reads and accepts writes.', STATELESS),
      role('store', 'Source-of-truth database', ['database', 'nosql'], true, 'Durable, queryable records.', [V.durability, V.keyAccess]),
      role('read-path', 'Read offloading (cache, CDN or replicas)', ['cache', 'distributedCache', 'cdn', 'readReplica'], true, 'Popular items are read far more often than they change.', [V.readHeavy, V.staleness]),
      role('search', 'Search index', ['searchEngine'], false, 'Keyword search and filters need an index, not table scans.', [c('index', 'an inverted index or filters', ['index', 'inverted', 'filter', 'facet', 'full-text'])]),
    ],
    unnecessary: [{ kinds: ['queue', 'eventStream'], why: 'Not needed on the read path; justify it if you use it to update indexes or counters.' }],
    sharedFollowUps: CACHE_FOLLOW_UPS, lessons: ['why-caching', 'bottlenecks', 'capacity-estimation', 'replicas'], lld: ['cache', 'database', 'loadBalancer'],
    diagram: { nodes: [['u', 'Clients', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['app', 'App servers', 2, 0, 'server'], ['cache', 'Distributed cache', 3, 0, 'distributedCache'], ['db', 'Database', 4, 0, 'database'], ['search', 'Search index', 3, 1, 'searchEngine']], edges: [['u', 'lb'], ['lb', 'app'], ['app', 'cache'], ['cache', 'db'], ['app', 'search']] },
    designHint: 'Most traffic reads popular items: cache them, and decide how changes reach readers.',
  },
  'async-delivery': {
    id: 'async-delivery', base: 'notification-service', label: 'Accept fast, process asynchronously', categories: ['messaging', 'reliability'],
    benchmark: bench(1500, 30, [routing, ...compute(5), store(20, 10), job(50)], 'bursty submissions: 1,500 req/s must be accepted quickly while processing continues in the background'),
    roles: [
      role('api', 'Ingestion API', ['server', 'containerService', 'serverless'], true, 'Validates and accepts work quickly.', STATELESS),
      role('queue', 'Durable queue', ['queue', 'eventStream'], true, 'Bursts exceed processing capacity; the excess must wait somewhere durable.', [V.decoupling]),
      role('workers', 'Workers', ['worker'], true, 'Process at a sustainable pace, with retries.', [V.retries, V.idempotency]),
      role('dlq', 'Dead-letter queue', ['deadLetterQueue'], false, 'Work that keeps failing must be kept for inspection.', [c('poison', 'poison messages or inspection', ['poison', 'inspect', 'dead-letter', 'dlq', 'replay'])]),
      role('store', 'Status store', ['database', 'nosql'], false, 'Status and history must persist.', [V.durability]),
    ],
    unnecessary: [{ kinds: ['searchEngine'], why: 'Nothing needs full-text search.' }, { kinds: ['cdn'], why: 'There is no static content to serve.' }],
    sharedFollowUps: ASYNC_FOLLOW_UPS, lessons: ['sync-async', 'capacity-estimation', 'queues-streams', 'dlq', 'idempotency'], lld: ['queue', 'worker', 'circuitBreaker'],
    diagram: { nodes: [['u', 'Producers', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['api', 'Ingestion API', 2, 0, 'server'], ['q', 'Queue', 3, 0, 'queue'], ['w', 'Workers', 4, 0, 'worker'], ['dlq', 'Dead letters', 4, 1, 'deadLetterQueue'], ['db', 'Status store', 5, 0, 'nosql']], edges: [['u', 'lb'], ['lb', 'api'], ['api', 'q'], ['q', 'w'], ['q', 'dlq'], ['w', 'db']] },
    designHint: 'Accept the request, persist the work, and let workers catch up: what happens when they cannot?',
  },
  blob: {
    id: 'blob', base: 'file-storage', label: 'Metadata service plus blob storage and edge delivery', categories: ['storage', 'scalability'],
    benchmark: bench(800, 120, [routing, ...compute(10), store(20, 10), { kinds: ['objectStorage'], config: { concurrency: '15' }, reason: 'Object storage serves about 330 large downloads/s in this workload shape.' }, { kinds: ['cdn', 'cache', 'distributedCache'], config: { hitRatio: '80' }, reason: 'About 80% of downloads are for popular objects held at the edge.' }],
      'downloads and metadata requests, 800 req/s split evenly across the clients you draw'),
    roles: [
      role('api', 'Metadata API', ['server', 'containerService', 'serverless'], true, 'Handles metadata, permissions and signed URLs.', STATELESS),
      role('meta', 'Metadata store', ['database', 'nosql'], true, 'Ownership, versions and permissions are structured data.', [V.keyAccess, V.durability]),
      role('blobs', 'Blob storage', ['objectStorage'], true, 'Durable, cheap storage for large objects.', [c('blob', 'separating bytes from metadata', ['object storage', 'blob', 'bytes', 's3', 'presigned', 'signed url'])]),
      role('edge', 'Edge delivery', ['cdn', 'cache', 'distributedCache'], false, 'Popular objects are downloaded repeatedly, often far from the origin.', [V.readHeavy, V.hitRatio]),
    ],
    unnecessary: [{ kinds: ['searchEngine'], why: 'Search was not required; add it only with a requirement.' }],
    sharedFollowUps: ['traffic-10x', 'db-down', 'single-instance', 'consistency-change', 'cache-what', 'cache-miss', 'cache-invalidation', 'cache-down', 'estimate-peak', 'api-abuse'], lessons: ['capacity-estimation', 'object-storage', 'cdn', 'why-caching'], lld: ['database', 'cache'],
    diagram: { nodes: [['u', 'Uploaders', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['api', 'Metadata API', 2, 0, 'server'], ['db', 'Metadata DB', 3, 0, 'database'], ['d', 'Viewers', 0, 1, 'client'], ['cdn', 'CDN', 1, 1, 'cdn'], ['os', 'Object storage', 3, 1, 'objectStorage']], edges: [['u', 'lb'], ['lb', 'api'], ['api', 'db'], ['d', 'cdn'], ['cdn', 'os']] },
    designHint: 'Keep large bytes out of the app servers: metadata in a database, objects in object storage, popular ones at the edge.',
  },
  transactional: {
    id: 'transactional', base: 'checkout', label: 'Transactional writes with asynchronous follow-up work', categories: ['reliability', 'distributed'],
    benchmark: bench(1500, 60, [routing, ...compute(10), store(30, 10)], 'peak transactions: 1,500 req/s; the database handles about 3,000 queries/s'),
    roles: [
      role('entry', 'Load balancing for availability', ['loadBalancer', 'reverseProxy'], true, 'Availability during peaks.', REDUNDANT),
      role('compute', 'Application tier', ['server', 'containerService'], true, 'Orchestrates the transaction.', STATELESS),
      role('db', 'Transactional database', ['database'], true, 'Correctness needs transactions and constraints.', [c('tx', 'transactions or strong consistency', ['transaction', 'acid', 'atomic', 'strong consisten', 'serializ', 'row lock', 'constraint']), V.durability]),
      role('async', 'Asynchronous follow-up', ['queue', 'eventStream'], true, 'Side effects (emails, downstream updates) must not slow or fail the main write.', [V.decoupling]),
      role('workers', 'Follow-up workers', ['worker'], true, 'Run the side effects with retries.', [V.retries, V.idempotency]),
      role('breaker', 'Dependency protection', ['circuitBreaker'], false, 'A slow dependency must not exhaust request threads.', [c('fail-fast', 'failing fast', ['fail fast', 'circuit', 'timeout', 'fallback'])]),
    ],
    unnecessary: [{ kinds: ['searchEngine', 'cdn'], why: 'This is a write path; there is nothing to search or cache at the edge.' }],
    sharedFollowUps: ASYNC_FOLLOW_UPS.concat(['single-instance']), lessons: ['sync-async', 'capacity-estimation', 'idempotency', 'transactions', 'circuit-breakers'], lld: ['queue', 'worker', 'circuitBreaker', 'database'],
    diagram: { nodes: [['u', 'Clients', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['app', 'App servers', 2, 0, 'server'], ['db', 'Transactional DB', 3, 0, 'database'], ['q', 'Outbox / queue', 4, 0, 'queue'], ['w', 'Workers', 5, 0, 'worker']], edges: [['u', 'lb'], ['lb', 'app'], ['app', 'db'], ['db', 'q'], ['q', 'w']] },
    designHint: 'Make the critical write atomic and idempotent; move everything else after the commit.',
  },
  'stream-fanout': {
    id: 'stream-fanout', base: 'chat', label: 'Real-time events fanned out to subscribers', categories: ['messaging', 'distributed'],
    benchmark: bench(2000, 40, [routing, ...compute(5), store(40, 10), job(100)], 'event sends: 2,000/s must be accepted quickly while fan-out continues in the background'),
    roles: [
      role('connections', 'Connection tier', ['gateway', 'loadBalancer', 'reverseProxy'], true, 'Many long-lived client connections need a dedicated entry tier.', [c('persistent', 'persistent connections (WebSocket or long poll)', ['websocket', 'web socket', 'long poll', 'persistent connection', 'sse', 'server-sent'])]),
      role('compute', 'Event service', ['server', 'containerService'], true, 'Validates, orders and persists events.', STATELESS),
      role('fanout', 'Fan-out stream', ['eventStream', 'queue'], true, 'Events reach many subscribers asynchronously.', [V.decoupling, V.partitioning]),
      role('delivery', 'Delivery workers', ['worker'], false, 'Push events to connected clients or push services.', [V.retries]),
      role('store', 'Partitioned history store', ['nosql', 'database'], true, 'Durable, partitioned history.', [V.partitioning, V.durability]),
    ],
    unnecessary: [{ kinds: ['searchEngine'], why: 'Search was not required.' }, { kinds: ['cdn'], why: 'No static content in scope.' }],
    sharedFollowUps: ASYNC_FOLLOW_UPS, lessons: ['sync-async', 'capacity-estimation', 'queues-streams', 'ordering-retries', 'sharding'], lld: ['gateway', 'queue', 'worker'],
    diagram: { nodes: [['u', 'Clients', 0, 0, 'client'], ['gw', 'Connection gateway', 1, 0, 'gateway'], ['app', 'Event service', 2, 0, 'server'], ['s', 'Event stream', 3, 0, 'eventStream'], ['w', 'Fan-out workers', 4, 0, 'worker'], ['db', 'History store', 5, 0, 'nosql']], edges: [['u', 'gw'], ['gw', 'app'], ['app', 's'], ['s', 'w'], ['w', 'db']] },
    designHint: 'Persist the event once, then fan it out to subscribers through a partitioned stream.',
  },
  feed: {
    id: 'feed', base: 'news-feed', label: 'Precomputed timelines with background fan-out', categories: ['scalability', 'caching'],
    benchmark: bench(4000, 50, [routing, ...compute(5), store(30, 10), hit(90), job(100)], 'reads and posts, 4,000 req/s split evenly across the clients you draw; the store serves about 3,000 queries/s'),
    roles: [
      role('entry', 'Load balancing for availability', ['loadBalancer', 'reverseProxy'], true, 'Availability for the read path.', REDUNDANT),
      role('compute', 'Application tier', ['server', 'containerService'], true, 'Serves reads and accepts posts.', STATELESS),
      role('timelines', 'Precomputed results in memory', ['distributedCache', 'cache'], true, 'Reads must not assemble results from scratch each time.', [V.readHeavy, V.hitRatio]),
      role('fanout', 'Background fan-out', ['queue', 'eventStream'], true, 'New items are distributed to readers in the background.', [V.decoupling]),
      role('workers', 'Fan-out workers', ['worker'], false, 'Write items into readers’ precomputed results.', [V.retries]),
      role('store', 'Durable store', ['nosql', 'database'], true, 'Durable items and relationships.', [V.durability, V.partitioning]),
    ],
    unnecessary: [{ kinds: ['searchEngine'], why: 'Search is out of scope.' }],
    sharedFollowUps: ['traffic-10x', 'partitioning', 'cache-what', 'cache-miss', 'cache-stampede', 'cache-invalidation', 'cache-down', 'no-cache', 'async-retries', 'async-duplicates', 'async-backlog', 'async-ordering', 'db-down', 'consistency-change', 'estimate-peak'],
    lessons: ['why-caching', 'sync-async', 'capacity-estimation', 'hot-partitions', 'bottlenecks'], lld: ['cache', 'queue', 'worker'],
    diagram: { nodes: [['r', 'Readers', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['app', 'Read service', 2, 0, 'server'], ['tl', 'Precomputed results', 3, 0, 'distributedCache'], ['db', 'Store', 4, 0, 'nosql'], ['p', 'Writers', 0, 1, 'client'], ['ws', 'Write service', 1, 1, 'server'], ['s', 'Fan-out stream', 2, 1, 'eventStream'], ['w', 'Fan-out workers', 3, 1, 'worker']], edges: [['r', 'lb'], ['lb', 'app'], ['app', 'tl'], ['tl', 'db'], ['p', 'ws'], ['ws', 's'], ['s', 'w'], ['w', 'db']] },
    designHint: 'Decide when results are computed: on write (fan-out) or on read, and handle very popular producers.',
  },
  'index-lookup': {
    id: 'index-lookup', base: 'autocomplete', label: 'Low-latency lookups against a prebuilt index', categories: ['caching', 'storage'],
    benchmark: bench(3500, 30, [routing, ...compute(3), store(10, 10), { kinds: ['searchEngine'], config: { queryLatencyMs: '20', perShardMs: '5', concurrency: '16' }, reason: 'A full index query takes about 45 ms in this workload shape.' }, hit(97)], 'lookup traffic: 3,500 req/s with a 30 ms p95 budget'),
    roles: [
      role('entry', 'Load balancing', ['loadBalancer', 'reverseProxy', 'cdn'], true, 'Spreads a high request rate.', REDUNDANT),
      role('compute', 'Query service', ['server', 'containerService'], true, 'Parses the request and queries the index.', STATELESS),
      role('index', 'Prebuilt index', ['distributedCache', 'cache', 'nosql', 'searchEngine'], true, 'Lookups must be answered from a structure built ahead of time.', [c('index', 'a prebuilt index (inverted index, trie, geo index)', ['index', 'trie', 'inverted', 'geohash', 'quadtree', 'precomput', 'top-k'])]),
      role('edge', 'Hot-result cache', ['cdn', 'cache', 'distributedCache'], false, 'A small set of queries is asked constantly.', [V.readHeavy, V.hitRatio]),
      role('pipeline', 'Index-building pipeline', ['eventStream', 'queue', 'worker'], false, 'The index is rebuilt or updated off the request path.', [V.decoupling]),
    ],
    unnecessary: [{ kinds: ['objectStorage'], why: 'Not needed for serving lookups (it may hold raw data for the offline pipeline).' }],
    sharedFollowUps: ['traffic-10x', 'partitioning', 'cache-what', 'cache-miss', 'cache-stampede', 'cache-invalidation', 'cache-down', 'no-cache', 'single-instance', 'slow-dependency', 'estimate-peak'], lessons: ['why-caching', 'capacity-estimation', 'search', 'cdn-caching'], lld: ['cache', 'loadBalancer'],
    diagram: { nodes: [['u', 'Clients', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['app', 'Query service', 2, 0, 'server'], ['k', 'Hot results', 3, 0, 'distributedCache'], ['idx', 'Index', 4, 0, 'searchEngine'], ['s', 'Update stream', 3, 1, 'eventStream'], ['w', 'Index builder', 4, 1, 'worker']], edges: [['u', 'lb'], ['lb', 'app'], ['app', 'k'], ['k', 'idx'], ['s', 'w']] },
    designHint: 'Build the index ahead of time and serve the hottest answers from memory.',
  },
  'media-pipeline': {
    id: 'media-pipeline', base: 'video-processing', label: 'Heavy background processing with durable outputs', categories: ['messaging', 'storage'],
    benchmark: bench(300, 80, [routing, ...compute(10), store(20, 10), job(2)], 'submissions, 300 req/s split evenly across clients, accepted quickly while ~500 ms jobs run in the background'),
    roles: [
      role('api', 'Submission API', ['server', 'containerService', 'serverless'], true, 'Accepts work and reports status.', STATELESS),
      role('queue', 'Job queue', ['queue', 'eventStream'], true, 'Processing is slow and bursty; jobs must wait durably.', [V.decoupling]),
      role('workers', 'Processing workers', ['worker'], true, 'Do the heavy work in parallel.', [V.retries, c('parallel', 'parallel or chunked processing', ['parallel', 'chunk', 'segment', 'split', 'fan out'])]),
      role('storage', 'Object storage', ['objectStorage'], true, 'Large inputs and outputs need durable, cheap storage.', [V.durability]),
      role('cdn', 'Edge delivery', ['cdn'], false, 'Outputs are read many times worldwide.', [V.readHeavy]),
      role('meta', 'Status store', ['database', 'nosql'], false, 'Job and item status.', [V.keyAccess]),
    ],
    unnecessary: [{ kinds: ['searchEngine'], why: 'Search is out of scope.' }, { kinds: ['rateLimiter'], why: 'Not needed for this pipeline unless you justify abuse limits.' }],
    sharedFollowUps: ['async-retries', 'async-duplicates', 'dedupe-how', 'async-backlog', 'async-ordering', 'traffic-10x', 'slow-dependency', 'estimate-peak'], lessons: ['sync-async', 'capacity-estimation', 'object-storage', 'worker-pools', 'cdn'], lld: ['queue', 'worker'],
    diagram: { nodes: [['u', 'Clients', 0, 0, 'client'], ['api', 'Submission API', 1, 0, 'server'], ['q', 'Job queue', 2, 0, 'queue'], ['w', 'Workers', 3, 0, 'worker'], ['os', 'Object storage', 4, 0, 'objectStorage'], ['v', 'Viewers', 2, 1, 'client'], ['cdn', 'CDN', 3, 1, 'cdn']], edges: [['u', 'api'], ['api', 'q'], ['q', 'w'], ['w', 'os'], ['v', 'cdn'], ['cdn', 'os']] },
    designHint: 'Never do the heavy work in the request: queue it, process it in parallel, store the results durably.',
  },
  'realtime-ingest': {
    id: 'realtime-ingest', base: 'ride-booking', label: 'High-rate ingestion with hot state in memory', categories: ['distributed', 'scalability'],
    benchmark: bench(5000, 40, [routing, ...compute(4), store(20, 5), job(200)], 'high-rate events and queries, 5,000 req/s split evenly across the clients you draw; the store handles about 4,000 writes/s'),
    roles: [
      role('ingest', 'Partitioned ingestion stream', ['eventStream', 'queue'], true, 'A very high event rate needs a partitioned buffer.', [V.partitioning, V.decoupling]),
      role('state', 'Hot state in memory', ['distributedCache', 'cache', 'nosql'], true, 'The latest aggregates or positions must be queryable immediately.', [c('in-memory', 'in-memory state or aggregates', ['in memory', 'in-memory', 'redis', 'sorted set', 'aggregate', 'counter', 'window'])]),
      role('compute', 'Ingest and query services', ['server', 'containerService'], true, 'Accept events and answer queries.', STATELESS),
      role('store', 'Durable store', ['database', 'nosql'], true, 'Durable records for history and recovery.', [V.durability]),
      role('workers', 'Stream consumers', ['worker'], false, 'Update state from the stream.', [V.retries]),
    ],
    unnecessary: [{ kinds: ['searchEngine'], why: 'Search is out of scope.' }, { kinds: ['cdn'], why: 'No static content is part of this design.' }],
    sharedFollowUps: ['async-backlog', 'async-ordering', 'async-duplicates', 'dedupe-how', 'async-retries', 'traffic-10x', 'partitioning', 'db-down', 'slow-dependency', 'estimate-peak'], lessons: ['capacity-estimation', 'sharding', 'hot-partitions', 'queues-streams'], lld: ['queue', 'worker', 'cache'],
    diagram: { nodes: [['p', 'Event producers', 0, 0, 'client'], ['ing', 'Ingest service', 1, 0, 'server'], ['s', 'Partitioned stream', 2, 0, 'eventStream'], ['w', 'Consumers', 3, 0, 'worker'], ['st', 'Hot state', 4, 0, 'distributedCache'], ['q', 'Readers', 0, 1, 'client'], ['lb', 'Load balancer', 1, 1, 'loadBalancer'], ['api', 'Query service', 2, 1, 'server'], ['db', 'Durable store', 3, 1, 'database']], edges: [['p', 'ing'], ['ing', 's'], ['s', 'w'], ['w', 'st'], ['q', 'lb'], ['lb', 'api'], ['api', 'db']] },
    designHint: 'Buffer the event firehose in a partitioned stream and keep the queryable state in memory.',
  },
  scheduler: {
    id: 'scheduler', base: 'job-scheduler', label: 'Durable work items dispatched to workers', categories: ['distributed', 'reliability'],
    benchmark: bench(1000, 40, [routing, ...compute(5), store(20, 10), job(20)], 'registrations and dispatches, 1,000 req/s split evenly across the clients you draw'),
    roles: [
      role('api', 'Control API', ['server', 'containerService', 'serverless'], true, 'Registers and manages work items.', STATELESS),
      role('store', 'Durable work store', ['database', 'nosql'], true, 'Work items must survive crashes and be found when due.', [V.durability, c('time-index', 'an index by due time or state', ['index', 'due time', 'next run', 'state', 'priority'])]),
      role('dispatch', 'Dispatch queue', ['queue', 'eventStream'], true, 'Due work is handed to workers through a queue.', [V.decoupling]),
      role('workers', 'Workers', ['worker'], true, 'Run the work.', [V.retries, V.idempotency]),
      role('dlq', 'Dead-letter queue', ['deadLetterQueue'], false, 'Work that keeps failing needs attention.', [c('poison', 'poison work or inspection', ['poison', 'inspect', 'dead-letter', 'dlq', 'alert'])]),
      role('telemetry', 'Monitoring', ['metricsCollector', 'logAggregator'], false, 'Silent failures must be visible.', [c('observe', 'metrics or alerting', ['metric', 'alert', 'monitor', 'dashboard', 'log'])]),
    ],
    unnecessary: [{ kinds: ['cdn', 'searchEngine'], why: 'No static content or text search.' }],
    sharedFollowUps: ['async-retries', 'async-duplicates', 'dedupe-how', 'async-backlog', 'async-ordering', 'traffic-10x', 'db-down', 'slow-dependency', 'single-instance'], lessons: ['sync-async', 'capacity-estimation', 'locks-leases', 'coordination', 'dlq', 'signals'], lld: ['queue', 'worker', 'database'],
    diagram: { nodes: [['c', 'Clients', 0, 0, 'client'], ['lb', 'Load balancer', 1, 0, 'loadBalancer'], ['api', 'Control API', 2, 0, 'server'], ['db', 'Work store', 3, 0, 'database'], ['t', 'Dispatcher', 0, 1, 'client'], ['q', 'Dispatch queue', 1, 1, 'queue'], ['w', 'Workers', 2, 1, 'worker'], ['dlq', 'Dead letters', 3, 1, 'deadLetterQueue']], edges: [['c', 'lb'], ['lb', 'api'], ['api', 'db'], ['t', 'q'], ['q', 'w'], ['q', 'dlq']] },
    designHint: 'Store the work durably, find what is due cheaply, and make running it twice harmless.',
  },
  gatekeeper: {
    id: 'gatekeeper', base: 'rate-limiter', label: 'Admission control in front of a fragile backend', categories: ['api', 'reliability'],
    benchmark: bench(3000, 50, [routing, ...compute(5), store(10, 10)], 'an abusive burst: 3,000 req/s against a backend that handles about 1,000 queries/s', 30),
    roles: [
      role('entry', 'Single entry point', ['gateway', 'loadBalancer', 'reverseProxy'], true, 'Requests need one place where policies apply before the servers.', REDUNDANT),
      role('limiter', 'Admission control', ['rateLimiter'], true, 'Excess requests must be rejected early and cheaply.', [c('reject', 'rejecting early (429)', ['429', 'reject', 'too many', 'shed', 'drop', 'token bucket'])]),
      role('compute', 'Protected services', ['server', 'containerService', 'serverless'], true, 'The services behind the entry point.', STATELESS),
      role('backend', 'Backend store', ['database', 'nosql'], true, 'The fragile dependency the policies protect.', [V.durability]),
      role('counters', 'Shared state', ['distributedCache', 'cache'], false, 'Policies across many nodes need shared counters or configuration.', [c('shared', 'shared counters or state', ['shared', 'central', 'redis', 'counter', 'distributed'])]),
    ],
    unnecessary: [{ kinds: ['searchEngine', 'objectStorage'], why: 'Admission control needs no search or file storage.' }, { kinds: ['queue', 'eventStream'], why: 'Queueing excess requests does not limit them; it delays the overload.' }],
    sharedFollowUps: ['traffic-10x', 'slow-dependency', 'db-down', 'single-instance', 'estimate-peak'], lessons: ['performance-metrics', 'bottlenecks', 'rate-limiting', 'load-shedding'], lld: ['rateLimiter', 'gateway', 'circuitBreaker'],
    diagram: { nodes: [['u', 'Clients', 0, 0, 'client'], ['gw', 'Gateway', 1, 0, 'gateway'], ['rl', 'Rate limiter', 2, 0, 'rateLimiter'], ['app', 'Services', 3, 0, 'server'], ['db', 'Backend store', 4, 0, 'database'], ['k', 'Shared counters', 2, 1, 'distributedCache']], edges: [['u', 'gw'], ['gw', 'rl'], ['rl', 'app'], ['app', 'db'], ['rl', 'k']] },
    designHint: 'Decide what is admitted at the entry point, by which key, and what rejected clients receive.',
  },
};
export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];
