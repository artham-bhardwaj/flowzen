import { deepFreeze } from '../challenges/grading';
import type { ArchitectureSnapshot } from '../challenges/attempts';
import { byKind, type Kind } from '../app/catalog';
import { stats, WEAK_THRESHOLD } from './analytics';
import { scoreText, type Basis, type Evidence } from './score';
import type { InterviewState } from './store';
import type { CompetencyId, Concept, Contradiction, Resource } from './types';

/**
 * Targeted practice: short, focused exercises for one skill at a time, with transparent rule-based grading.
 * Drill attempts are stored under their own key (`flowzen-interview-practice-v1`), separately from interview drafts and
 * records, challenges, the lab and learning progress, and they never count as interview results.
 *
 * Grading by task type:
 *   numbers  – arithmetic: within ±25% of the worked answer is full credit, within 2× is half;
 *   choice   – structural: each option has a documented verdict (best / acceptable / wrong) and reason;
 *   text     – keyword: expected considerations recognised, as in interviews (vocabulary, not understanding);
 *   bottleneck – measured: the architecture is simulated and the answer is compared with the measured busiest component.
 */
export type DrillSkill = 'estimation' | 'api' | 'data-model' | 'component-selection' | 'bottlenecks' | 'failure' | 'tradeoffs';
export const SKILL_LABELS: Record<DrillSkill, string> = {
  estimation: 'Capacity estimation', api: 'API design', 'data-model': 'Data modeling', 'component-selection': 'Component selection',
  bottlenecks: 'Bottleneck identification', failure: 'Failure analysis', tradeoffs: 'Architecture trade-offs',
};
/** The interview competency each skill trains (used for recommendations). */
export const SKILL_COMPETENCY: Record<DrillSkill, CompetencyId> = {
  estimation: 'estimation', api: 'api', 'data-model': 'data-model', 'component-selection': 'architecture', bottlenecks: 'scalability', failure: 'reliability', tradeoffs: 'tradeoffs',
};
export const SKILLS = Object.keys(SKILL_LABELS) as DrillSkill[];

export type NumberQuantity = { id: string; label: string; unit: string; answer: number; working: string };
export type ChoiceOption = { id: string; label: string; verdict: 'best' | 'acceptable' | 'wrong'; why: string };
export type BottleneckGraph = { rps: number; nodes: Array<{ id: string; kind: Kind; label: string; config: Record<string, string> }>; edges: Array<[string, string]> };
export type DrillTask =
  | { id: string; type: 'numbers'; prompt: string; quantities: NumberQuantity[] }
  | { id: string; type: 'choice'; prompt: string; options: ChoiceOption[] }
  | { id: string; type: 'text'; prompt: string; concepts: Concept[]; contradictions?: Contradiction[] }
  | { id: string; type: 'bottleneck'; prompt: string; graph: BottleneckGraph };
export type Drill = { id: string; version: number; skill: DrillSkill; title: string; minutes: number; brief: string; tasks: DrillTask[]; explanation: string[]; resources: Resource[] };

const c = (id: string, label: string, any: string[]): Concept => ({ id, label, any });
const why = (id: string, prompt: string, concepts: Concept[], contradictions?: Contradiction[]): DrillTask => ({ id, type: 'text', prompt, concepts, ...(contradictions ? { contradictions } : {}) });

