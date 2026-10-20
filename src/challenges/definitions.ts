import type { ComponentKind, Fault } from '../simulation/engine';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };
export const DIFFICULTY_POINTS: Record<Difficulty, number> = { easy: 100, medium: 200, hard: 300, expert: 500 };

export type Comparator = '<=' | '<' | '>=' | '>';
/**
 * What a criterion measures. Every metric is computed from engine output or the architecture's
 * validation; anything the simulator cannot measure is declared `unsupported`.
 */
export type Metric =
  | { kind: 'latency'; percentile: 'p50' | 'p95' | 'p99' }
  | { kind: 'successThroughput' }
  | { kind: 'errorRate' }
  | { kind: 'deadComponents' }
  | { kind: 'fixturesIntact' }
  | { kind: 'computeSlots' }
  | { kind: 'loadShare'; nodeId: string }
  | { kind: 'maxQueue'; nodeId: string }
  /** Engine-reported busy fraction of one component over the run, as a percentage. */
  | { kind: 'utilization'; nodeId: string }
  | { kind: 'failureShareAt'; nodeId: string }
  | { kind: 'processedBy'; nodeId?: string; kinds?: ComponentKind[] }
  | { kind: 'unsupported'; reason: string };
export type Criterion = {
  id: string; label: string; metric: Metric; comparator: Comparator; threshold: number; unit: string;
  /** Mandatory criteria must all pass; informational ones are reported but never decide the result. */
  mandatory: boolean;
  /** Shown when the criterion fails. */
  advice: string;
};

export type FixtureSpec = { kind: ComponentKind; label: string; description: string; locked: Record<string, string> };
export type StarterNode = { id: string; kind: ComponentKind; label: string; x: number; y: number; config?: Record<string, string> };
export type Workload = {
  rps: number; durationMs: number; trafficDurationMs?: number; seed: number; pattern: string;
  /** Settings the benchmark forces on every component of these kinds (e.g. per-request compute cost). */
  overrides: Array<{ kinds: ComponentKind[]; config: Record<string, string>; reason: string }>;
  faults: Array<Fault & { description: string }>;
  /** Engine event budget for high-traffic benchmarks (default 100,000). A run that reaches it is never graded. */
  maxEvents?: number;
};
export type Challenge = {
  id: string; number: number; title: string; difficulty: Difficulty; topics: string[];
  /** Rough time for a first solve, shown as an estimate only. */
  estimatedMinutes: number;
  /** What the learner should understand after solving it. */
  learningObjectives: string[];
  /** Component kinds whose low-level design (LLD view) illustrates the concepts tested. */
  relatedDesigns: ComponentKind[];
  summary: string; statement: string; scenario: string;
  /** What the system must do. */
  functional: string[];
  /** How well it must do it (latency, throughput, errors, budgets); each is backed by acceptance criteria. */
  requirements: string[]; completion?: string;
  workload: Workload; criteria: Criterion[]; hints: string[];
  fixtures: Record<string, FixtureSpec>;
  starter: { nodes: StarterNode[]; edges: Array<[string, string]> };
};

const COMPUTE: ComponentKind[] = ['server', 'containerService'];
const computeCost = (ms: number, reason = `Each request needs ${ms} ms of application work, wherever it runs.`) => ({ kinds: COMPUTE, config: { processingLatencyMs: String(ms) }, reason });
const serverlessCost = (ms: number) => ({ kinds: ['serverless'] as ComponentKind[], config: { executionMs: String(ms) }, reason: `Serverless functions run the same ${ms} ms of work.` });
const routingCost = { kinds: ['loadBalancer', 'reverseProxy', 'gateway'] as ComponentKind[], config: { processingLatencyMs: '1' }, reason: 'Routing components take 1 ms per request.' };
const noDead: Criterion = { id: 'dead', label: 'No dead components', metric: { kind: 'deadComponents' }, comparator: '<=', threshold: 0, unit: 'components', mandatory: true, advice: 'Open “Show issues” and connect or remove the dead components.' };
const fixtures: Criterion = { id: 'fixtures', label: 'Given systems kept', metric: { kind: 'fixturesIntact' }, comparator: '<=', threshold: 0, unit: 'missing', mandatory: true, advice: 'Restore the starter architecture to bring back the given systems.' };
const processedByCompute = (min = 99): Criterion => ({ id: 'compute', label: `≥ ${min}% of successful requests run application code`, metric: { kind: 'processedBy', kinds: ['server', 'containerService', 'serverless'] }, comparator: '>=', threshold: min, unit: '%', mandatory: true, advice: 'Every request must pass through an Application Server, Container Service or Serverless Function.' });
const errorBelow = (pct: number, label = `Error rate < ${pct}%`): Criterion => ({ id: 'errors', label, metric: { kind: 'errorRate' }, comparator: '<', threshold: pct, unit: '%', mandatory: true, advice: 'Check “Runtime failures by cause” and the bottleneck list: timeouts and rejections mean a component is out of capacity.' });
const p95Below = (ms: number, label = `p95 latency ≤ ${ms} ms`): Criterion => ({ id: 'p95', label, metric: { kind: 'latency', percentile: 'p95' }, comparator: '<=', threshold: ms, unit: 'ms', mandatory: true, advice: 'High p95 usually means requests wait in a queue. Add capacity at the most utilized component.' });
const throughputAtLeast = (rps: number): Criterion => ({ id: 'throughput', label: `Successful throughput ≥ ${rps.toLocaleString()} req/s`, metric: { kind: 'successThroughput' }, comparator: '>=', threshold: rps, unit: 'req/s', mandatory: true, advice: 'Offered traffic only counts once it completes successfully. Find where requests fail and add capacity there.' });

