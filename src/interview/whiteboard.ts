import { byKind, type Kind } from '../app/catalog';
import { edgeKey, validateArchitecture } from '../app/validation';
import { LLD_COVERAGE } from '../lld/coverage';
import { CACHE_KINDS, COMPUTE_KINDS, MESSAGING_KINDS, TELEMETRY_KINDS } from '../simulation/engine';
import type { DecisionAssessment } from './reasoning';
import { architectureKey, type InterviewSession, type RunEvidence } from './session';
import { mentions } from './text';
import type { InterviewDefinition, Resource } from './types';

/**
 * The whiteboard review: what an interviewer would point at on the diagram, computed from the architecture, its
 * static validation and the isolated runs recorded for it. Every finding states its evidence:
 *   fact      – read directly from the diagram or its validation (true by construction);
 *   measured  – from an isolated simulation run of exactly this architecture;
 *   risk      – reasoned from the structure but not verified, either because no run covered it or because the
 *               simulator cannot model it (see SIMULATOR_LIMITS).
 * Presence alone never counts as success: a component earns a positive finding only when it carries traffic in the
 * request path. Findings are suggestions with links into lessons, component guides, LLD and experiments.
 */
export type FindingEvidence = 'fact' | 'measured' | 'risk';
export type ReviewArea = 'requirements' | 'flow' | 'suitability' | 'paths' | 'bottlenecks' | 'failure' | 'scaling' | 'consistency' | 'tradeoffs';
export type WhiteboardFinding = { id: string; area: ReviewArea; evidence: FindingEvidence; tone: 'ok' | 'warn' | 'bad'; title: string; detail: string; action?: string; resources: Resource[] };
export type WhiteboardReview = { findings: WhiteboardFinding[]; path: string[]; notModelled: string[]; measuredOn: string | null };
export const AREA_LABELS: Record<ReviewArea, string> = {
  requirements: 'Requirement coverage', flow: 'Request flow', suitability: 'Component suitability', paths: 'Request and data paths', bottlenecks: 'Bottlenecks',
  failure: 'Failure handling', scaling: 'Scaling', consistency: 'Consistency', tradeoffs: 'Trade-off justification',
};
export const EVIDENCE_LABELS: Record<FindingEvidence, string> = { fact: 'Structural fact', measured: 'Measured', risk: 'Reasoned risk (unverified)' };
/** What the simulator does not model; findings about these are always labelled as unverified risks. */
export const SIMULATOR_LIMITS = [
  'Data values: staleness, replication lag and cache invalidation are not simulated (cache hit ratios are fixed settings).',
  'Health checks and automatic failover: a failed component stays failed for its whole outage window.',
  'Client retries, backoff and timeouts on the caller side.',
  'Gradual slowdowns, partial failures and network partitions (only scheduled full outages).',
  'Load-balancing strategies other than round-robin; servers forward along their first connection only.',
  'Money and operational cost.',
];

const lld = (kind: Kind): Resource[] => kind in LLD_COVERAGE ? [{ type: 'lld', kind }] : [];
const isCurrent = (run: RunEvidence | null | undefined, key: string): run is RunEvidence => Boolean(run && run.complete && run.architectureKey === key);