export const DRILLS: Drill[] = [
  // ── Capacity estimation ──
  { id: 'est-photos', version: 1, skill: 'estimation', title: 'Photo uploads', minutes: 6,
    brief: 'A photo app has 20 million daily active users. Each uploads 2 photos a day, averaging 3 MB, and each photo is viewed 50 times.',
    tasks: [{ id: 'n', type: 'numbers', prompt: 'Estimate the average rates and daily storage growth.', quantities: [
      { id: 'uploads', label: 'Uploads per second (average)', unit: 'req/s', answer: 463, working: '20 M × 2 ÷ 86,400 s ≈ 463 uploads/s.' },
      { id: 'views', label: 'Photo views per second (average)', unit: 'req/s', answer: 23_148, working: '20 M × 2 × 50 ÷ 86,400 ≈ 23,000 views/s: reads dominate 50:1.' },
      { id: 'storage', label: 'New storage per day', unit: 'TB', answer: 120, working: '20 M × 2 × 3 MB = 120 TB per day, before replication.' },
    ] }, why('w', 'Which of these numbers drives the design most, and what does it imply?', [c('reads', 'reads dominate', ['view', 'read', '50']), c('storage', 'storage growth', ['storage', 'tb', 'object storage', 'petabyte']), c('cdn', 'serving reads from a CDN or cache', ['cdn', 'cache', 'edge'])])],
    explanation: ['Convert per-day volumes to per-second by dividing by 86,400.', 'Views are 50× uploads, so the read path (CDN, cache) matters more than upload capacity.', '120 TB/day means about 44 PB a year: object storage, not a database.'],
    resources: [{ type: 'lesson', id: 'capacity-estimation' }] },
  { id: 'est-chat', version: 1, skill: 'estimation', title: 'Chat message volume', minutes: 6,
    brief: 'A chat service has 50 million daily active users sending 40 messages a day each, averaging 200 bytes. The busiest hour carries 3× the average rate.',
    tasks: [{ id: 'n', type: 'numbers', prompt: 'Estimate the message rates and storage.', quantities: [
      { id: 'avg', label: 'Messages per second (average)', unit: 'msg/s', answer: 23_148, working: '50 M × 40 ÷ 86,400 ≈ 23,000 messages/s.' },
      { id: 'peak', label: 'Messages per second (peak)', unit: 'msg/s', answer: 69_444, working: '3 × the average ≈ 69,000 messages/s.' },
      { id: 'storage', label: 'Message storage per day', unit: 'GB', answer: 400, working: '50 M × 40 × 200 B = 400 GB per day.' },
    ] }, why('w', 'Which rate do you size the write path for, and why?', [c('peak', 'the peak, not the average', ['peak', '69', '3x', '3×']), c('headroom', 'headroom above the peak', ['headroom', 'margin', 'buffer', 'spare'])])],
    explanation: ['Size synchronous paths for the peak plus headroom; averages hide the busiest hour.', 'Storage is modest per day but grows forever unless retention is limited.'],
    resources: [{ type: 'lesson', id: 'capacity-estimation' }, { type: 'experiment', id: 'latency-under-load' }] },
  // ── API design ──
  { id: 'api-charge', version: 1, skill: 'api', title: 'Charging a card safely', minutes: 7,
    brief: 'Design the endpoint that charges a customer’s card for an order. Mobile clients retry when a request times out.',
    tasks: [why('t', 'Describe the method, path, request, responses and how a retried request is handled.', [
      c('method', 'a POST (or PUT) that creates a charge', ['post', 'put']), c('idempotency', 'an idempotency key', ['idempotency key', 'idempotent', 'request id', 'dedup']),
      c('duplicate', 'what a retry returns (the original result, no second charge)', ['same result', 'original response', 'charged twice', 'duplicate', 'not charge again']),
      c('errors', 'distinct errors (declined, invalid, conflict)', ['402', '409', '422', '400', 'declined', 'conflict'])])],
    explanation: ['POST /v1/orders/{id}/charges with an Idempotency-Key header; the server stores the key with the outcome and returns the stored outcome on a retry.', 'Distinguish a declined card (402) from invalid input (400/422) and a key reused with a different body (409).'],
    resources: [{ type: 'component', kind: 'gateway' }, { type: 'lesson', id: 'sync-async' }] },
  { id: 'api-feed', version: 1, skill: 'api', title: 'Paginating a live feed', minutes: 6,
    brief: 'An endpoint returns a user’s feed, newest first. New items arrive constantly while the user scrolls.',
    tasks: [why('t', 'How does the client ask for the next page, and why?', [
      c('cursor', 'cursor (keyset) pagination', ['cursor', 'next token', 'continuation', 'keyset', 'after id', 'before id']),
      c('offset', 'why offsets break when items are inserted', ['offset', 'skip', 'duplicate', 'missing', 'shift']),
      c('limit', 'a bounded page size', ['limit', 'page size', 'max']), c('order', 'a stable sort key with a tie-breaker', ['timestamp', 'created at', 'tie', 'id', 'sort key'])])],
    explanation: ['Offsets shift when new items are inserted, so users see duplicates or miss items.', 'Return an opaque cursor encoding the last (timestamp, id) seen; the next page reads items strictly after it.'],
    resources: [{ type: 'component', kind: 'nosql' }] },
  // ── Data modeling ──
  { id: 'data-likes', version: 1, skill: 'data-model', title: 'Likes on posts', minutes: 7,
    brief: 'Users can like and unlike posts. Each post shows its like count and whether the viewer liked it. Some posts get millions of likes.',
    tasks: [why('t', 'Describe the tables or items, keys and indexes, and how counts are kept.', [
      c('pk', 'a (user, post) key so a user likes a post once', ['(user', 'composite', 'primary key', 'unique', 'user_id and post_id', 'user id and post id']),
      c('count', 'a stored or aggregated count', ['counter', 'count column', 'denormaliz', 'aggregate', 'like_count', 'like count']),
      c('index', 'lookup by post', ['index on post', 'by post', 'post_id', 'post id', 'partition by post']),
      c('hot', 'contention on hot posts', ['hot', 'contention', 'sharded counter', 'batch', 'approximate'])])],
    explanation: ['Like(user_id, post_id) with a composite primary key enforces one like per user and answers “did I like it?” in one lookup.', 'Counting rows per view is too slow; keep a counter, and for hot posts shard it or batch increments.'],
    resources: [{ type: 'component', kind: 'database' }, { type: 'lld', kind: 'database' }] },
  { id: 'data-orders', version: 1, skill: 'data-model', title: 'Orders and line items', minutes: 7,
    brief: 'Model orders with several line items. Support “orders for a customer” and daily sales reports. Product prices change over time.',
    tasks: [why('t', 'Describe the entities, keys, relationships and indexes.', [
      c('entities', 'order and line-item entities', ['line item', 'order_item', 'order item', 'lines']), c('fk', 'the one-to-many relationship', ['foreign key', 'order_id', 'order id', 'one-to-many', 'one to many']),
      c('customer', 'an index by customer', ['customer_id', 'customer id', 'index on customer', 'by customer']), c('date', 'access by date for reports', ['created_at', 'created at', 'date', 'partition by day', 'by day']),
      c('price', 'the price copied at purchase time', ['price at', 'snapshot', 'copy the price', 'unit price', 'historical price'])])],
    explanation: ['Order(id, customer_id, created_at, status) and OrderLine(order_id, product_id, quantity, unit_price).', 'Copy the unit price into the line: prices change, invoices must not.', 'Index orders by (customer_id, created_at); reports scan by date or read a pre-aggregated table.'],
    resources: [{ type: 'component', kind: 'database' }] },
  // ── Component selection ──
  { id: 'pick-sessions', version: 1, skill: 'component-selection', title: 'Where do sessions live?', minutes: 5,
    brief: 'A web app has 10 million users with sessions of about 1 KB. Every request reads the session. Losing a session only means logging in again.',
    tasks: [{ id: 'c', type: 'choice', prompt: 'Which store fits best?', options: [
      { id: 'cache', label: 'A distributed in-memory cache with TTLs', verdict: 'best', why: 'Sub-millisecond key lookups on every request; losing entries is acceptable, and TTLs expire idle sessions.' },
      { id: 'sql', label: 'The main SQL database', verdict: 'acceptable', why: 'Works and is durable, but adds a database read to every request and durability is not needed here.' },
      { id: 'object', label: 'Object storage', verdict: 'wrong', why: 'Tens of milliseconds per read for tiny objects read on every request.' },
      { id: 'local', label: 'Memory on each app server', verdict: 'wrong', why: 'Ties users to one server (sticky sessions) and loses sessions on every deploy or failure.' },
    ] }, why('j', 'Justify the choice in terms of the workload.', [c('latency', 'per-request latency', ['latency', 'fast', 'every request', 'memory']), c('loss', 'that loss is tolerable', ['lost', 'log in again', 'rebuild', 'ttl', 'not durable'])])],
    explanation: ['Read on every request + small + loss-tolerant = an in-memory key-value cache with expiry.'],
    resources: [{ type: 'component', kind: 'distributedCache' }, { type: 'lesson', id: 'stateful-stateless' }] },
  { id: 'pick-transcode', version: 1, skill: 'component-selection', title: 'Transcoding uploads', minutes: 5,
    brief: 'Users upload videos that take minutes to transcode. The upload request must return within a second, and no upload may be silently lost.',
    tasks: [{ id: 'c', type: 'choice', prompt: 'How should transcoding be triggered?', options: [
      { id: 'queue', label: 'Enqueue a job; a pool of workers transcodes', verdict: 'best', why: 'The request returns at once, workers scale independently, and unacknowledged jobs are redelivered.' },
      { id: 'poll', label: 'A scheduled job polls the database for new uploads', verdict: 'acceptable', why: 'Works, but adds latency between polls and load from repeated scans.' },
      { id: 'sync', label: 'Transcode inside the upload request', verdict: 'wrong', why: 'Holds the request for minutes and loses the work if the server restarts.' },
      { id: 'cdn', label: 'Let the CDN transcode on first view', verdict: 'wrong', why: 'Moves minutes of work onto the first viewer’s request.' },
    ] }, why('j', 'Justify the choice, including what happens when a worker crashes.', [c('async', 'decoupling the request from the work', ['async', 'decouple', 'return immediately', 'background']), c('retry', 'redelivery when a worker fails', ['redeliver', 'retry', 'ack', 'at least once', 'visibility timeout'])])],
    explanation: ['Long work + fast response + no loss = a durable queue with acknowledged, retried jobs (and a dead-letter queue for poison jobs).'],
    resources: [{ type: 'component', kind: 'queue' }, { type: 'lesson', id: 'sync-async' }, { type: 'experiment', id: 'worker-count' }] },
  // ── Bottlenecks (measured) ──
  { id: 'bottleneck-store', version: 1, skill: 'bottlenecks', title: 'Where does it saturate? (1)', minutes: 5,
    brief: '300 requests per second reach this design. Read each component’s settings and decide which one limits it.',
    tasks: [{ id: 'b', type: 'bottleneck', prompt: 'Which component saturates first?', graph: { rps: 300, nodes: [
      { id: 'u', kind: 'client', label: 'Users', config: {} },
      { id: 'lb', kind: 'loadBalancer', label: 'Load balancer', config: { processingLatencyMs: '1', concurrency: '200' } },
      { id: 'app', kind: 'server', label: 'App servers', config: { instances: '8', processingLatencyMs: '20' } },
      { id: 'db', kind: 'database', label: 'Database', config: { concurrency: '4', queryLatencyMs: '18' } },
    ], edges: [['u', 'lb'], ['lb', 'app'], ['app', 'db']] } }, why('w', 'Show the capacity arithmetic behind your answer.', [c('capacity', 'capacity = concurrency ÷ service time', ['÷', '/', 'per second', 'capacity', 'concurrency']), c('compare', 'comparing it with the offered load', ['300', 'offered', 'arrival', 'exceeds', 'more than'])])],
    explanation: ['App servers: 8 slots ÷ 20 ms = 400 req/s, so 75% busy at 300 req/s.', 'Database: 4 connections ÷ 18 ms ≈ 222 queries/s, below the 300 offered: it saturates and requests queue and fail.'],
    resources: [{ type: 'lesson', id: 'bottlenecks' }, { type: 'experiment', id: 'find-the-bottleneck' }] },
  { id: 'bottleneck-cache', version: 1, skill: 'bottlenecks', title: 'Where does it saturate? (2)', minutes: 5,
    brief: '500 requests per second reach this design. The cache answers 80% of reads. Decide which component limits it.',
    tasks: [{ id: 'b', type: 'bottleneck', prompt: 'Which component saturates first?', graph: { rps: 500, nodes: [
      { id: 'u', kind: 'client', label: 'Users', config: {} },
      { id: 'app', kind: 'server', label: 'App servers', config: { instances: '8', processingLatencyMs: '20' } },
      { id: 'cache', kind: 'cache', label: 'Cache', config: { hitRatio: '80', lookupLatencyMs: '2', concurrency: '50' } },
      { id: 'db', kind: 'database', label: 'Database', config: { concurrency: '10', queryLatencyMs: '18' } },
    ], edges: [['u', 'app'], ['app', 'cache'], ['cache', 'db']] } }, why('w', 'Show the capacity arithmetic behind your answer.', [c('capacity', 'capacity of the limiting component', ['400', 'capacity', '÷', '/']), c('misses', 'the database sees only misses', ['miss', '20%', '100 req', 'only'])])],
    explanation: ['App servers: 8 ÷ 20 ms = 400 req/s, below the 500 offered: they saturate first.', 'The database only sees misses: at most 20% of what gets through, about 80 queries/s against a capacity of about 555.'],
    resources: [{ type: 'lesson', id: 'bottlenecks' }, { type: 'experiment', id: 'cache-vs-database' }] },
  // ── Failure analysis ──
  { id: 'fail-cache-loss', version: 1, skill: 'failure', title: 'The cache cluster restarts', minutes: 6,
    brief: 'A cache with a 95% hit ratio fronts a database sized for 2,000 queries/s. Traffic is 20,000 req/s. The whole cache cluster restarts empty.',
    tasks: [why('t', 'What happens, and how should the system protect itself?', [
      c('storm', 'the database receives far more than it can serve', ['20,000', '20000', '10x', '10×', 'overload', 'all traffic', 'every request']),
      c('protect', 'shedding or limiting load to the database', ['circuit breaker', 'rate limit', 'shed', 'throttl', 'concurrency limit']),
      c('warm', 'warming the cache gradually', ['warm', 'gradual', 'prefill', 'pre-populate', 'ramp']), c('degrade', 'a degraded response', ['degrade', 'stale', 'fallback', 'default', 'error page'])])],
    explanation: ['Misses jump from 1,000/s (5%) to 20,000/s: ten times what the database can serve; it saturates and everything times out.', 'Cap concurrent database reads, shed or degrade the rest, and warm the cache before sending full traffic.'],
    resources: [{ type: 'lesson', id: 'why-caching' }, { type: 'experiment', id: 'circuit-breaker' }] },
  { id: 'fail-retry-storm', version: 1, skill: 'failure', title: 'A retry storm', minutes: 6,
    brief: 'A dependency slows down. Every client retries a failed call three times immediately.',
    tasks: [why('t', 'What happens to the dependency’s load, and what should the clients do instead?', [
      c('amplify', 'load amplification (up to 4× calls)', ['amplif', '4x', '4×', 'four times', 'multipl']), c('backoff', 'exponential backoff with jitter', ['backoff', 'back off', 'jitter', 'exponential']),
      c('budget', 'a retry budget or circuit breaker', ['retry budget', 'circuit breaker', 'limit retries', 'stop retrying']), c('timeout', 'timeouts below the caller’s budget', ['timeout'])],
      [{ id: 'more-retries', label: 'recommends more immediate retries', any: ['retry more', 'more retries', 'retry immediately'], explanation: 'Immediate retries add load exactly when the dependency is struggling.' }])],
    explanation: ['Each failed call becomes up to four calls, so a slow dependency receives several times its normal load and cannot recover.', 'Use timeouts, exponential backoff with jitter, a retry budget, and a circuit breaker that stops calls while it recovers.'],
    resources: [{ type: 'component', kind: 'circuitBreaker' }, { type: 'lld', kind: 'circuitBreaker' }] },
  // ── Trade-offs ──
  { id: 'to-sql-kv', version: 1, skill: 'tradeoffs', title: 'Relational or key-value?', minutes: 6,
    brief: 'A service stores link metadata: 38 writes/s, 3,800 point lookups/s by code. Next year, product wants ad-hoc reports by owner and campaign.',
    tasks: [why('t', 'Which store would you choose, and what are you trading?', [
      c('access', 'the access pattern (point lookups by key)', ['point lookup', 'by key', 'by code', 'key-value', 'access pattern']), c('flex', 'query flexibility for reports', ['ad-hoc', 'ad hoc', 'report', 'query', 'join', 'secondary index']),
      c('scale', 'scaling and partitioning', ['partition', 'shard', 'scale', 'replica']), c('ops', 'operational or consistency costs', ['operational', 'consisten', 'transaction', 'schema', 'cost'])],
      [{ id: 'always-faster', label: 'claims NoSQL is always faster', any: ['nosql is always faster', 'sql is always slow'], explanation: 'Speed depends on the access pattern and the indexes, not the category of database.' }])],
    explanation: ['Both work at this size. Key-value fits the hot path and partitions easily; relational keeps reports simple.', 'A common answer: relational now (38 writes/s is small) with a cache for lookups, or key-value plus a separate analytics store fed asynchronously.'],
    resources: [{ type: 'component', kind: 'nosql' }, { type: 'component', kind: 'database' }] },
  { id: 'to-sync-async', version: 1, skill: 'tradeoffs', title: 'Confirmation emails', minutes: 6,
    brief: 'After checkout, the customer gets a confirmation email. Should the checkout request send it, or should it go through a queue?',
    tasks: [why('t', 'Choose and explain the trade-offs.', [
      c('latency', 'checkout latency', ['latency', 'slower', 'wait', 'response time']), c('isolation', 'isolating checkout from email failures', ['email provider', 'down', 'failure', 'isolat', 'decouple']),
      c('retry', 'retries and delivery guarantees', ['retry', 'at least once', 'redeliver', 'dead-letter']), c('dupes', 'duplicate emails', ['duplicate', 'idempoten', 'twice', 'dedup'])])],
    explanation: ['A queue keeps checkout fast and working when the email provider is down, and retries delivery.', 'The cost: emails arrive a little later, and retries can send duplicates unless sending is idempotent.'],
    resources: [{ type: 'lesson', id: 'sync-async' }, { type: 'experiment', id: 'sync-vs-async' }] },
];
export const drillById = (id: string) => DRILLS.find(drill => drill.id === id);

