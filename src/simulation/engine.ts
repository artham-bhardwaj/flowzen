export type ComponentKind = 'client' | 'loadBalancer' | 'gateway' | 'server' | 'cache' | 'database' | 'queue' | 'worker'
  | 'dns' | 'cdn' | 'reverseProxy' | 'waf' | 'serverless' | 'containerService' | 'nosql' | 'readReplica' | 'objectStorage' | 'searchEngine'
  | 'distributedCache' | 'eventStream' | 'deadLetterQueue' | 'rateLimiter' | 'circuitBreaker' | 'metricsCollector' | 'logAggregator';
export type SimulationNode = { id: string; kind: ComponentKind; config?: Record<string, string | number> };
export type SimulationEdge = { source: string; target: string };
/** A scheduled outage: the component rejects every request it is offered during [startMs, endMs). */
export type Fault = { nodeId: string; startMs: number; endMs: number };
export type SimulationInput = {
  nodes: SimulationNode[]; edges: SimulationEdge[]; durationMs: number; offeredRps?: number; seed?: number; maxEvents?: number;
  /** Arrivals stop here; the run continues to `durationMs` so in-flight work can drain. Defaults to `durationMs`. */
  trafficDurationMs?: number;
  faults?: Fault[];
};
/** Why a request failed: queue/timeout pressure, a missing route, or the run ending first. */
export type FailureKind = 'timeout' | 'rejected' | 'unrouted' | 'unfinished' | 'blocked' | 'rate-limited' | 'circuit-open' | 'throttled' | 'unavailable';
export type RequestRecord = { id: number; arrivalTime: number; origin?: string; currentComponent?: string; processing: Array<{ component: string; start: number; end: number; wait: number; note?: string }>; cache?: 'hit' | 'miss'; status: 'pending' | 'completed' | 'failed'; error?: string; failedAt?: string; failureKind?: FailureKind; completedAt?: number; latency?: number; internal?: boolean; parentId?: number; destination?: string; attempts?: number; redeliveredAt?: number[]; deadLetteredTo?: string };
export type ComponentMetric = { id: string; kind: ComponentKind; completed: number; rejected: number; busyMs: number; capacity: number; queueLimit: number; utilization: number; maxQueueDepth: number; averageWaitMs: number; queueDepth: number; counters?: Record<string, number> };
export type SimulationResult = { durationMs: number; offeredRequests: number; completedRequests: number; failedRequests: number; successfulThroughput: number; errorRate: number; latency: { p50: number | null; p95: number | null; p99: number | null }; cache: { hits: number; misses: number; hitRatio: number | null }; components: ComponentMetric[]; requests: RequestRecord[]; jobs: RequestRecord[]; failuresByKind: Partial<Record<FailureKind, number>>; events: string[]; stoppedEarly: boolean };

/** Small wall-clock adapter for UI playback; it never changes simulated event timing. */
export class SimulationClock {
  elapsedMs = 0; running = false;
  constructor(readonly durationMs: number, readonly speed = 1) {}
  run() { this.running = this.elapsedMs < this.durationMs; }
  pause() { this.running = false; }
  reset() { this.elapsedMs = 0; this.running = false; }
  tick(wallMs: number) { if (this.running) { this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + wallMs * this.speed); if (this.elapsedMs === this.durationMs) this.running = false; } return this.elapsedMs; }
}

type Event = { at: number; seq: number; type: 'arrival' | 'complete' | 'worker' | 'scale' | 'redeliver'; nodeId: string; requestId?: number; duration?: number };
/** Binary min-heap ordered by (at, seq): the same total order as sorting the pending event list on every insert. */
class EventQueue {
  private heap: Event[] = [];
  get length() { return this.heap.length; }
  private before(a: Event, b: Event) { return a.at < b.at || (a.at === b.at && a.seq < b.seq); }
  push(event: Event) {
    const heap = this.heap; let index = heap.push(event) - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (!this.before(heap[index], heap[parent])) break; [heap[index], heap[parent]] = [heap[parent], heap[index]]; index = parent; }
  }
  pop(): Event | undefined {
    const heap = this.heap; const top = heap[0]; const last = heap.pop(); if (!heap.length || last === undefined) return top;
    heap[0] = last; let index = 0;
    for (;;) { const left = index * 2 + 1; const right = left + 1; let smallest = index;
      if (left < heap.length && this.before(heap[left], heap[smallest])) smallest = left;
      if (right < heap.length && this.before(heap[right], heap[smallest])) smallest = right;
      if (smallest === index) return top; [heap[index], heap[smallest]] = [heap[smallest], heap[index]]; index = smallest; }
  }
}
type Resource = {
  active: number; queue: number[]; completed: number; rejected: number; busyMs: number; waits: number[]; maxQueueDepth: number;
  counters: Record<string, number>;
  /** Kind-specific state: warm serverless instances, container tasks, token bucket, circuit window, round-robin cursor. */
  warm: number; tasks: number; scalePending: boolean; capacityMs: number; capacityChangedAt: number; peakCapacity: number;
  tokens: number; refilledAt: number; openUntil: number; window: Array<{ at: number; ok: boolean }>; cursor: number;
};