export function reviewWhiteboard(definition: InterviewDefinition, session: InterviewSession, decisions: DecisionAssessment[] = []): WhiteboardReview {
  const architecture = session.architecture;
  const findings: WhiteboardFinding[] = [];
  const add = (finding: Omit<WhiteboardFinding, 'resources'> & { resources?: Resource[] }) => findings.push({ resources: [], ...finding });
  if (!architecture?.nodes.length) {
    add({ id: 'empty', area: 'flow', evidence: 'fact', tone: 'bad', title: 'No architecture yet', detail: 'There is nothing on the whiteboard to review.', action: 'Open the canvas and add a client, an entry point, compute and storage.', resources: [{ type: 'lesson', id: 'approach' }] });
    return { findings, path: [], notModelled: SIMULATOR_LIMITS, measuredOn: null };
  }
  const key = architectureKey(architecture);
  const labels = Object.fromEntries(architecture.nodes.map(node => [node.id, node.label || byKind[node.kind].label]));
  const kindOf = new Map(architecture.nodes.map(node => [node.id, node.kind]));
  const validation = validateArchitecture({ nodes: architecture.nodes.map(node => ({ id: node.id, kind: node.kind, config: node.config })), edges: architecture.edges }, labels);
  // Components that carry requests: reachable from a client over connections the simulator uses.
  const used = (source: string, target: string) => ['used', 'dead-letter'].includes(validation.edges[edgeKey(source, target)]?.status ?? '');
  const onPath = new Set<string>(); const order: string[] = [];
  const queue = architecture.nodes.filter(node => node.kind === 'client').map(node => node.id);
  while (queue.length) { const id = queue.shift()!; if (onPath.has(id)) continue; onPath.add(id); order.push(id); for (const edge of architecture.edges) if (edge.source === id && used(edge.source, edge.target)) queue.push(edge.target); }
  const runs = [session.benchmark, ...Object.values(session.scenarioRuns), ...Object.values(session.changes).flatMap(entry => [entry.runs.original, entry.runs.revised])];
  const bench = isCurrent(session.benchmark, key) ? session.benchmark : null;
  const nodesOf = (kinds: Kind[]) => architecture.nodes.filter(node => kinds.includes(node.kind));

  // ── Requirement coverage: requirement → role → component carrying traffic ──
  for (const role of definition.roles) {
    const nodes = nodesOf(role.kinds); const carrying = nodes.filter(node => onPath.has(node.id) || ((node.kind === 'deadLetterQueue' || TELEMETRY_KINDS.has(node.kind)) && validation.components[node.id]?.status !== 'dead'));
    const served = definition.requirements.filter(entry => role.covers?.includes(entry.id)).map(entry => entry.label);
    const what = served.length ? served.join('; ') : role.label;
    if (carrying.length) add({ id: `req-${role.id}`, area: 'requirements', evidence: 'fact', tone: 'ok', title: `${what}`, detail: `Served by ${carrying.map(node => labels[node.id]).join(', ')} (${role.label.toLowerCase()}), which is in the request path.` });
    else if (nodes.length) add({ id: `req-${role.id}`, area: 'requirements', evidence: 'fact', tone: 'bad', title: `${what}`, detail: `${nodes.map(node => labels[node.id]).join(', ')} could serve this, but carries no traffic, so it does not count.`, action: 'Connect it into the request path (check which connection the upstream component uses first).', resources: [{ type: 'component', kind: nodes[0].kind }] });
    else if (role.required) add({ id: `req-${role.id}`, area: 'requirements', evidence: 'fact', tone: 'bad', title: `${what}`, detail: `Nothing fills the role “${role.label}”. ${role.why}`, action: `Consider ${role.kinds.slice(0, 3).map(kind => byKind[kind].label).join(', ')}.`, resources: role.kinds.slice(0, 2).map(kind => ({ type: 'component' as const, kind })) });
  }

  // ── Request flow ──
  if (!architecture.nodes.some(node => node.kind === 'client')) add({ id: 'no-client', area: 'flow', evidence: 'fact', tone: 'bad', title: 'No client', detail: 'Without a client nothing sends requests, so no path can be traced or measured.', action: 'Add a Client and connect it to your entry point.' });
  const dead = architecture.nodes.filter(node => validation.components[node.id]?.status === 'dead');
  for (const node of dead) add({ id: `dead-${node.id}`, area: 'flow', evidence: 'fact', tone: 'bad', title: `${labels[node.id]} is not part of a working flow`, detail: validation.components[node.id].issues[0]?.message ?? 'It cannot take part in any request flow.', action: 'Connect it, or remove it if it is not needed.', resources: [{ type: 'component', kind: node.kind }] });
  const unusedEdges = architecture.edges.filter(edge => validation.edges[edgeKey(edge.source, edge.target)]?.status === 'unused');
  for (const edge of unusedEdges.slice(0, 4)) add({ id: `unused-${edge.source}-${edge.target}`, area: 'flow', evidence: 'fact', tone: 'warn', title: `${labels[edge.source]} → ${labels[edge.target]} carries no traffic`, detail: validation.edges[edgeKey(edge.source, edge.target)]?.reason ?? 'The simulator does not route requests over this connection.', action: 'If this path matters, make it the one the upstream component uses, or put the components in series.' });
  if (!dead.length && !unusedEdges.length && architecture.nodes.some(node => node.kind === 'client')) add({ id: 'flow-ok', area: 'flow', evidence: 'fact', tone: 'ok', title: 'Every component is in a working flow', detail: 'All components are reachable from a client and every connection carries traffic.' });

  // ── Component suitability ──
  for (const entry of definition.unnecessary) for (const node of nodesOf(entry.kinds)) {
    const justified = (session.decisions[node.id] ?? '').trim().split(/\s+/).length >= 8;
    add({ id: `extra-${node.id}`, area: 'suitability', evidence: 'fact', tone: justified ? 'warn' : 'bad', title: `${labels[node.id]} adds complexity this problem may not need`, detail: `${entry.why}${justified ? ' You recorded a justification; it is not verified.' : ' No justification was recorded.'}`, action: justified ? undefined : 'Remove it, or explain which requirement needs it.', resources: [{ type: 'component', kind: node.kind }] });
  }
  for (const role of definition.roles) {
    const reference = new Set(definition.reference.architecture.diagram.nodes.flatMap(node => node.kind && role.kinds.includes(node.kind) ? [node.kind] : []));
    const choice = nodesOf(role.kinds).find(node => onPath.has(node.id) && !reference.has(node.kind));
    if (choice && reference.size) add({ id: `alt-${role.id}`, area: 'suitability', evidence: 'fact', tone: 'ok', title: `${labels[choice.id]} for ${role.label.toLowerCase()}`, detail: `A documented alternative to the reference choice (${[...reference].map(kind => byKind[kind].label).join(', ')}). Both are valid; explain why yours fits.`, resources: [{ type: 'component', kind: choice.kind }] });
  }

  // ── Request and data paths ──
  const path = order.map(id => labels[id]);
  const stores = architecture.nodes.filter(node => ['database', 'nosql', 'objectStorage', 'searchEngine'].includes(node.kind) && onPath.has(node.id));
  const offload = architecture.nodes.filter(node => (CACHE_KINDS.has(node.kind) || node.kind === 'readReplica') && onPath.has(node.id));
  if (order.length > 1) add({ id: 'path', area: 'paths', evidence: 'fact', tone: 'ok', title: 'Traced request path', detail: `In the order requests reach them: ${path.join(' → ')}.` });
  for (const node of offload) {
    const before = stores.filter(store => order.indexOf(store.id) > order.indexOf(node.id));
    if (CACHE_KINDS.has(node.kind) && stores.length) add({ id: `offload-${node.id}`, area: 'paths', evidence: 'fact', tone: before.length ? 'ok' : 'warn', title: `${labels[node.id]} ${before.length ? 'sits in front of the store' : 'is not in front of a store'}`, detail: before.length ? `Hits end at ${labels[node.id]}; misses continue to ${before.map(store => labels[store.id]).join(', ')}.` : 'Requests that reach it do not continue to a store on a miss, so it cannot reduce the store’s load.', resources: [{ type: 'lesson', id: 'why-caching' }, ...lld(node.kind)] });
  }
  if (stores.length && !offload.length && definition.roles.some(role => role.kinds.some(kind => CACHE_KINDS.has(kind) || kind === 'readReplica'))) add({ id: 'no-offload', area: 'paths', evidence: 'fact', tone: 'warn', title: 'Every read reaches the store', detail: `No cache, CDN or replica is in the request path, so ${stores.map(store => labels[store.id]).join(', ')} serves every read.`, action: 'Check the measured utilization of the store; a read-heavy problem usually needs read offloading.', resources: [{ type: 'lesson', id: 'why-caching' }, { type: 'experiment', id: 'cache-vs-database' }] });

  // ── Bottlenecks ──
  if (bench?.busiest) {
    const u = bench.busiest.utilization; const tone = u >= 0.85 ? 'bad' : u >= 0.6 ? 'warn' : 'ok';
    add({ id: 'busiest', area: 'bottlenecks', evidence: 'measured', tone, title: `${bench.busiest.label} is the busiest component (${Math.round(u * 100)}%)`, detail: `Measured at the benchmark load (${definition.benchmark.rps.toLocaleString()} req/s): ${tone === 'bad' ? 'it is saturated, so queues grow and latency rises sharply.' : tone === 'warn' ? 'little headroom remains for peaks.' : 'there is headroom at this load.'}`, action: tone === 'ok' ? undefined : 'Add capacity there, or reduce the load that reaches it (caching, batching, replicas).', resources: [{ type: 'lesson', id: 'bottlenecks' }, { type: 'experiment', id: 'find-the-bottleneck' }] });
    for (const failure of bench.failures.slice(0, 2)) add({ id: `fail-${failure.label}-${failure.kind}`, area: 'bottlenecks', evidence: 'measured', tone: 'bad', title: `${failure.count.toLocaleString()} requests failed at ${failure.label}`, detail: `Failure type: ${failure.kind}, in the benchmark run of this design.`, resources: [{ type: 'lesson', id: 'bottlenecks' }] });
  } else {
    const thin = architecture.nodes.filter(node => onPath.has(node.id) && node.kind === 'server' && Number(node.config.instances ?? 1) <= 1);
    add({ id: 'bench-missing', area: 'bottlenecks', evidence: 'risk', tone: 'warn', title: session.benchmark ? 'The benchmark was run on an earlier version' : 'Not measured', detail: `${session.benchmark ? 'The design changed since the last benchmark run, so its measurements do not apply.' : 'No benchmark has been run on this design.'}${thin.length ? ` ${thin.map(node => labels[node.id]).join(', ')} run${thin.length === 1 ? 's' : ''} a single instance, a likely limit.` : ''}`, action: 'Run the benchmark to measure where the load lands.', resources: [{ type: 'experiment', id: 'find-the-bottleneck' }] });
  }

  // ── Failure handling ──
  const compute = architecture.nodes.filter(node => onPath.has(node.id) && COMPUTE_KINDS.has(node.kind));
  const balanced = compute.filter(node => architecture.edges.some(edge => edge.target === node.id && ['loadBalancer', 'reverseProxy'].includes(kindOf.get(edge.source)!)));
  const single = compute.filter(node => node.kind === 'server' && !balanced.includes(node) && Number(node.config.instances ?? 1) <= 1);
  for (const node of single) add({ id: `spof-${node.id}`, area: 'failure', evidence: 'risk', tone: 'bad', title: `${labels[node.id]} may be a single point of failure`, detail: 'One instance with no load balancer in front: if it fails, every request fails. The simulator can show this with a scheduled outage, but it does not model health checks or automatic replacement.', action: 'Run more than one instance behind a load balancer with health checks.', resources: [{ type: 'lesson', id: 'horizontal-vertical' }, { type: 'lld', kind: 'loadBalancer' }] });
  for (const store of stores.filter(node => node.kind === 'database' && !architecture.edges.some(edge => edge.source === node.id && kindOf.get(edge.target) === 'readReplica')))
    add({ id: `store-${store.id}`, area: 'failure', evidence: 'risk', tone: 'warn', title: `${labels[store.id]} has no replica in the design`, detail: 'If the primary fails, writes stop until it recovers. Replication and failover are a reasoned answer here: the simulator does not model failover, only the outage itself.', action: 'Describe replication and failover in the decision note; run the database-outage follow-up to measure the outage.', resources: [{ type: 'component', kind: 'readReplica' }, { type: 'experiment', id: 'circuit-breaker' }] });
  const outageRuns = Object.entries(session.scenarioRuns).filter(([, run]) => isCurrent(run, key) && /outage/.test(run.label));
  for (const [id, run] of outageRuns) add({ id: `outage-${id}`, area: 'failure', evidence: 'measured', tone: run.successPct >= definition.benchmark.targets.minSuccessPct ? 'ok' : 'warn', title: `During ${run.label}: ${run.successPct.toFixed(1)}% succeeded`, detail: `p95 ${run.p95 ?? '—'} ms. Measured on this design; the outage is a scheduled window with no failover.`, resources: [{ type: 'experiment', id: 'circuit-breaker' }] });
  if (!outageRuns.length) add({ id: 'outage-unmeasured', area: 'failure', evidence: 'risk', tone: 'warn', title: 'Failure behaviour not measured', detail: 'No outage scenario has been run on this design.', action: 'Run an outage follow-up (cache or database unavailable) on this design.' });

  // ── Scaling ──
  const trafficRuns = runs.filter((run): run is RunEvidence => isCurrent(run, key) && /×\s*traffic/.test(run.label));
  for (const run of trafficRuns.slice(0, 2)) add({ id: `scale-${run.label}`, area: 'scaling', evidence: 'measured', tone: run.successPct >= definition.benchmark.targets.minSuccessPct && (run.p95 ?? Infinity) <= definition.benchmark.targets.p95Ms ? 'ok' : 'warn', title: `At ${run.label}: p95 ${run.p95 ?? '—'} ms, ${run.successPct.toFixed(1)}% succeeded`, detail: run.busiest ? `Busiest: ${run.busiest.label} at ${Math.round(run.busiest.utilization * 100)}%.` : 'Measured on this design.', resources: [{ type: 'lesson', id: 'bottlenecks' }] });
  if (!trafficRuns.length) add({ id: 'scale-unmeasured', area: 'scaling', evidence: 'risk', tone: 'warn', title: 'Growth beyond the benchmark not measured', detail: 'Whether the design holds at higher load is reasoned, not measured, until a traffic scenario runs on it.', action: 'Run the “Ten times the traffic” follow-up or a traffic requirement change.', resources: [{ type: 'experiment', id: 'find-the-bottleneck' }] });
  const stateful = compute.filter(node => mentions(session.decisions[node.id] ?? '', ['session', 'in memory', 'local state', 'sticky']));
  for (const node of stateful) add({ id: `state-${node.id}`, area: 'scaling', evidence: 'risk', tone: 'warn', title: `${labels[node.id]} may hold state`, detail: 'Its decision note mentions sessions or local state; state on a server limits horizontal scaling and is lost when it fails.', resources: [{ type: 'lesson', id: 'stateful-stateless' }] });

  // ── Consistency (never simulated) ──
  const copies = architecture.nodes.filter(node => onPath.has(node.id) && (CACHE_KINDS.has(node.kind) || node.kind === 'readReplica' || MESSAGING_KINDS.has(node.kind)));
  for (const node of copies) {
    const text = [session.decisions[node.id], ...Object.values(session.explanations[node.id] ?? {})].join(' ');
    const addressed = mentions(text, ['stale', 'ttl', 'invalidat', 'lag', 'eventual', 'consisten', 'idempoten', 'duplicate', 'order']);
    const what = MESSAGING_KINDS.has(node.kind) ? 'Asynchronous delivery can duplicate, delay or reorder work' : node.kind === 'readReplica' ? 'Replicas can serve reads that lag behind the primary' : 'Cached copies can be stale until they expire or are invalidated';
    add({ id: `consistency-${node.id}`, area: 'consistency', evidence: 'risk', tone: addressed ? 'ok' : 'warn', title: `${labels[node.id]}: ${what.toLowerCase()}`, detail: `${addressed ? 'Your notes address this.' : 'Your notes do not say how much inconsistency is acceptable or how it is bounded.'} The simulator does not model data values, so this is reasoned only.`, action: addressed ? undefined : 'State the acceptable staleness and how it is bounded (TTL, invalidation, read-your-writes, idempotency).', resources: [{ type: 'lesson', id: 'why-caching' }, { type: 'component', kind: node.kind }, ...lld(node.kind)] });
  }

  // ── Trade-off justification (from the reasoning rubric) ──
  if (decisions.length) {
    const withTradeoffs = decisions.filter(entry => entry.dimensions.find(dim => dim.id === 'tradeoffs')?.met);
    const withAlternatives = decisions.filter(entry => entry.dimensions.find(dim => dim.id === 'alternatives')?.met);
    const tone = withTradeoffs.length === decisions.length && withAlternatives.length === decisions.length ? 'ok' : withTradeoffs.length || withAlternatives.length ? 'warn' : 'bad';
    add({ id: 'justification', area: 'tradeoffs', evidence: 'fact', tone, title: `${withTradeoffs.length} of ${decisions.length} major decisions state a trade-off; ${withAlternatives.length} name an alternative`, detail: 'This counts what your explanations contain; whether the reasoning is right is not verified automatically.', action: tone === 'ok' ? undefined : `Explain the cost and the alternative for: ${decisions.filter(entry => !withTradeoffs.includes(entry) || !withAlternatives.includes(entry)).map(entry => entry.label).join(', ')}.`, resources: [{ type: 'lesson', id: 'sync-async' }] });
  }
  return { findings, path, notModelled: SIMULATOR_LIMITS, measuredOn: bench ? bench.label : null };
}