// ── Grading ────────────────────────────────────────────────────────────────────
export type DrillAnswers = Record<string, string>;
export type TaskResult = { taskId: string; score: number; basis: Basis; evidence: Evidence[]; missed: string[] };
export type DrillResult = { tasks: TaskResult[]; percent: number };
/** The measured answer for a bottleneck task: the busiest component, from a simulation of the task's graph. */
export type BottleneckMeasurement = { busiestId: string; utilization: Record<string, number> };
export const answerKey = (taskId: string, part?: string) => part ? `${taskId}.${part}` : taskId;

export function gradeDrill(drill: Drill, answers: DrillAnswers, measured: Record<string, BottleneckMeasurement> = {}): DrillResult {
  const tasks = drill.tasks.map((task): TaskResult => {
    if (task.type === 'numbers') {
      const rows = task.quantities.map(quantity => {
        const value = Number(String(answers[answerKey(task.id, quantity.id)] ?? '').replace(/[,\s]/g, ''));
        const ratio = Number.isFinite(value) && value > 0 ? value / quantity.answer : null;
        const points = ratio === null ? 0 : ratio >= 0.75 && ratio <= 1.25 ? 1 : ratio >= 0.5 && ratio <= 2 ? 0.5 : 0;
        return { quantity, value: ratio === null ? null : value, points };
      });
      const share = rows.reduce((sum, row) => sum + row.points, 0) / rows.length;
      return { taskId: task.id, basis: 'arithmetic', score: Math.round(share * 4),
        evidence: rows.map(row => ({ basis: 'arithmetic' as const, positive: row.points === 1, text: `${row.quantity.label}: ${row.value === null ? 'not given' : `${row.value.toLocaleString()} ${row.quantity.unit}`} (worked answer ${row.quantity.answer.toLocaleString()}; ${row.points === 1 ? 'within ±25%' : row.points ? 'within 2×' : 'outside 2×'}).` })),
        missed: rows.filter(row => row.points < 1).map(row => row.quantity.label) };
    }
    if (task.type === 'choice') {
      const option = task.options.find(entry => entry.id === answers[task.id]);
      const score = !option ? 0 : option.verdict === 'best' ? 4 : option.verdict === 'acceptable' ? 2 : 0;
      return { taskId: task.id, basis: 'structural', score, evidence: option ? [{ basis: 'structural', positive: option.verdict !== 'wrong', text: `${option.label}: ${option.verdict}. ${option.why}` }] : [{ basis: 'structural', positive: false, text: 'No option chosen.' }],
        missed: option?.verdict === 'best' ? [] : [`Best fit: ${task.options.find(entry => entry.verdict === 'best')!.label}`] };
    }
    if (task.type === 'bottleneck') {
      const measurement = measured[task.id]; const choice = answers[task.id];
      const label = (id: string) => task.graph.nodes.find(node => node.id === id)?.label ?? id;
      if (!measurement) return { taskId: task.id, basis: 'measured', score: 0, evidence: [{ basis: 'measured', positive: false, text: 'The design was not measured, so the answer could not be checked.' }], missed: [] };
      const right = choice === measurement.busiestId;
      return { taskId: task.id, basis: 'measured', score: right ? 4 : 0,
        evidence: [{ basis: 'measured', positive: right, text: `Measured: ${label(measurement.busiestId)} was the busiest (${Math.round((measurement.utilization[measurement.busiestId] ?? 0) * 100)}%). You chose ${choice ? label(choice) : 'nothing'}.` },
          ...Object.entries(measurement.utilization).filter(([id]) => id !== 'u').map(([id, value]) => ({ basis: 'measured' as const, positive: true, text: `${label(id)}: ${Math.round(value * 100)}% busy.` }))],
        missed: right ? [] : [`The measured bottleneck: ${label(measurement.busiestId)}`] };
    }
    const result = scoreText(answers[task.id] ?? '', task.concepts, task.contradictions);
    return { taskId: task.id, basis: 'keyword', score: result.score, evidence: result.evidence, missed: result.missed };
  });
  return { tasks, percent: Math.round(tasks.reduce((sum, task) => sum + task.score, 0) / (tasks.length * 4) * 100) };
}
/** The task's graph as an architecture snapshot, for the simulator. */
export function bottleneckSnapshot(graph: BottleneckGraph): ArchitectureSnapshot {
  return { schema: 'flowzen.architecture', version: 1, nodes: graph.nodes.map((node, i) => ({ id: node.id, kind: node.kind, label: node.label, config: { ...byKind[node.kind].defaults, ...node.config }, position: { x: i * 220, y: 0 } })), edges: graph.edges.map(([source, target]) => ({ source, target })) };
}