/**
 * Engine defaults per component kind. Every configurable number falls back to these, and the UI
 * catalog reads them so the two cannot drift. Keys not listed fall back to GENERIC_DEFAULTS.
 */
export const ENGINE_DEFAULTS: Record<ComponentKind, Record<string, number>> = {
  client: {},
  loadBalancer: { processingLatencyMs: 1 },
  gateway: { processingLatencyMs: 4 },
  server: { instances: 3, processingLatencyMs: 25 },
  cache: { lookupLatencyMs: 2, hitRatio: 80 },
  database: { queryLatencyMs: 18, concurrency: 20, readRatio: 80 },
  queue: { processingLatencyMs: 1, maxDeliveries: 1, redeliveryDelayMs: 100 },
  worker: { concurrency: 10, processingRate: 1000, processingLatencyMs: 30 },
  dns: { lookupLatencyMs: 20, cachedPct: 95, concurrency: 200 },
  cdn: { edgeLatencyMs: 8, hitRatio: 85, concurrency: 1000 },
  reverseProxy: { processingLatencyMs: 1, concurrency: 100 },
  waf: { inspectionLatencyMs: 2, blockRatePct: 1, concurrency: 100 },
  serverless: { executionMs: 50, coldStartMs: 300, concurrency: 100, queueLimit: 0 },
  containerService: { processingLatencyMs: 25, slotsPerTask: 4, minTasks: 2, maxTasks: 10, scaleOutDelayMs: 1000 },
  nosql: { readLatencyMs: 3, writeLatencyMs: 8, writeRatio: 20, concurrency: 50 },
  readReplica: { queryLatencyMs: 15, concurrency: 20 },
  objectStorage: { firstByteLatencyMs: 40, objectSizeKb: 256, throughputMBps: 50, concurrency: 500 },
  searchEngine: { queryLatencyMs: 20, shards: 5, perShardMs: 2, concurrency: 16 },
  distributedCache: { lookupLatencyMs: 1, hitRatio: 85, nodes: 3, connectionsPerNode: 4 },
  eventStream: { appendLatencyMs: 3, partitions: 6, maxDeliveries: 1, redeliveryDelayMs: 100 },
  deadLetterQueue: {},
  rateLimiter: { checkLatencyMs: 0.5, ratePerSecond: 500, burst: 50, concurrency: 10000 },
  circuitBreaker: { processingLatencyMs: 0, failureThresholdPct: 50, minimumRequests: 20, windowMs: 1000, openMs: 2000, concurrency: 10000 },
  metricsCollector: {},
  logAggregator: {},
};
export const GENERIC_DEFAULTS: Record<string, number> = { concurrency: 1, queueLimit: 500, timeoutMs: 500 };

/** Telemetry sinks are drawn for completeness but never carry requests. */
export const TELEMETRY_KINDS: ReadonlySet<ComponentKind> = new Set(['metricsCollector', 'logAggregator']);
/** Hit ratio decides whether a request ends here or continues on a miss. */
export const CACHE_KINDS: ReadonlySet<ComponentKind> = new Set(['cache', 'cdn', 'distributedCache']);
/** Valid load-balancer targets. */
export const COMPUTE_KINDS: ReadonlySet<ComponentKind> = new Set(['server', 'containerService', 'serverless']);
/** Hand work to workers and complete the request on enqueue. */
export const MESSAGING_KINDS: ReadonlySet<ComponentKind> = new Set(['queue', 'eventStream']);
/** Must forward every request they accept (caches: every miss). Without a route they fail it instead of completing it. */
export const FORWARDING_KINDS: ReadonlySet<ComponentKind> = new Set(['loadBalancer', 'gateway', 'reverseProxy', 'waf', 'rateLimiter', 'circuitBreaker', 'dns', 'cdn', 'cache', 'distributedCache']);

