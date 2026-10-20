import {
  CACHE_KINDS, COMPUTE_KINDS, FORWARDING_KINDS, GENERIC_DEFAULTS, ENGINE_DEFAULTS, MESSAGING_KINDS, TELEMETRY_KINDS,
  carriesRequests, type ComponentKind, type SimulationInput, type SimulationNode,
} from '../simulation/engine';

export type ComponentStatus = 'functional' | 'warning' | 'dead';
export type Fix =
  | { type: 'remove-edge'; label: string; source: string; target: string }
  | { type: 'remove-node'; label: string; nodeId: string }
  | { type: 'set-config'; label: string; nodeId: string; key: string; value: string }
  | { type: 'add-downstream'; label: string; nodeId: string; kind: ComponentKind };
export type Issue = { severity: 'warning' | 'dead'; code: string; message: string; nodeId?: string; edge?: EdgeRef; fix?: Fix };
export type EdgeRef = { source: string; target: string };
export type EdgeStatus = { status: 'used' | 'unused' | 'telemetry' | 'dead-letter'; reason?: string };
export type ComponentValidation = { status: ComponentStatus; simulated: boolean; summary: string; issues: Issue[] };
export type Validation = {
  components: Record<string, ComponentValidation>;
  edges: Record<string, EdgeStatus>;
  global: Issue[];
  counts: Record<ComponentStatus, number>;
  /** All issues, dead first, for summaries and the pre-run review. */
  issues: Issue[];
};

export const edgeKey = (source: string, target: string) => `${source}->${target}`;
type Route = { target: string; via: 'request' | 'miss' | 'replica' | 'job' | 'dead-letter'; possible: boolean; reason?: string };

const KIND_NAMES: Record<ComponentKind, string> = {
  client: 'Client', loadBalancer: 'Load Balancer', gateway: 'API Gateway', server: 'Application Server', cache: 'Cache', database: 'SQL Database',
  queue: 'Message Queue', worker: 'Worker', dns: 'DNS', cdn: 'CDN', reverseProxy: 'Reverse Proxy', waf: 'WAF', serverless: 'Serverless Function',
  containerService: 'Container Service', nosql: 'NoSQL Database', readReplica: 'Read Replica', objectStorage: 'Object Storage', searchEngine: 'Search Engine',
  distributedCache: 'Distributed Cache', eventStream: 'Event Stream', deadLetterQueue: 'Dead-Letter Queue', rateLimiter: 'Rate Limiter',
  circuitBreaker: 'Circuit Breaker', metricsCollector: 'Metrics Collector', logAggregator: 'Log Aggregator',
};
const PERCENT_KEYS = ['hitRatio', 'cachedPct', 'blockRatePct', 'writeRatio', 'readRatio', 'failureThresholdPct'];

/** Same parsing rule as the engine. Returns null when the engine would fall back to its default. */
const parse = (value: string | number | undefined) => { const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; };
const fallback = (kind: ComponentKind, key: string) => ENGINE_DEFAULTS[kind]?.[key] ?? GENERIC_DEFAULTS[key];
const value = (node: SimulationNode, key: string) => parse(node.config?.[key]) ?? fallback(node.kind, key) ?? 0;
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;

/**
 * Validates an architecture against the engine's routing rules. Statuses describe whether a
 * component can take part in a request flow; they are computed from the graph and configuration
 * only and never from simulation results.
 */