// ── Storage (its own key) ──────────────────────────────────────────────────────
export const PRACTICE_STORAGE_KEY = 'flowzen-interview-practice-v1';
export const MAX_ATTEMPTS = 200;
export type DrillAttempt = { schema: 'flowzen.drill-attempt'; version: 1; id: string; drillId: string; drillVersion: number; skill: DrillSkill; at: number; answers: DrillAnswers; measured: Record<string, BottleneckMeasurement>; result: DrillResult };
export type PracticeState = { version: 1; attempts: DrillAttempt[] };
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = () => typeof localStorage === 'undefined' ? undefined : localStorage;
const isAttempt = (value: unknown): value is DrillAttempt => typeof value === 'object' && value !== null && (value as DrillAttempt).schema === 'flowzen.drill-attempt' && (value as DrillAttempt).version === 1 && typeof (value as DrillAttempt).drillId === 'string' && typeof (value as DrillAttempt).result?.percent === 'number';
export function loadPractice(storage: StorageLike | undefined = defaultStorage()): { state: PracticeState; dropped: number } {
  try {
    const raw = JSON.parse(storage?.getItem(PRACTICE_STORAGE_KEY) ?? 'null') as { version?: number; attempts?: unknown[] } | null;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.attempts)) return { state: { version: 1, attempts: [] }, dropped: raw ? 1 : 0 };
    const attempts = raw.attempts.filter(isAttempt).map(entry => deepFreeze(entry));
    return { state: { version: 1, attempts }, dropped: raw.attempts.length - attempts.length };
  } catch { return { state: { version: 1, attempts: [] }, dropped: 1 }; }
}
export function savePractice(state: PracticeState, storage: StorageLike | undefined = defaultStorage()): boolean {
  try { storage?.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function recordAttempt(state: PracticeState, drill: Drill, answers: DrillAnswers, measured: Record<string, BottleneckMeasurement>, params: { id: string; at: number }): { state: PracticeState; attempt: DrillAttempt } {
  const attempt = deepFreeze({ schema: 'flowzen.drill-attempt' as const, version: 1 as const, id: params.id, drillId: drill.id, drillVersion: drill.version, skill: drill.skill, at: params.at, answers: { ...answers }, measured: structuredClone(measured), result: gradeDrill(drill, answers, measured) });
  return { state: { version: 1, attempts: [...state.attempts, attempt].slice(-MAX_ATTEMPTS) }, attempt };
}

// ── Recommendations ────────────────────────────────────────────────────────────
export type DrillRecommendation = { skill: DrillSkill; drill: Drill; reason: string };
/**
 * Recommends drills from evidence only: competencies averaging below 2.5/4 in completed interviews, and skills whose
 * latest drill scored under 70%. With no interviews and no drills, there is nothing to base a recommendation on.
 */
export function recommendDrills(interviews: InterviewState, practice: PracticeState): DrillRecommendation[] {
  const summary = stats(interviews);
  const out: DrillRecommendation[] = [];
  const attemptsFor = (skill: DrillSkill) => practice.attempts.filter(attempt => attempt.skill === skill);
  const nextDrill = (skill: DrillSkill) => { const done = new Set(attemptsFor(skill).filter(attempt => attempt.result.percent >= 70).map(attempt => attempt.drillId)); return DRILLS.find(drill => drill.skill === skill && !done.has(drill.id)) ?? DRILLS.find(drill => drill.skill === skill)!; };
  for (const skill of SKILLS) {
    const competency = summary.competencies.find(entry => entry.id === SKILL_COMPETENCY[skill]);
    const latest = attemptsFor(skill).at(-1);
    if (competency?.average !== null && competency?.average !== undefined && competency.average < WEAK_THRESHOLD) out.push({ skill, drill: nextDrill(skill), reason: `${competency.label} averages ${competency.average.toFixed(1)}/4 across ${competency.sessions} completed interview${competency.sessions === 1 ? '' : 's'}.` });
    else if (latest && latest.result.percent < 70) out.push({ skill, drill: nextDrill(skill), reason: `Your latest ${SKILL_LABELS[skill].toLowerCase()} drill scored ${latest.result.percent}%.` });
  }
  return out;
}