/** Whether a request leaving `source` may be routed over a connection to `target`. */
export function carriesRequests(source: ComponentKind, target: ComponentKind) {
  if (TELEMETRY_KINDS.has(target) || target === 'deadLetterQueue' || TELEMETRY_KINDS.has(source) || source === 'deadLetterQueue') return false;
  if (source === 'database' && target === 'readReplica') return false;
  return true;
}

const number = (value: string | number | undefined, fallback: number) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const config = (node: SimulationNode, key: string, fallback: number) => number(node.config?.[key], fallback);
/** A configured number for this node, falling back to the engine default for its kind. */
export const param = (node: SimulationNode, key: string) => config(node, key, ENGINE_DEFAULTS[node.kind]?.[key] ?? GENERIC_DEFAULTS[key] ?? 0);

const capacityFor = (node: SimulationNode, resource?: Resource) => {
  switch (node.kind) {
    case 'server': return param(node, 'instances');
    case 'containerService': return (resource?.tasks ?? param(node, 'minTasks')) * param(node, 'slotsPerTask');
    case 'distributedCache': return param(node, 'nodes') * param(node, 'connectionsPerNode');
    case 'eventStream': return param(node, 'partitions');
    default: return param(node, 'concurrency');
  }
};
const LATENCY_KEY: Partial<Record<ComponentKind, string>> = {
  gateway: 'processingLatencyMs', loadBalancer: 'processingLatencyMs', server: 'processingLatencyMs', cache: 'lookupLatencyMs', database: 'queryLatencyMs',
  queue: 'processingLatencyMs', worker: 'processingLatencyMs', cdn: 'edgeLatencyMs', reverseProxy: 'processingLatencyMs', waf: 'inspectionLatencyMs',
  containerService: 'processingLatencyMs', readReplica: 'queryLatencyMs', distributedCache: 'lookupLatencyMs', eventStream: 'appendLatencyMs',
  rateLimiter: 'checkLatencyMs', circuitBreaker: 'processingLatencyMs',
};
const latencyFor = (node: SimulationNode) => { const key = LATENCY_KEY[node.kind]; return key ? param(node, key) : 0; };
const workerDurationFor = (node: SimulationNode) => 1000 / Math.max(1, param(node, 'processingRate'));
const MESSAGES: Partial<Record<FailureKind, string>> = { blocked: 'blocked by WAF rule', 'rate-limited': 'rate limit exceeded', 'circuit-open': 'circuit open: failing fast', throttled: 'concurrency limit reached (throttled)', unavailable: 'unavailable (scheduled outage)' };