export function validateArchitecture(input: Pick<SimulationInput, 'nodes' | 'edges'>, labels: Record<string, string> = {}): Validation {
  const nodes = new Map(input.nodes.map(node => [node.id, node]));
  const name = (id: string) => labels[id] || KIND_NAMES[nodes.get(id)?.kind ?? 'client'] || id;
  const list = (ids: string[]) => ids.map(name).join(', ');
  const outgoing = new Map<string, string[]>(); const incoming = new Map<string, string[]>();
  for (const edge of input.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }
  const kindOf = (id: string) => nodes.get(id)!.kind;

  // ── Routes, mirroring the engine's routing decisions ────────────────────────────────
  const routes = new Map<string, Route[]>();
  const routesOf = (node: SimulationNode): Route[] => {
    const targets = outgoing.get(node.id) ?? []; const eligible = targets.filter(target => carriesRequests(node.kind, kindOf(target)));
    const first = (via: Route['via'] = 'request', possible = true, reason?: string): Route[] => eligible.length ? [{ target: eligible[0], via, possible, reason }] : [];
    const deadLetters = (possible: boolean): Route[] => targets.filter(target => kindOf(target) === 'deadLetterQueue').map(target => ({ target, via: 'dead-letter', possible, reason: possible ? undefined : 'it has no Worker, so no job can fail' }));
    switch (node.kind) {
      case 'metricsCollector': case 'logAggregator': case 'deadLetterQueue': return [];
      case 'queue': { const worker = targets.find(target => kindOf(target) === 'worker'); return [...(worker ? [{ target: worker, via: 'job' as const, possible: true }] : []), ...deadLetters(!!worker)]; }
      case 'eventStream': { const workers = targets.filter(target => kindOf(target) === 'worker'); return [...workers.map(target => ({ target, via: 'job' as const, possible: true })), ...deadLetters(workers.length > 0)]; }
      case 'worker': return first('request', true);
      case 'loadBalancer': return eligible.filter(target => COMPUTE_KINDS.has(kindOf(target))).map(target => ({ target, via: 'request' as const, possible: true }));
      case 'reverseProxy': return eligible.map(target => ({ target, via: 'request' as const, possible: true }));
      case 'database': {
        const replicas = targets.filter(target => kindOf(target) === 'readReplica'); const reads = replicas.length ? Math.min(100, value(node, 'readRatio')) : 0;
        return [...replicas.map(target => ({ target, via: 'replica' as const, possible: reads > 0, reason: reads > 0 ? undefined : 'the read share is 0%' })), ...first('request', reads < 100, 'every query is a read routed to replicas (read share 100%)')];
      }
      case 'waf': return first('request', value(node, 'blockRatePct') < 100, 'the WAF blocks 100% of requests');
      case 'rateLimiter': return first('request', value(node, 'ratePerSecond') > 0 || value(node, 'burst') >= 1, 'the rate limiter admits no requests (rate 0, burst below 1)');
      default:
        if (CACHE_KINDS.has(node.kind)) return first('miss', value(node, 'hitRatio') < 100, 'the hit ratio is 100%, so no misses are forwarded');
        return first();
    }
  };
  for (const node of input.nodes) routes.set(node.id, routesOf(node));
  const directlyRequested = (id: string) => [...routes.values()].some(list => list.some(route => route.target === id && route.via === 'request'));

  // ── Reachability from clients over routes the configuration allows ──────────────────
  const clients = input.nodes.filter(node => node.kind === 'client').map(node => node.id);
  const reachable = new Set<string>(); const stack = [...clients];
  while (stack.length) { const id = stack.pop()!; if (reachable.has(id)) continue; reachable.add(id); for (const route of routes.get(id) ?? []) if (route.possible) stack.push(route.target); }

  // ── Connection status ───────────────────────────────────────────────────────────────
  const edges: Record<string, EdgeStatus> = {};
  for (const [source, targets] of outgoing) for (const target of targets) {
    const key = edgeKey(source, target); const route = routes.get(source)?.find(candidate => candidate.target === target);
    if (TELEMETRY_KINDS.has(kindOf(target))) { edges[key] = { status: 'telemetry', reason: 'Telemetry only: never carries requests.' }; continue; }
    if (route?.via === 'dead-letter') { edges[key] = route.possible ? { status: 'dead-letter', reason: 'Carries jobs that exhaust their deliveries.' } : { status: 'unused', reason: `No dead letters can occur: ${route.reason}.` }; continue; }
    if (route) { edges[key] = route.possible ? { status: 'used' } : { status: 'unused', reason: `${route.reason![0].toUpperCase()}${route.reason!.slice(1)}.` }; continue; }
    edges[key] = { status: 'unused', reason: unusedReason(nodes.get(source)!, nodes.get(target)!, routes.get(source) ?? [], name) };
  }

  // ── Per-component rules ─────────────────────────────────────────────────────────────
  const components: Record<string, ComponentValidation> = {}; const global: Issue[] = [];
  if (input.nodes.length && !clients.length) global.push({ severity: 'dead', code: 'no-client', message: 'There is no Client, so the simulation generates no traffic. Add a Client and connect it to your entry point.' });

  for (const node of input.nodes) {
    const issues: Issue[] = []; const id = node.id; const kind = node.kind; const label = name(id);
    const add = (severity: Issue['severity'], code: string, message: string, fix?: Fix, edge?: EdgeRef) => issues.push({ severity, code, message, nodeId: id, fix, edge });
    const outs = outgoing.get(id) ?? []; const ins = incoming.get(id) ?? []; const simulated = !TELEMETRY_KINDS.has(kind);
    const removeNode: Fix = { type: 'remove-node', label: 'Remove component', nodeId: id };

    // Configuration: values the engine cannot read, or values outside their meaningful range.
    for (const [key, raw] of Object.entries(node.config ?? {})) {
      const engineDefault = fallback(kind, key); if (engineDefault === undefined || !simulated) continue;
      const parsed = parse(raw);
      if (parsed === null) add('warning', 'invalid-config', `“${raw}” is not a number for ${key}; the simulator uses ${engineDefault}.`, { type: 'set-config', label: `Reset to ${engineDefault}`, nodeId: id, key, value: String(engineDefault) });
      else if (PERCENT_KEYS.includes(key) && parsed > 100) add('warning', 'percent-range', `${key} is ${parsed}%; values above 100% behave as 100%.`, { type: 'set-config', label: 'Set to 100', nodeId: id, key, value: '100' });
    }
    if (simulated && kind !== 'client' && parse(node.config?.timeoutMs) === 0) add('warning', 'zero-timeout', 'Queue timeout is 0 ms: any request that has to wait times out.', { type: 'set-config', label: 'Set to 500 ms', nodeId: id, key: 'timeoutMs', value: '500' });

    if (!simulated) {
      if (!ins.length) add('warning', 'no-telemetry', `Nothing sends telemetry to ${label}. Connect components to it to document what it observes.`);
      for (const target of outs) add('warning', 'telemetry-output', `${label} is a telemetry sink; its connection to ${name(target)} is not used.`, { type: 'remove-edge', label: 'Remove connection', source: id, target }, { source: id, target });
      components[id] = finalize(issues, false, 'Visual only: not simulated. It does not carry requests or affect performance.');
      continue;
    }

    const addEntry: Fix = { type: 'add-downstream', label: 'Add a Load Balancer after it', nodeId: id, kind: 'loadBalancer' };
    if (!outs.length && !ins.length) add('dead', 'disconnected', kind === 'client' ? `${label} is not connected to anything, so every request it sends fails.` : `${label} is not connected to anything.`, kind === 'client' ? addEntry : removeNode);
    else if (kind === 'client') {
      if (!(routes.get(id) ?? []).length) add('dead', 'no-destination', `${label} has no request-carrying connection, so every request it sends fails.`, addEntry);
    } else if (clients.length && !reachable.has(id)) add('dead', 'unreachable', unreachableReason(node, ins, routes, reachable, name), ins.length ? undefined : removeNode);

    // Rules for components that receive traffic. A disconnected component already has its explanation.
    const reached = reachable.has(id); const connected = outs.length > 0 || ins.length > 0;
    if (!connected) { /* covered by 'disconnected' */ }
    else if (kind === 'loadBalancer' && !outs.some(target => COMPUTE_KINDS.has(kindOf(target)))) add(reached ? 'dead' : 'warning', 'no-compute', `${label} has no Application Server, Container Service or Serverless Function connected, so every request it receives fails.`, { type: 'add-downstream', label: 'Add an Application Server', nodeId: id, kind: 'server' });
    else if (MESSAGING_KINDS.has(kind) && !outs.some(target => kindOf(target) === 'worker')) add(reached ? 'dead' : 'warning', 'no-consumer', `${label} has no Worker connected, so every request sent to it fails.`, { type: 'add-downstream', label: 'Add a Worker', nodeId: id, kind: 'worker' });
    else if (CACHE_KINDS.has(kind) && !(routes.get(id) ?? []).length && value(node, 'hitRatio') < 100) add('warning', 'no-origin', `${label} has nothing behind it, so its misses fail (about ${pct(100 - Math.min(100, value(node, 'hitRatio')))} of its requests).`, { type: 'add-downstream', label: kind === 'cdn' ? 'Add an origin server' : 'Add a SQL Database', nodeId: id, kind: kind === 'cdn' ? 'server' : 'database' });
    else if (FORWARDING_KINDS.has(kind) && !CACHE_KINDS.has(kind) && kind !== 'loadBalancer' && !(routes.get(id) ?? []).length) add(reached ? 'dead' : 'warning', 'no-downstream', `${label} must forward requests but has no downstream connection, so every request it accepts fails.`, { type: 'add-downstream', label: 'Add an Application Server', nodeId: id, kind: 'server' });

    if (kind === 'waf' && value(node, 'blockRatePct') >= 100) add('dead', 'blocks-all', `${label} blocks 100% of requests, so nothing passes it.`, { type: 'set-config', label: `Set block rate to ${fallback(kind, 'blockRatePct')}%`, nodeId: id, key: 'blockRatePct', value: String(fallback(kind, 'blockRatePct')) });
    if (kind === 'rateLimiter') {
      if (value(node, 'ratePerSecond') <= 0 && value(node, 'burst') < 1) add('dead', 'admits-none', `${label} has rate 0 and burst below 1, so it rejects every request.`, { type: 'set-config', label: `Set rate to ${fallback(kind, 'ratePerSecond')}/s`, nodeId: id, key: 'ratePerSecond', value: String(fallback(kind, 'ratePerSecond')) });
      else if (value(node, 'ratePerSecond') <= 0) add('warning', 'burst-only', `${label} has rate 0: only the first ${Math.floor(value(node, 'burst'))} requests are admitted.`, { type: 'set-config', label: `Set rate to ${fallback(kind, 'ratePerSecond')}/s`, nodeId: id, key: 'ratePerSecond', value: String(fallback(kind, 'ratePerSecond')) });
    }
    if (CACHE_KINDS.has(kind) && value(node, 'hitRatio') >= 100 && (routes.get(id) ?? []).length) add('warning', 'never-misses', `${label} hits 100% of lookups, so ${list((routes.get(id) ?? []).map(route => route.target))} never receives traffic from it.`, { type: 'set-config', label: `Set hit ratio to ${fallback(kind, 'hitRatio')}%`, nodeId: id, key: 'hitRatio', value: String(fallback(kind, 'hitRatio')) });
    if (CACHE_KINDS.has(kind) && connected && value(node, 'hitRatio') <= 0) add('warning', 'never-hits', `${label} has a 0% hit ratio: every lookup misses, so it only adds latency.`);
    if (kind === 'database' && outs.some(target => kindOf(target) === 'readReplica') && value(node, 'readRatio') <= 0) add('warning', 'replicas-unused', `${label} routes 0% of reads to its replicas, so they receive no traffic.`, { type: 'set-config', label: `Set read share to ${fallback(kind, 'readRatio')}%`, nodeId: id, key: 'readRatio', value: String(fallback(kind, 'readRatio')) });
    if (kind === 'containerService' && value(node, 'minTasks') > value(node, 'maxTasks')) add('warning', 'tasks-range', `${label} has min tasks above max tasks; it starts at ${value(node, 'minTasks')} tasks and never scales.`);
    if (kind === 'circuitBreaker' && value(node, 'failureThresholdPct') <= 0) add('warning', 'zero-threshold', `${label} has a 0% failure threshold: any failure after the minimum requests opens the circuit.`);
    if (kind === 'worker' && directlyRequested(id)) add('warning', 'direct-worker', `${label} receives requests directly from ${list(ins.filter(source => (routes.get(source) ?? []).some(route => route.target === id && route.via === 'request')))}. Workers are meant to consume from a queue; these requests are processed synchronously like a server.`);
    if (kind === 'readReplica' && ins.some(source => kindOf(source) !== 'database' && (routes.get(source) ?? []).some(route => route.target === id && route.via === 'request'))) add('warning', 'replica-direct', `${label} receives requests directly instead of reads routed from a SQL Database; it serves them like any database.`);

    // Connections that carry nothing, and connections into clients.
    for (const target of outs) {
      const status = edges[edgeKey(id, target)];
      if (status?.status === 'unused') add('warning', 'bypassed-connection', `Connection to ${name(target)} carries no requests: ${status.reason}`, { type: 'remove-edge', label: 'Remove connection', source: id, target }, { source: id, target });
    }
    if (kind === 'client' && ins.length) for (const source of ins) add('warning', 'into-client', `${name(source)} connects into ${label}. Clients only generate traffic; requests routed here pass straight through.`, { type: 'remove-edge', label: 'Remove connection', source, target: id }, { source, target: id });

    const summary = kind === 'client' ? 'Generates traffic into the architecture.' : reached ? 'Reachable from a Client and able to process its traffic.' : clients.length ? 'Not reachable from a Client.' : 'No Client generates traffic.';
    components[id] = finalize(issues, true, summary);
  }
  if (!clients.length) for (const node of input.nodes) if (!TELEMETRY_KINDS.has(node.kind) && components[node.id].status !== 'dead') {
    components[node.id].issues.unshift({ severity: 'dead', code: 'no-client', message: 'No Client in the architecture generates traffic, so this component never receives requests.', nodeId: node.id });
    components[node.id].status = 'dead';
  }

  const counts: Record<ComponentStatus, number> = { functional: 0, warning: 0, dead: 0 };
  for (const entry of Object.values(components)) counts[entry.status]++;
  const issues = [...global, ...Object.values(components).flatMap(entry => entry.issues)].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'dead' ? -1 : 1));
  return { components, edges, global, counts, issues };
}