export const challenges: Challenge[] = [
  {
    id: 'slow-api', number: 1, title: 'The Slow API', difficulty: 'easy', topics: ['Horizontal scaling', 'Latency'],
    estimatedMinutes: 10,
    learningObjectives: ['Use Little’s law to estimate how many concurrent slots a workload needs', 'Tell queueing delay apart from processing time in p95 latency', 'Scale horizontally (more instances or servers behind a load balancer) within a budget'],
    relatedDesigns: ['server', 'loadBalancer'],
    summary: 'A profile API melts down at launch traffic. Make it fast again within a compute budget.',
    statement: 'Your profile service runs on one Application Server with 2 instances. Every request needs 40 ms of CPU work. Launch traffic is 300 requests per second, and the API is timing out.',
    scenario: 'A mobile app launch sends steady traffic to the profile endpoint. You can scale compute and add routing, but each request still costs 40 ms of work and the compute budget is 24 slots.',
    functional: ['Serve every profile request sent by the Mobile App', 'Every request runs the profile application code (40 ms of work)'],
    requirements: ['Serve 300 req/s for 10 s', 'Keep p95 latency at or below 100 ms', 'Keep the error rate under 1%', 'Use at most 24 compute slots (instances, task slots or function concurrency)'],
    workload: { rps: 300, durationMs: 11_000, trafficDurationMs: 10_000, seed: 101, pattern: 'Constant rate for 10 s, then 1 s with no new arrivals so in-flight requests can finish', overrides: [computeCost(40), serverlessCost(40), routingCost], faults: [] },
    criteria: [p95Below(100), throughputAtLeast(297), errorBelow(1), processedByCompute(),
      { id: 'budget', label: 'Compute slots ≤ 24', metric: { kind: 'computeSlots' }, comparator: '<=', threshold: 24, unit: 'slots', mandatory: true, advice: 'Count instances (servers), max tasks × slots (containers) and concurrency (functions). You need about 300 × 0.04 = 12 busy slots.' },
      noDead],
    hints: ['Little’s law: busy slots ≈ arrival rate × time per request.', '300 req/s × 40 ms ≈ 12 slots are busy on average, so 2 instances can never keep up.', 'Raise the API’s instances, or put a Load Balancer in front of several servers. Leave a little headroom above 12.'],
    fixtures: {},
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Mobile App', x: 0, y: 120 }, { id: 'api', kind: 'server', label: 'Profile API', x: 300, y: 120, config: { instances: '2' } }], edges: [['users', 'api']] },
  },
  {
    id: 'cache-it-right', number: 2, title: 'Cache It Right', difficulty: 'easy', topics: ['Caching', 'Database bottleneck'],
    estimatedMinutes: 15,
    learningObjectives: ['Explain how a cache in the request path reduces load on the store behind it', 'Relate hit ratio to the request rate that still reaches the database', 'Recognize that a cache only helps when requests actually pass through it'],
    relatedDesigns: ['cache', 'database'],
    summary: 'The orders database can serve 200 req/s. Traffic is 500. Keep it standing without scaling it.',
    statement: 'The Orders DB is a given system: 8 connections at 40 ms per query, about 200 queries per second. It cannot be resized. The product page sends 500 requests per second through the Orders API.',
    scenario: 'Reads dominate. Any cache you add sees an 80% hit ratio for this access pattern; misses still go to the database.',
    functional: ['Serve every product-page request through the Orders API', 'The Orders DB stays the source of truth: cache misses read from it', 'Keep the given Orders DB; it cannot be resized'],
    requirements: ['Serve 500 req/s for 10 s', 'p95 latency ≤ 60 ms', 'Error rate under 1%', 'At most 30% of requests may reach the Orders DB', 'Orders DB utilization at most 70%'],
    workload: { rps: 500, durationMs: 11_000, trafficDurationMs: 10_000, seed: 202, pattern: 'Constant rate for 10 s, then 1 s with no new arrivals so in-flight requests can finish', overrides: [computeCost(10), serverlessCost(10), routingCost, { kinds: ['cache', 'distributedCache', 'cdn'], config: { hitRatio: '80' }, reason: 'This access pattern produces an 80% hit ratio in any cache.' }], faults: [] },
    criteria: [p95Below(60), throughputAtLeast(495), errorBelow(1),
      { id: 'db-load', label: '≤ 30% of requests reach the Orders DB', metric: { kind: 'loadShare', nodeId: 'orders-db' }, comparator: '<=', threshold: 30, unit: '%', mandatory: true, advice: 'Measured from request traces: a cache only helps if requests actually pass through it before the database.' },
      { id: 'db-util', label: 'Orders DB utilization ≤ 70%', metric: { kind: 'utilization', nodeId: 'orders-db' }, comparator: '<=', threshold: 70, unit: '%', mandatory: true, advice: 'Engine metric: the share of the run the Orders DB’s 8 connections were busy. Fewer requests reaching it means a lower number.' },
      fixtures, noDead],
    hints: ['The database needs 500 × 40 ms = 20 busy connections but has 8.', 'An 80% hit ratio sends only 20% of requests (100 req/s) to the database.', 'Put the Cache between the Orders API and the Orders DB, and make sure its capacity covers 500 lookups per second.'],
    fixtures: { 'orders-db': { kind: 'database', label: 'Orders DB', description: 'Given system: 8 connections, 40 ms per query.', locked: { concurrency: '8', queryLatencyMs: '40', queueLimit: '500', timeoutMs: '500' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Product Pages', x: 0, y: 120 }, { id: 'api', kind: 'server', label: 'Orders API', x: 300, y: 120, config: { instances: '8' } }, { id: 'orders-db', kind: 'database', label: 'Orders DB', x: 900, y: 120 }], edges: [['users', 'api'], ['api', 'orders-db']] },
  },
  {
    id: 'scale-the-backend', number: 3, title: 'Scale the Backend', difficulty: 'medium', topics: ['Load balancing', 'Horizontal scaling'],
    estimatedMinutes: 20,
    learningObjectives: ['Find every saturated component, not only the obvious one', 'Size a load balancer and a compute tier for a target throughput', 'Distinguish offered traffic from successful throughput'],
    relatedDesigns: ['loadBalancer', 'server'],
    summary: 'Traffic grows to 1,500 req/s. Scale out behind the load balancer without blowing the budget.',
    statement: 'A load balancer fronts one 3-instance application server. Each request needs 20 ms of application work and 1 ms in the load balancer. Traffic grows to 1,500 requests per second.',
    scenario: 'Find every component that runs out of capacity, not only the obvious one. The Sessions DB is a given system with plenty of headroom.',
    functional: ['Serve every web request through application code', 'Keep the given Sessions DB'],
    requirements: ['Serve 1,500 req/s for 10 s', 'Successful throughput ≥ 1,485 req/s', 'Error rate under 1%', 'p95 ≤ 50 ms', 'At most 40 compute slots'],
    workload: { rps: 1500, durationMs: 11_000, trafficDurationMs: 10_000, seed: 303, pattern: 'Constant rate for 10 s, then 1 s with no new arrivals so in-flight requests can finish', overrides: [computeCost(20), serverlessCost(20), routingCost], faults: [] },
    criteria: [throughputAtLeast(1485), errorBelow(1), p95Below(50), processedByCompute(),
      { id: 'budget', label: 'Compute slots ≤ 40', metric: { kind: 'computeSlots' }, comparator: '<=', threshold: 40, unit: 'slots', mandatory: true, advice: 'You need about 1,500 × 0.02 = 30 busy slots; spend the rest as headroom.' },
      fixtures, noDead],
    hints: ['Compute needs about 30 busy slots, but check every component’s utilization in the results.', 'A load balancer with 1 slot at 1 ms per request tops out at 1,000 req/s.', 'Raise the load balancer’s concurrency and add servers or instances behind it.'],
    fixtures: { 'sessions-db': { kind: 'database', label: 'Sessions DB', description: 'Given system: 60 connections, 8 ms per query.', locked: { concurrency: '60', queryLatencyMs: '8', queueLimit: '500', timeoutMs: '500' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Web Clients', x: 0, y: 120 }, { id: 'lb', kind: 'loadBalancer', label: 'Load Balancer', x: 286, y: 120 }, { id: 'app-1', kind: 'server', label: 'App Server 1', x: 572, y: 120, config: { instances: '3' } }, { id: 'sessions-db', kind: 'database', label: 'Sessions DB', x: 900, y: 120 }], edges: [['users', 'lb'], ['lb', 'app-1'], ['app-1', 'sessions-db']] },
  },
  {
    id: 'async-processing', number: 4, title: 'Async Processing', difficulty: 'medium', topics: ['Message queues', 'Workers'],
    estimatedMinutes: 20,
    learningObjectives: ['Decouple accepting work from doing it with a queue (separation of concerns)', 'Reason about backlog growth and drain time when arrivals exceed processing rate', 'Read success as “accepted”, and check completion separately'],
    relatedDesigns: ['queue', 'worker'],
    summary: 'Image resizing takes 200 ms. Accept uploads fast and still process every one before the run ends.',
    statement: 'The Image Processor is a given worker pool: 30 slots, 200 ms per image (150 images/s). Uploads arrive at 180 per second for 8 seconds; the benchmark then keeps running for 4 more seconds so queued work can drain.',
    scenario: 'Today the Upload API calls the processor synchronously, so users wait for the resize and requests pile up.',
    completion: 'An upload succeeds when the Upload path accepts it: it completes either after synchronous processing or when it is durably enqueued. Separately, every accepted upload must be processed by the Image Processor before the 12 s benchmark ends.',
    functional: ['Accept image uploads from the Uploaders', 'Every accepted upload is resized by the given Image Processor', 'Keep the given Image Processor'],
    requirements: ['180 uploads/s for 8 s, then a 4 s drain', 'Accept p95 ≤ 50 ms', 'Error rate under 1%', '≥ 99% of accepted uploads processed by the Image Processor by the end of the run'],
    workload: { rps: 180, durationMs: 12_000, trafficDurationMs: 8_000, seed: 505, pattern: 'Constant rate for 8 s, then no new arrivals for 4 s', overrides: [computeCost(5, 'The Upload API’s own work is 5 ms per request.'), serverlessCost(5), routingCost], faults: [] },
    criteria: [p95Below(50, 'Accept p95 ≤ 50 ms'), throughputAtLeast(178), errorBelow(1),
      { id: 'processed', label: '≥ 99% of accepted uploads processed', metric: { kind: 'processedBy', nodeId: 'processor' }, comparator: '>=', threshold: 99, unit: '%', mandatory: true, advice: 'Counted from traces: the upload itself, or a completed job it enqueued, must have been processed by the Image Processor before the run ended.' },
      fixtures, noDead],
    hints: ['Synchronous processing makes users wait 200 ms or more, and the pool handles only 150/s.', 'A Message Queue lets the Upload API accept work in a few milliseconds.', 'Separate accepting an upload from processing it (separation of concerns): the API should only enqueue. The Message Queue’s LLD shows the producer and consumer sides as separate roles.', 'Connect Upload API → Message Queue → Image Processor. 30/s of backlog for 8 s drains well within the extra 4 s.'],
    fixtures: { processor: { kind: 'worker', label: 'Image Processor', description: 'Given worker pool: 30 slots, 200 ms per image, long timeout.', locked: { concurrency: '30', processingRate: '5', processingLatencyMs: '200', queueLimit: '5000', timeoutMs: '10000' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Uploaders', x: 0, y: 120 }, { id: 'upload-api', kind: 'server', label: 'Upload API', x: 300, y: 120, config: { instances: '4' } }, { id: 'processor', kind: 'worker', label: 'Image Processor', x: 900, y: 120 }], edges: [['users', 'upload-api'], ['upload-api', 'processor']] },
  },
  {
    id: 'protect-the-ledger', number: 5, title: 'Protect the Ledger', difficulty: 'hard', topics: ['Rate limiting', 'Load shedding'],
    estimatedMinutes: 25,
    learningObjectives: ['Shed excess load before it reaches a fixed-capacity dependency', 'Compare rejecting fast with queueing until timeouts', 'Size a token bucket from a downstream capacity'],
    relatedDesigns: ['rateLimiter', 'database'],
    summary: '1,500 req/s hit a ledger that can do 500. Shed the excess before it does damage.',
    statement: 'The Ledger is a given database: 10 connections at 20 ms per write, about 500 writes per second. A promotion sends 1,500 payment requests per second. You cannot serve them all; you must protect the Ledger and keep accepted payments fast.',
    scenario: 'Overload at the Ledger causes long queues and slow timeouts for everyone. Excess traffic should be rejected quickly before it reaches the Ledger. Every successful payment must be written to the Ledger.',
    functional: ['Accept payment requests from Shoppers', 'Every successful payment is written to the given Ledger', 'Excess payments are rejected before they reach the Ledger'],
    requirements: ['1,500 req/s for 10 s', 'Successful throughput ≥ 450 req/s', 'p95 of successful payments ≤ 100 ms', 'Ledger queue never exceeds 20', '≤ 1% of failures happen at the Ledger'],
    workload: { rps: 1500, durationMs: 11_000, trafficDurationMs: 10_000, seed: 606, pattern: 'Constant rate for 10 s, then 1 s with no new arrivals so in-flight requests can finish', overrides: [computeCost(10), serverlessCost(10), routingCost, { kinds: ['cache', 'distributedCache', 'cdn'], config: { hitRatio: '0' }, reason: 'Payments are unique writes; caches never hit.' }], faults: [] },
    criteria: [throughputAtLeast(450), p95Below(100),
      { id: 'ledger-queue', label: 'Ledger max queue ≤ 20', metric: { kind: 'maxQueue', nodeId: 'ledger' }, comparator: '<=', threshold: 20, unit: 'requests', mandatory: true, advice: 'Engine metric: the deepest backlog at the Ledger during the run. Admit at most about 500 req/s.' },
      { id: 'shed-early', label: '≤ 1% of failures at the Ledger', metric: { kind: 'failureShareAt', nodeId: 'ledger' }, comparator: '<=', threshold: 1, unit: '%', mandatory: true, advice: 'Failures should happen upstream (rate-limited or rejected fast), not as timeouts at the Ledger.' },
      { id: 'recorded', label: 'Every successful payment written to the Ledger', metric: { kind: 'processedBy', nodeId: 'ledger' }, comparator: '>=', threshold: 99.9, unit: '%', mandatory: true, advice: 'Successful payments must reach the Ledger; do not complete them anywhere else.' },
      fixtures, noDead],
    hints: ['The Ledger can do 10 / 20 ms = 500 writes per second.', 'A Rate Limiter rejects excess requests in under a millisecond.', 'Put a Rate Limiter in front with a rate a little below 500/s and a small burst. Bounding the API’s concurrency with a zero-length queue also works.'],
    fixtures: { ledger: { kind: 'database', label: 'Ledger', description: 'Given system: 10 connections, 20 ms per write.', locked: { concurrency: '10', queryLatencyMs: '20', queueLimit: '500', timeoutMs: '500' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Shoppers', x: 0, y: 120 }, { id: 'payments-api', kind: 'server', label: 'Payments API', x: 300, y: 120, config: { instances: '40' } }, { id: 'ledger', kind: 'database', label: 'Ledger', x: 900, y: 120 }], edges: [['users', 'payments-api'], ['payments-api', 'ledger']] },
  },
  {
    id: 'reliable-checkout', number: 6, title: 'Reliable Checkout', difficulty: 'expert', topics: ['Fault tolerance', 'Retries', 'Async processing'],
    estimatedMinutes: 30,
    learningObjectives: ['Keep a user-facing path available while a dependency is down', 'Use queue redelivery with a delay to retry through an outage', 'Size workers for the retry surge after recovery'],
    relatedDesigns: ['queue', 'worker', 'circuitBreaker'],
    summary: 'The payment provider goes down for 3 seconds mid-sale. Keep checkout up and capture every payment.',
    statement: 'Checkout calls an external Payment Provider (a given system: 50 instances, 80 ms per call). In the benchmark the provider has a scheduled outage from 3 s to 6 s: every request offered to it in that window fails immediately. Checkouts arrive at 300 per second for 10 seconds; the run continues to 16 s.',
    scenario: 'Customers must not see errors because of the outage, and the business must still capture every payment, a little late if necessary.',
    completion: 'A checkout succeeds when it is accepted: either the payment completes synchronously, or the order is durably enqueued. Every accepted checkout must have its payment processed by the Payment Provider before the 16 s benchmark ends.',
    functional: ['Accept checkouts from Shoppers, including during the provider outage', 'Every accepted checkout is eventually charged by the given Payment Provider'],
    requirements: ['300 checkouts/s for 10 s, outage 3–6 s, run ends at 16 s', 'Checkout error rate under 1%', 'Checkout p95 ≤ 150 ms', '≥ 99% of accepted checkouts have their payment captured by the end'],
    workload: { rps: 300, durationMs: 16_000, trafficDurationMs: 10_000, seed: 404, pattern: 'Constant rate for 10 s, then 6 s with no new arrivals', overrides: [computeCost(20), serverlessCost(20), routingCost], faults: [{ nodeId: 'payment-provider', startMs: 3000, endMs: 6000, description: 'Payment Provider unavailable from 3 s to 6 s' }] },
    criteria: [errorBelow(1, 'Checkout error rate < 1%'), p95Below(150, 'Checkout p95 ≤ 150 ms'), throughputAtLeast(297),
      { id: 'captured', label: '≥ 99% of accepted checkouts captured', metric: { kind: 'processedBy', nodeId: 'payment-provider' }, comparator: '>=', threshold: 99, unit: '%', mandatory: true, advice: 'Counted from traces: the checkout itself, or a completed job it enqueued, must have been processed by the Payment Provider. Retries that run out of deliveries do not count.' },
      fixtures, noDead],
    hints: ['Any synchronous call to the provider during 3–6 s fails, so the checkout itself must not depend on it.', 'Accept the order into a Message Queue; a Worker connected to the Payment Provider makes the call. Workers forward jobs to their first connection.', 'Failed jobs are redelivered after the queue’s redelivery delay, up to Max deliveries. Choose values that outlast a 3 s outage, and give the worker enough slots for the retry surge after recovery.'],
    fixtures: { 'payment-provider': { kind: 'server', label: 'Payment Provider', description: 'External API: 50 instances, 80 ms per call; scheduled outage 3–6 s.', locked: { instances: '50', processingLatencyMs: '80', queueLimit: '500', timeoutMs: '500' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Shoppers', x: 0, y: 120 }, { id: 'checkout-api', kind: 'server', label: 'Checkout API', x: 300, y: 120, config: { instances: '10' } }, { id: 'payment-provider', kind: 'server', label: 'Payment Provider', x: 900, y: 120 }], edges: [['users', 'checkout-api'], ['checkout-api', 'payment-provider']] },
  },
  {
    id: 'go-global', number: 7, title: 'Go Global', difficulty: 'easy', topics: ['Edge caching', 'CDN'],
    estimatedMinutes: 10,
    learningObjectives: ['Serve repeated content from the edge instead of the origin', 'Relate an edge hit ratio to the load left on the origin', 'See why scaling the origin is not the only answer to read-heavy traffic'],
    relatedDesigns: ['cache', 'server'],
    summary: 'Product images are overwhelming a small origin server. Serve them from the edge.',
    statement: 'The Asset Server is a given system: 6 instances at 30 ms per image, about 200 images per second. A global sale sends 600 image requests per second straight to it.',
    scenario: 'Images rarely change. Any edge or in-memory cache you add sees an 85% hit ratio for this traffic; misses still go to the Asset Server.',
    functional: ['Serve every image request from the shoppers', 'The Asset Server stays the source of truth for cache misses', 'Keep the given Asset Server; it cannot be resized'],
    requirements: ['Serve 600 req/s for 10 s', 'p95 latency ≤ 80 ms', 'Error rate under 1%', 'At most 25% of requests may reach the Asset Server'],
    workload: { rps: 600, durationMs: 11_000, trafficDurationMs: 10_000, seed: 707, pattern: 'Constant rate for 10 s, then 1 s with no new arrivals so in-flight requests can finish', overrides: [{ kinds: ['cdn', 'cache', 'distributedCache'], config: { hitRatio: '85' }, reason: 'Images are cacheable: any cache hits 85% of requests.' }, routingCost], faults: [] },
    criteria: [p95Below(80), throughputAtLeast(594), errorBelow(1),
      { id: 'origin-load', label: '≤ 25% of requests reach the Asset Server', metric: { kind: 'loadShare', nodeId: 'origin' }, comparator: '<=', threshold: 25, unit: '%', mandatory: true, advice: 'Measured from traces: requests served at the edge never reach the origin. Put a CDN (or another cache) in front of it.' },
      fixtures, noDead],
    hints: ['The Asset Server can do about 6 / 30 ms = 200 images per second; demand is 600.', 'An 85% hit ratio leaves 15% of 600 = 90 requests per second for the origin.', 'Connect Shoppers → CDN → Asset Server. A CDN serves hits at the edge in a few milliseconds.'],
    fixtures: { origin: { kind: 'server', label: 'Asset Server', description: 'Given origin: 6 instances, 30 ms per image.', locked: { instances: '6', processingLatencyMs: '30', queueLimit: '500', timeoutMs: '500' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Shoppers', x: 0, y: 120 }, { id: 'origin', kind: 'server', label: 'Asset Server', x: 600, y: 120 }], edges: [['users', 'origin']] },
  },
  {
    id: 'read-heavy-catalog', number: 8, title: 'Read-Heavy Catalog', difficulty: 'medium', topics: ['Read replicas', 'Database scaling'],
    estimatedMinutes: 20,
    learningObjectives: ['Scale reads by routing them to replicas while writes stay on the primary', 'Read a database’s read share and how it divides load', 'Recognize when a cache with a low hit ratio is not enough'],
    relatedDesigns: ['database', 'cache'],
    summary: 'Catalog browsing needs twice what the primary database can serve. Offload the reads.',
    statement: 'The Catalog DB is a given primary: 10 connections at 20 ms per query, about 500 queries per second. 80% of its queries are reads. Browsing traffic is 1,000 requests per second, each making one query.',
    scenario: 'Catalog queries are diverse, so any cache only hits 30% of the time. Read Replicas connected to the primary (primary → replica) take its read share; each replica query also takes 20 ms.',
    functional: ['Serve every catalog request through the Catalog API', 'Writes stay on the given Catalog DB primary', 'Keep the given Catalog DB'],
    requirements: ['Serve 1,000 req/s for 10 s', 'Successful throughput ≥ 990 req/s', 'p95 ≤ 80 ms', 'Error rate under 1%', 'Catalog DB primary utilization at most 70%'],
    workload: { rps: 1000, durationMs: 11_000, trafficDurationMs: 10_000, seed: 808, pattern: 'Constant rate for 10 s, then 1 s with no new arrivals so in-flight requests can finish', overrides: [computeCost(10), serverlessCost(10), routingCost, { kinds: ['readReplica'], config: { queryLatencyMs: '20' }, reason: 'Replica queries take 20 ms, like the primary’s.' }, { kinds: ['cache', 'distributedCache', 'cdn'], config: { hitRatio: '30' }, reason: 'Catalog queries are diverse: any cache hits only 30%.' }], faults: [] },
    criteria: [throughputAtLeast(990), p95Below(80), errorBelow(1),
      { id: 'primary-util', label: 'Catalog DB primary utilization ≤ 70%', metric: { kind: 'utilization', nodeId: 'catalog-db' }, comparator: '<=', threshold: 70, unit: '%', mandatory: true, advice: 'Engine metric: the share of the run the primary’s connections were busy. Reads routed to replicas do not occupy the primary.' },
      fixtures, noDead],
    hints: ['The primary needs 1,000 × 20 ms = 20 busy connections and has 10.', 'With replicas connected, the primary routes its read share (80%) to them; only 200 writes per second stay on it.', 'Connect Catalog DB → Read Replica. Make sure the replicas together have enough connections for 800 reads per second at 20 ms each.'],
    fixtures: { 'catalog-db': { kind: 'database', label: 'Catalog DB', description: 'Given primary: 10 connections, 20 ms per query, 80% reads.', locked: { concurrency: '10', queryLatencyMs: '20', readRatio: '80', queueLimit: '500', timeoutMs: '500' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Shoppers', x: 0, y: 120 }, { id: 'api', kind: 'server', label: 'Catalog API', x: 300, y: 120, config: { instances: '16' } }, { id: 'catalog-db', kind: 'database', label: 'Catalog DB', x: 600, y: 120 }], edges: [['users', 'api'], ['api', 'catalog-db']] },
  },
  {
    id: 'fan-out-notifications', number: 9, title: 'Fan-Out Notifications', difficulty: 'hard', topics: ['Event streams', 'Fan-out', 'Async processing'],
    estimatedMinutes: 25,
    learningObjectives: ['Deliver one event to several independent consumers', 'Tell a work queue (one consumer per message) from an event stream (every consumer gets it)', 'Keep the request path fast by accepting events asynchronously'],
    relatedDesigns: ['queue', 'worker'],
    summary: 'Every order must reach both the email service and analytics, without slowing checkout.',
    statement: 'Two given worker services must process every order event: the Email Service and Analytics (each 20 slots at 20 ms per job). Orders arrive at 400 per second for 8 seconds; the run continues 4 seconds so work can drain.',
    scenario: 'Today the Orders API calls the Email Service synchronously and Analytics receives nothing.',
    completion: 'An order succeeds when the Orders API accepts it: after synchronous processing, or when the event is durably appended or enqueued. Separately, every accepted order must be processed by both services before the 12 s benchmark ends.',
    functional: ['Accept every order event from the shop', 'Every accepted order is processed by the given Email Service', 'Every accepted order is processed by the given Analytics service'],
    requirements: ['400 orders/s for 8 s, then a 4 s drain', 'Accept p95 ≤ 30 ms', 'Error rate under 1%', '≥ 99% of accepted orders processed by each service'],
    workload: { rps: 400, durationMs: 12_000, trafficDurationMs: 8_000, seed: 909, pattern: 'Constant rate for 8 s, then no new arrivals for 4 s', overrides: [computeCost(5, 'The Orders API’s own work is 5 ms per request.'), serverlessCost(5), routingCost], faults: [] },
    criteria: [p95Below(30, 'Accept p95 ≤ 30 ms'), throughputAtLeast(396), errorBelow(1),
      { id: 'email', label: '≥ 99% of accepted orders processed by the Email Service', metric: { kind: 'processedBy', nodeId: 'email' }, comparator: '>=', threshold: 99, unit: '%', mandatory: true, advice: 'Counted from traces: the order itself, or a completed job it produced, must have been processed by the Email Service.' },
      { id: 'analytics', label: '≥ 99% of accepted orders processed by Analytics', metric: { kind: 'processedBy', nodeId: 'analytics' }, comparator: '>=', threshold: 99, unit: '%', mandatory: true, advice: 'A Message Queue hands each message to one worker. To reach both services, every event must be delivered to each of them.' },
      fixtures, noDead],
    hints: ['A synchronous call to one service cannot also reach the other.', 'A Message Queue dispatches each job to a single worker, so one service would miss events.', 'An Event Stream delivers every event to each connected consumer. Connect Orders API → Event Stream → both services. This is the producer/consumer separation shown in the Message Queue’s LLD.'],
    fixtures: {
      email: { kind: 'worker', label: 'Email Service', description: 'Given consumer: 20 slots, 20 ms per job.', locked: { concurrency: '20', processingRate: '50', queueLimit: '5000', timeoutMs: '10000' } },
      analytics: { kind: 'worker', label: 'Analytics', description: 'Given consumer: 20 slots, 20 ms per job.', locked: { concurrency: '20', processingRate: '50', queueLimit: '5000', timeoutMs: '10000' } },
    },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Shop', x: 0, y: 120 }, { id: 'orders-api', kind: 'server', label: 'Orders API', x: 300, y: 120, config: { instances: '8' } }, { id: 'email', kind: 'worker', label: 'Email Service', x: 900, y: 40 }, { id: 'analytics', kind: 'worker', label: 'Analytics', x: 900, y: 240 }], edges: [['users', 'orders-api'], ['orders-api', 'email']] },
  },
  {
    id: 'black-friday', number: 10, title: 'Black Friday Storefront', difficulty: 'expert', topics: ['Load balancing', 'Caching', 'Capacity planning'],
    estimatedMinutes: 35,
    learningObjectives: ['Size every tier of a request path, not just the obvious one', 'Combine horizontal scaling with caching under a compute budget', 'Check that a cache itself has enough capacity for the traffic it absorbs'],
    relatedDesigns: ['loadBalancer', 'cache', 'database'],
    summary: '2,500 requests per second, a fixed database and a tight compute budget. Every tier has to hold.',
    statement: 'The Products DB is a given system: 20 connections at 20 ms per query, about 1,000 queries per second. Black Friday brings 2,500 requests per second. Each request needs 15 ms of application work and 1 ms in any router.',
    scenario: 'Product pages are cacheable: any cache in the path hits 80%. You have a budget of 48 compute slots, and every request must run application code.',
    functional: ['Serve every storefront request through application code', 'The Products DB stays the source of truth for cache misses', 'Keep the given Products DB'],
    requirements: ['Serve 2,500 req/s for 10 s', 'Successful throughput ≥ 2,475 req/s', 'p95 ≤ 60 ms', 'Error rate under 1%', 'Products DB utilization at most 70%', 'At most 48 compute slots'],
    workload: { rps: 2500, durationMs: 11_000, trafficDurationMs: 10_000, seed: 1010, maxEvents: 1_000_000, pattern: 'Constant rate for 10 s, then 1 s with no new arrivals so in-flight requests can finish', overrides: [computeCost(15), serverlessCost(15), routingCost, { kinds: ['cache', 'distributedCache', 'cdn'], config: { hitRatio: '80' }, reason: 'Product pages are cacheable: any cache hits 80%.' }], faults: [] },
    criteria: [throughputAtLeast(2475), p95Below(60), errorBelow(1), processedByCompute(),
      { id: 'db-util', label: 'Products DB utilization ≤ 70%', metric: { kind: 'utilization', nodeId: 'products-db' }, comparator: '<=', threshold: 70, unit: '%', mandatory: true, advice: 'Engine metric: the share of the run the database’s connections were busy. Fewer requests reaching it means a lower number.' },
      { id: 'budget', label: 'Compute slots ≤ 48', metric: { kind: 'computeSlots' }, comparator: '<=', threshold: 48, unit: 'slots', mandatory: true, advice: 'You need about 2,500 × 0.015 = 37.5 busy slots; keep some headroom within 48.' },
      fixtures, noDead],
    hints: ['Check each tier: router, compute, cache and database all have a capacity.', 'A load balancer with 1 slot at 1 ms tops out at 1,000 req/s; a cache with 1 slot at 2 ms tops out at 500 lookups/s.', 'Raise the load balancer’s concurrency, spread about 44 instances across servers, and put a cache with enough concurrency between the servers and the Products DB.'],
    fixtures: { 'products-db': { kind: 'database', label: 'Products DB', description: 'Given system: 20 connections, 20 ms per query.', locked: { concurrency: '20', queryLatencyMs: '20', queueLimit: '500', timeoutMs: '500' } } },
    starter: { nodes: [{ id: 'users', kind: 'client', label: 'Shoppers', x: 0, y: 120 }, { id: 'lb', kind: 'loadBalancer', label: 'Load Balancer', x: 286, y: 120 }, { id: 'app-1', kind: 'server', label: 'Storefront 1', x: 572, y: 120, config: { instances: '8' } }, { id: 'products-db', kind: 'database', label: 'Products DB', x: 900, y: 120 }], edges: [['users', 'lb'], ['lb', 'app-1'], ['app-1', 'products-db']] },
  },
];
export const challengeById = (id: string) => challenges.find(challenge => challenge.id === id);