/** Deterministic discrete-event simulator. Time is simulated milliseconds, never wall-clock time. */
export function simulate(input: SimulationInput): SimulationResult {
  const nodes = new Map(input.nodes.map(node => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of input.edges) if (nodes.has(edge.source) && nodes.has(edge.target)) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const faults = input.faults ?? [];
  const targetsOf = (node: SimulationNode) => (outgoing.get(node.id) ?? []).map(id => nodes.get(id)!);
  const resources = new Map<string, Resource>([...nodes.values()].map(node => [node.id, {
    active: 0, queue: [], completed: 0, rejected: 0, busyMs: 0, waits: [], maxQueueDepth: 0, counters: {},
    warm: 0, tasks: node.kind === 'containerService' ? Math.max(1, Math.floor(param(node, 'minTasks'))) : 0, scalePending: false, capacityMs: 0, capacityChangedAt: 0, peakCapacity: 0,
    tokens: param(node, 'burst'), refilledAt: 0, openUntil: -Infinity, window: [], cursor: 0,
  } as Resource]));
  const requests: RequestRecord[] = []; const jobs: RequestRecord[] = []; const events = new EventQueue(); const logs: string[] = [];
  const maxEvents = input.maxEvents ?? 100_000; let sequence = 0; let eventCount = 0; let cursor = 0; let roundRobin = 0;
  let seed = input.seed ?? 1; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const schedule = (event: Omit<Event, 'seq'>) => events.push({ ...event, seq: sequence++ });
  const count = (resource: Resource, key: string) => { resource.counters[key] = (resource.counters[key] ?? 0) + 1; };
  // Worker jobs use negative ids so they never share a slot with a client request.
  const recordFor = (id: number) => id < 0 ? jobs[-id - 1] : requests[id];
  /** Circuit breakers each request passed, so downstream outcomes can be reported back to them. */
  const breakersOf = new Map<number, string[]>();
  /** When a redelivered job became available again (its wait restarts there). */
  const readySince = new Map<RequestRecord, number>();

  const report = (request: RequestRecord, ok: boolean, at: number) => {
    const breakers = breakersOf.get(request.id); if (!breakers || request.internal) return;
    for (const id of breakers) {
      const breaker = nodes.get(id)!; const state = resources.get(id)!;
      state.window.push({ at, ok }); const since = at - param(breaker, 'windowMs'); while (state.window.length && state.window[0].at < since) state.window.shift();
      const failures = state.window.filter(entry => !entry.ok).length;
      if (!ok && state.window.length >= param(breaker, 'minimumRequests') && failures / state.window.length * 100 >= param(breaker, 'failureThresholdPct')) {
        state.openUntil = at + param(breaker, 'openMs'); state.window = []; count(state, 'opened');
      }
    }
  };
  const fail = (request: RequestRecord, reason: string, at: number, componentId: string | undefined, kind: FailureKind) => {
    if (request.status === 'completed' || request.status === 'failed') return;
    // Jobs retry any delivery failure (at the worker or downstream of it) while deliveries remain.
    if (request.internal && kind !== 'unfinished' && kind !== 'blocked' && redeliverOrDeadLetter(request, at)) return;
    request.status = 'failed'; request.error = reason; request.failedAt = componentId; request.failureKind = kind; request.completedAt = at; request.latency = at - request.arrivalTime;
    if (logs.length < 30) logs.push(`${request.internal ? `Job #${-request.id}` : `Request #${request.id}`} failed: ${reason}`);
    if (kind !== 'unfinished') report(request, false, at);
  };
  const finish = (request: RequestRecord, at: number) => { if (request.status !== 'failed') { request.status = 'completed'; request.completedAt = at; request.latency = at - request.arrivalTime; report(request, true, at); } };
  /** Retries a failed job while deliveries remain; returns true if it was redelivered. Exhausted jobs go to a connected DLQ. */
  const redeliverOrDeadLetter = (job: RequestRecord, at: number) => {
    const source = nodes.get(job.origin ?? ''); if (!source) return false;
    const attempts = job.attempts ?? 1;
    if (attempts < Math.max(1, Math.floor(param(source, 'maxDeliveries'))) && job.destination) {
      job.attempts = attempts + 1; const ready = at + param(source, 'redeliveryDelayMs'); (job.redeliveredAt ??= []).push(ready);
      count(resources.get(source.id)!, 'redelivered'); schedule({ type: 'redeliver', at: ready, nodeId: job.destination, requestId: job.id }); return true;
    }
    const dlq = targetsOf(source).find(target => target.kind === 'deadLetterQueue');
    if (dlq) { job.deadLetteredTo = dlq.id; count(resources.get(dlq.id)!, 'deadLettered'); count(resources.get(source.id)!, 'deadLettered'); }
    return false;
  };
  const roundRobinOver = (node: SimulationNode, targets: SimulationNode[]) => { const state = resources.get(node.id)!; return targets[state.cursor++ % targets.length]; };
  const pickNext = (node: SimulationNode) => {
    const targets = targetsOf(node).filter(target => carriesRequests(node.kind, target.kind));
    if (node.kind === 'loadBalancer') { const apps = targets.filter(target => COMPUTE_KINDS.has(target.kind)); return apps.length ? apps[roundRobin++ % apps.length] : undefined; }
    if (node.kind === 'reverseProxy') return targets.length ? roundRobinOver(node, targets) : undefined;
    return targets.length ? targets[0] : undefined;
  };
  const durationFor = (node: SimulationNode, resource: Resource, isWorker: boolean): [number, string | undefined] => {
    if (isWorker) return [workerDurationFor(node), undefined];
    switch (node.kind) {
      case 'dns': return random() * 100 < param(node, 'cachedPct') ? [0, 'cached resolution'] : [param(node, 'lookupLatencyMs'), 'resolver lookup'];
      case 'nosql': return random() * 100 < param(node, 'writeRatio') ? [param(node, 'writeLatencyMs'), 'write'] : [param(node, 'readLatencyMs'), 'read'];
      case 'objectStorage': return [param(node, 'firstByteLatencyMs') + param(node, 'objectSizeKb') / 1024 / Math.max(0.001, param(node, 'throughputMBps')) * 1000, undefined];
      case 'searchEngine': return [param(node, 'queryLatencyMs') + param(node, 'shards') * param(node, 'perShardMs'), undefined];
      case 'serverless': {
        // An instance is warm if fewer requests are running than instances already initialised.
        if (resource.active < resource.warm) return [param(node, 'executionMs'), undefined];
        resource.warm++; count(resource, 'coldStarts'); return [param(node, 'executionMs') + param(node, 'coldStartMs'), 'cold start'];
      }
      default: return [latencyFor(node), undefined];
    }
  };
  const trackCapacity = (node: SimulationNode, resource: Resource, at: number) => {
    const capacity = capacityFor(node, resource); resource.capacityMs += capacity * (Math.min(at, input.durationMs) - resource.capacityChangedAt);
    resource.capacityChangedAt = Math.min(at, input.durationMs); resource.peakCapacity = Math.max(resource.peakCapacity, capacity);
  };
  const maybeScale = (node: SimulationNode, resource: Resource, at: number) => {
    if (node.kind !== 'containerService' || resource.scalePending || !resource.queue.length || resource.tasks >= Math.floor(param(node, 'maxTasks'))) return;
    resource.scalePending = true; schedule({ type: 'scale', at: at + param(node, 'scaleOutDelayMs'), nodeId: node.id });
  };
  const start = (node: SimulationNode, request: RequestRecord, at: number, isWorker = false) => {
    const resource = resources.get(node.id)!;
    const wait = at - (readySince.get(request) ?? (request.currentComponent ? (request.processing.at(-1)?.end ?? request.arrivalTime) : request.arrivalTime));
    const timeout = param(node, 'timeoutMs'); if (wait > timeout) { resource.rejected++; fail(request, `${node.kind} timeout`, at, node.id, 'timeout'); return; }
    readySince.delete(request);
    const [duration, note] = durationFor(node, resource, isWorker); resource.active++; resource.waits.push(wait);
    request.currentComponent = node.id; request.processing.push(note ? { component: node.id, start: at, end: at + duration, wait, note } : { component: node.id, start: at, end: at + duration, wait });
    schedule({ type: isWorker ? 'worker' : 'complete', at: at + duration, nodeId: node.id, requestId: request.id, duration });
  };
  const enqueueOrStart = (node: SimulationNode, request: RequestRecord, at: number, isWorker = false) => {
    const resource = resources.get(node.id)!; const capacity = Math.max(1, Math.floor(capacityFor(node, resource))); const limit = Math.floor(param(node, 'queueLimit'));
    if (resource.active < capacity) start(node, request, at, isWorker);
    else if (resource.queue.length < limit) { resource.queue.push(request.id); resource.maxQueueDepth = Math.max(resource.maxQueueDepth, resource.queue.length); maybeScale(node, resource, at); }
    else if (node.kind === 'serverless') { resource.rejected++; count(resource, 'throttled'); fail(request, `serverless ${MESSAGES.throttled}`, at, node.id, 'throttled'); }
    else { resource.rejected++; fail(request, `${node.kind} queue full`, at, node.id, 'rejected'); }
  };
  /** Admission rules that act before a component queues or processes a request. */
  const admit = (node: SimulationNode, request: RequestRecord, at: number) => {
    const resource = resources.get(node.id)!;
    if (faults.some(fault => fault.nodeId === node.id && at >= fault.startMs && at < fault.endMs)) {
      resource.rejected++; count(resource, 'outageRejections'); fail(request, `${node.kind} ${MESSAGES.unavailable}`, at, node.id, 'unavailable'); return;
    }
    if (node.kind === 'rateLimiter') {
      const burst = Math.max(0, param(node, 'burst'));
      resource.tokens = Math.min(burst, resource.tokens + (at - resource.refilledAt) * param(node, 'ratePerSecond') / 1000); resource.refilledAt = at;
      if (resource.tokens < 1) { resource.rejected++; count(resource, 'limited'); fail(request, MESSAGES['rate-limited']!, at, node.id, 'rate-limited'); return; }
      resource.tokens -= 1;
    }
    if (node.kind === 'circuitBreaker') {
      if (at < resource.openUntil) { resource.rejected++; count(resource, 'shortCircuited'); fail(request, MESSAGES['circuit-open']!, at, node.id, 'circuit-open'); return; }
      breakersOf.set(request.id, [...(breakersOf.get(request.id) ?? []), node.id]);
    }
    if (node.kind === 'database') {
      const replicas = targetsOf(node).filter(target => target.kind === 'readReplica');
      // Only draws randomness when replicas exist, so architectures without replicas are unchanged.
      if (replicas.length && random() * 100 < param(node, 'readRatio')) {
        const wait = at - (request.currentComponent ? (request.processing.at(-1)?.end ?? request.arrivalTime) : request.arrivalTime);
        request.currentComponent = node.id; request.processing.push({ component: node.id, start: at, end: at, wait, note: 'read routed to replica' });
        count(resource, 'replicaReads'); admit(roundRobinOver(node, replicas), request, at); return;
      }
    }
    enqueueOrStart(node, request, at);
  };
  const beginNext = (node: SimulationNode, at: number, isWorker = false) => { const resource = resources.get(node.id)!; const nextId = resource.queue.shift(); if (nextId !== undefined) start(node, recordFor(nextId), at, isWorker); };
  const dispatchJob = (source: SimulationNode, worker: SimulationNode, request: RequestRecord, at: number) => {
    const job: RequestRecord = { id: -(jobs.length + 1), arrivalTime: at, origin: source.id, processing: [], status: 'pending', internal: true, parentId: request.id, destination: worker.id };
    jobs.push(job); enqueueOrStart(worker, job, at, true);
  };
  const route = (node: SimulationNode, request: RequestRecord, at: number) => {
    if (CACHE_KINDS.has(node.kind)) {
      const hit = random() < param(node, 'hitRatio') / 100; request.cache = hit ? 'hit' : 'miss'; if (hit) { finish(request, at); return; }
    }
    if (node.kind === 'waf' && random() * 100 < param(node, 'blockRatePct')) { count(resources.get(node.id)!, 'blocked'); fail(request, MESSAGES.blocked!, at, node.id, 'blocked'); return; }
    if (node.kind === 'queue') {
      const worker = targetsOf(node).find(target => target?.kind === 'worker');
      if (!worker) { fail(request, 'queue has no connected worker', at, node.id, 'unrouted'); return; }
      dispatchJob(node, worker, request, at); finish(request, at); return;
    }
    if (node.kind === 'eventStream') {
      const workers = targetsOf(node).filter(target => target.kind === 'worker');
      if (!workers.length) { fail(request, 'event stream has no connected consumer', at, node.id, 'unrouted'); return; }
      for (const worker of workers) dispatchJob(node, worker, request, at);
      finish(request, at); return;
    }
    const next = pickNext(node);
    if (!next) {
      if (FORWARDING_KINDS.has(node.kind)) fail(request, CACHE_KINDS.has(node.kind) ? `${node.kind} miss with no origin to forward to` : `${node.kind} has no downstream connection`, at, node.id, 'unrouted');
      else finish(request, at);
      return;
    }
    admit(next, request, at);
  };
  const clients = [...nodes.values()].filter(node => node.kind === 'client');
  const trafficMs = Math.min(input.durationMs, input.trafficDurationMs ?? input.durationMs);
  const rps = input.offeredRps ?? (clients.length ? config(clients[0], 'requestsPerSecond', 100) : 0);
  if (!clients.length) logs.push('No client is connected; no requests were generated.');
  for (let at = 0, id = 0; clients.length && at < trafficMs; at += 1000 / Math.max(0.001, rps), id++) schedule({ type: 'arrival', at, nodeId: clients[id % clients.length].id, requestId: id });
  while (events.length && eventCount++ < maxEvents) {
    const event = events.pop()!; cursor = event.at; if (cursor > input.durationMs) break;
    if (event.type === 'arrival') { const request: RequestRecord = { id: event.requestId!, arrivalTime: cursor, origin: event.nodeId, processing: [], status: 'pending' }; requests[event.requestId!] = request; const client = nodes.get(event.nodeId)!; const next = pickNext(client); if (!next) fail(request, 'client has no connected destination', cursor, client.id, 'unrouted'); else admit(next, request, cursor); continue; }
    const node = nodes.get(event.nodeId)!; const resource = resources.get(node.id)!;
    if (event.type === 'scale') {
      trackCapacity(node, resource, cursor); resource.tasks++; resource.scalePending = false; count(resource, 'scaleOuts');
      while (resource.queue.length && resource.active < Math.max(1, Math.floor(capacityFor(node, resource)))) beginNext(node, cursor);
      maybeScale(node, resource, cursor); continue;
    }
    if (event.type === 'redeliver') { const job = recordFor(event.requestId!); readySince.set(job, cursor); enqueueOrStart(node, job, cursor, true); continue; }
    const request = recordFor(event.requestId!); resource.active--; resource.completed++; resource.busyMs += event.duration!; if (event.type === 'worker') {
      // A worker hands the job to its first connection (e.g. an external API); otherwise the job completes here.
      const next = pickNext(node); if (next) admit(next, request, cursor); else finish(request, cursor);
      beginNext(node, cursor, true); continue;
    } route(node, request, cursor); beginNext(node, cursor);
  }
  const visible = requests.filter(Boolean).filter(request => !request.internal && (request.arrivalTime < input.durationMs));
  const waitingAt = new Map<number, string>(); for (const [id, resource] of resources) for (const queued of resource.queue) waitingAt.set(queued, id);
  for (const request of visible) if (request.status === 'pending') fail(request, 'simulation ended before completion', input.durationMs, waitingAt.get(request.id) ?? request.currentComponent, 'unfinished');
  const completed = visible.filter(request => request.status === 'completed'); const failed = visible.filter(request => request.status === 'failed'); const latencies = completed.map(request => request.latency!).sort((a, b) => a - b);
  const percentile = (p: number) => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(p * latencies.length) - 1)] : null;
  const cacheHits = visible.filter(request => request.cache === 'hit').length; const cacheMisses = visible.filter(request => request.cache === 'miss').length;
  const failuresByKind: Partial<Record<FailureKind, number>> = {}; for (const request of failed) if (request.failureKind) failuresByKind[request.failureKind] = (failuresByKind[request.failureKind] ?? 0) + 1;
  const components = [...nodes.values()].filter(node => node.kind !== 'client' && !TELEMETRY_KINDS.has(node.kind)).map(node => {
    const resource = resources.get(node.id)!; const scaled = node.kind === 'containerService';
    if (scaled) trackCapacity(node, resource, input.durationMs);
    const capacity = scaled ? resource.peakCapacity : capacityFor(node, resource);
    const utilization = node.kind === 'deadLetterQueue' ? 0 : scaled ? Math.min(1, resource.busyMs / Math.max(1, resource.capacityMs)) : Math.min(1, resource.busyMs / (Math.max(1, capacity) * input.durationMs));
    const metric: ComponentMetric = { id: node.id, kind: node.kind, completed: resource.completed, rejected: resource.rejected, busyMs: resource.busyMs, capacity, queueLimit: Math.floor(param(node, 'queueLimit')), utilization, maxQueueDepth: resource.maxQueueDepth, averageWaitMs: resource.waits.length ? resource.waits.reduce((a, b) => a + b, 0) / resource.waits.length : 0, queueDepth: resource.queue.length };
    if (Object.keys(resource.counters).length) metric.counters = resource.counters;
    return metric;
  });
  return { durationMs: input.durationMs, offeredRequests: clients.length ? Math.floor(trafficMs / 1000 * rps) : 0, completedRequests: completed.length, failedRequests: failed.length, successfulThroughput: completed.length / (trafficMs / 1000), errorRate: visible.length ? failed.length / visible.length : 0, latency: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }, cache: { hits: cacheHits, misses: cacheMisses, hitRatio: cacheHits + cacheMisses ? cacheHits / (cacheHits + cacheMisses) : null }, components, requests: visible, jobs, failuresByKind, events: logs.length ? logs : [`Processed ${completed.length} completed and ${failed.length} failed requests.`], stoppedEarly: eventCount >= maxEvents };
}