function finalize(issues: Issue[], simulated: boolean, summary: string): ComponentValidation {
  const status: ComponentStatus = issues.some(issue => issue.severity === 'dead') ? 'dead' : issues.length ? 'warning' : 'functional';
  return { status, simulated, summary, issues };
}

function unusedReason(source: SimulationNode, target: SimulationNode, routes: Route[], name: (id: string) => string) {
  const used = routes.filter(route => route.via !== 'dead-letter').map(route => name(route.target));
  if (source.kind === 'deadLetterQueue') return 'dead-letter queues hold jobs; they do not forward.';
  if (target.kind === 'deadLetterQueue') return 'only a Message Queue or Event Stream sends dead letters.';
  if (source.kind === 'loadBalancer') return `load balancers only route to compute (Application Server, Container Service, Serverless Function).`;
  if (source.kind === 'queue' && target.kind === 'worker') return `a Message Queue dispatches to its first Worker only (${used.join(', ')}). Use an Event Stream to fan out.`;
  if (MESSAGING_KINDS.has(source.kind)) return 'queues and streams only deliver jobs to Workers.';
  return `${name(source.id)} forwards only to its first connection${used.length ? ` (${used.join(', ')})` : ''}.`;
}

function unreachableReason(node: SimulationNode, ins: string[], routes: Map<string, Route[]>, reachable: Set<string>, name: (id: string) => string) {
  if (node.kind === 'worker' && !ins.length) return 'Workers only receive jobs from a connected Message Queue or Event Stream, and nothing is connected to it.';
  if (node.kind === 'deadLetterQueue' && !ins.length) return 'A dead-letter queue only receives failed jobs from a connected Message Queue or Event Stream.';
  if (node.kind === 'readReplica' && !ins.length) return 'Read replicas receive reads from a connected SQL Database (connect primary → replica).';
  if (!ins.length) return `Nothing connects to ${name(node.id)}, so no Client's requests can reach it.`;
  const reasons = ins.map(source => {
    const route = routes.get(source)?.find(candidate => candidate.target === node.id);
    if (!reachable.has(source)) return `${name(source)} is itself unreachable`;
    if (!route) return `${name(source)} never routes requests here`;
    if (!route.possible) return `${name(source)} sends nothing here because ${route.reason}`;
    return `${name(source)} routes here`;
  });
  return `No Client's requests can reach it: ${reasons.join('; ')}.`;
}
