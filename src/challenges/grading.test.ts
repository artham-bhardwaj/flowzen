import { describe, expect, it } from 'vitest';
import { simulate, type ComponentKind } from '../simulation/engine';
import { byKind } from '../app/catalog';
import type { FlowEdge, FlowNode } from '../app/model';
import { validateArchitecture } from '../app/validation';
import { challengeById, challenges, type Challenge, type Comparator } from './definitions';
import { benchmarkInput, computeSlots, grade } from './grading';
import { starterArchitecture, toArchitecture, withLocks } from './starter';

const get = (id: string) => challengeById(id)!;
const add = (challenge: Challenge, id: string, kind: ComponentKind, config: Record<string, string> = {}): FlowNode =>
  withLocks(challenge, { id, type: 'architecture', position: { x: 0, y: 0 }, data: { label: id, kind, config: { ...byKind[kind].defaults, ...config } } });
const wire = (pairs: Array<[string, string]>): FlowEdge[] => pairs.map(([source, target]) => ({ id: `${source}-${target}`, source, target }));
const set = (nodes: FlowNode[], id: string, config: Record<string, string>) => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, config: { ...node.data.config, ...config } } } : node);
function submit(challenge: Challenge, nodes: FlowNode[], edges: FlowEdge[], tweak?: (input: ReturnType<typeof benchmarkInput>) => void) {
  const input = benchmarkInput(challenge, toArchitecture(nodes, edges)); tweak?.(input);
  return grade(challenge, input, simulate(input), validateArchitecture(input));
}
const starter = (id: string) => { const challenge = get(id); return { challenge, ...starterArchitecture(challenge) }; };
const failing = (result: ReturnType<typeof submit>) => result.criteria.filter(entry => entry.status !== 'pass' && entry.mandatory).map(entry => entry.id);

/** Reference solutions: more than one design passes where the problem allows it. */
const solutions: Record<string, Array<() => { nodes: FlowNode[]; edges: FlowEdge[] }>> = {
  'slow-api': [
    () => { const s = starter('slow-api'); return { nodes: set(s.nodes, 'api', { instances: '14' }), edges: s.edges }; },
    () => { const { challenge, nodes } = starter('slow-api'); return { nodes: [...set(nodes, 'api', { instances: '7' }), add(challenge, 'lb', 'loadBalancer'), add(challenge, 'api-2', 'server', { instances: '7' })], edges: wire([['users', 'lb'], ['lb', 'api'], ['lb', 'api-2']]) }; },
  ],
  'cache-it-right': [
    () => { const { challenge, nodes } = starter('cache-it-right'); return { nodes: [...nodes, add(challenge, 'cache', 'cache', { concurrency: '2' })], edges: wire([['users', 'api'], ['api', 'cache'], ['cache', 'orders-db']]) }; },
    () => { const { challenge, nodes } = starter('cache-it-right'); return { nodes: [...nodes, add(challenge, 'cache', 'distributedCache')], edges: wire([['users', 'api'], ['api', 'cache'], ['cache', 'orders-db']]) }; },
  ],
  'scale-the-backend': [
    () => { const { challenge, nodes } = starter('scale-the-backend'); return { nodes: [...set(nodes, 'lb', { concurrency: '2' }).filter(node => node.id !== 'app-1'), add(challenge, 'tasks', 'containerService', { minTasks: '9', maxTasks: '9', slotsPerTask: '4' })], edges: wire([['users', 'lb'], ['lb', 'tasks'], ['tasks', 'sessions-db']]) }; },
    () => { const { challenge, nodes } = starter('scale-the-backend'); return { nodes: [...set(set(nodes, 'lb', { concurrency: '2' }), 'app-1', { instances: '18' }), add(challenge, 'app-2', 'server', { instances: '18' })], edges: wire([['users', 'lb'], ['lb', 'app-1'], ['lb', 'app-2'], ['app-1', 'sessions-db'], ['app-2', 'sessions-db']]) }; },
  ],
  'async-processing': [
    () => { const { challenge, nodes } = starter('async-processing'); return { nodes: [...nodes, add(challenge, 'stream', 'eventStream')], edges: wire([['users', 'upload-api'], ['upload-api', 'stream'], ['stream', 'processor']]) }; },
    () => { const { challenge, nodes } = starter('async-processing'); return { nodes: [...nodes, add(challenge, 'queue', 'queue')], edges: wire([['users', 'upload-api'], ['upload-api', 'queue'], ['queue', 'processor']]) }; },
  ],
  'protect-the-ledger': [
    () => { const { challenge, nodes } = starter('protect-the-ledger'); return { nodes: [...nodes, add(challenge, 'rl', 'rateLimiter', { ratePerSecond: '480', burst: '10' })], edges: wire([['users', 'rl'], ['rl', 'payments-api'], ['payments-api', 'ledger']]) }; },
    () => { const s = starter('protect-the-ledger'); return { nodes: set(s.nodes, 'payments-api', { instances: '5', queueLimit: '0' }), edges: s.edges }; },
  ],
  'go-global': [
    () => { const { challenge, nodes } = starter('go-global'); return { nodes: [...nodes, add(challenge, 'cdn', 'cdn')], edges: wire([['users', 'cdn'], ['cdn', 'origin']]) }; },
    () => { const { challenge, nodes } = starter('go-global'); return { nodes: [...nodes, add(challenge, 'cache', 'cache', { concurrency: '4' })], edges: wire([['users', 'cache'], ['cache', 'origin']]) }; },
  ],
  'read-heavy-catalog': [
    () => { const { challenge, nodes } = starter('read-heavy-catalog'); return { nodes: [...nodes, add(challenge, 'replica-1', 'readReplica', { concurrency: '24' })], edges: wire([['users', 'api'], ['api', 'catalog-db'], ['catalog-db', 'replica-1']]) }; },
    () => { const { challenge, nodes } = starter('read-heavy-catalog'); return { nodes: [...nodes, add(challenge, 'replica-1', 'readReplica'), add(challenge, 'replica-2', 'readReplica')], edges: wire([['users', 'api'], ['api', 'catalog-db'], ['catalog-db', 'replica-1'], ['catalog-db', 'replica-2']]) }; },
  ],
  'fan-out-notifications': [
    () => { const { challenge, nodes } = starter('fan-out-notifications'); return { nodes: [...nodes, add(challenge, 'stream', 'eventStream')], edges: wire([['users', 'orders-api'], ['orders-api', 'stream'], ['stream', 'email'], ['stream', 'analytics']]) }; },
  ],
  'black-friday': [
    () => { const { challenge, nodes } = starter('black-friday'); return { nodes: [...set(set(nodes, 'lb', { concurrency: '4' }), 'app-1', { instances: '22' }), add(challenge, 'app-2', 'server', { instances: '22' }), add(challenge, 'cache', 'cache', { concurrency: '10' })], edges: wire([['users', 'lb'], ['lb', 'app-1'], ['lb', 'app-2'], ['app-1', 'cache'], ['app-2', 'cache'], ['cache', 'products-db']]) }; },
    () => { const { challenge, nodes } = starter('black-friday'); return { nodes: [...set(set(nodes, 'lb', { concurrency: '4' }), 'app-1', { instances: '22' }), add(challenge, 'app-2', 'server', { instances: '22' }), add(challenge, 'cache', 'distributedCache')], edges: wire([['users', 'lb'], ['lb', 'app-1'], ['lb', 'app-2'], ['app-1', 'cache'], ['app-2', 'cache'], ['cache', 'products-db']]) }; },
  ],
  'reliable-checkout': [
    () => { const { challenge, nodes } = starter('reliable-checkout'); return { nodes: [...nodes, add(challenge, 'q', 'queue', { maxDeliveries: '8', redeliveryDelayMs: '1000' }), add(challenge, 'pw', 'worker', { concurrency: '20' })], edges: wire([['users', 'checkout-api'], ['checkout-api', 'q'], ['q', 'pw'], ['pw', 'payment-provider']]) }; },
  ],
};

describe('challenge grading', () => {
  it('fails every starter architecture and passes every reference solution', () => {
    for (const challenge of challenges) {
      const s = starterArchitecture(challenge);
      expect(submit(challenge, s.nodes, s.edges).passed, `${challenge.id} starter`).toBe(false);
      expect(solutions[challenge.id]?.length, `${challenge.id} has a reference solution`).toBeGreaterThan(0);
      for (const solution of solutions[challenge.id]) { const { nodes, edges } = solution(); const result = submit(challenge, nodes, edges); expect(failing(result), challenge.id).toEqual([]); expect(result.passed).toBe(true); }
    }
  });

  it('is deterministic for the same architecture', () => {
    for (const challenge of challenges) { const { nodes, edges } = solutions[challenge.id][0](); expect(JSON.stringify(submit(challenge, nodes, edges))).toBe(JSON.stringify(submit(challenge, nodes, edges))); }
  });

  it('applies each comparator exactly at its threshold for every criterion', () => {
    const outcomes: Record<Comparator, boolean> = { '<=': true, '>=': true, '<': false, '>': false };
    for (const challenge of challenges) {
      const { nodes, edges } = solutions[challenge.id][0]();
      const input = benchmarkInput(challenge, toArchitecture(nodes, edges)); const result = simulate(input); const validation = validateArchitecture(input);
      // Grading is pure, so one simulation is re-graded against each threshold variant.
      const regrade = (variant: Challenge) => grade(variant, input, result, validation);
      const measured = regrade(challenge);
      for (const entry of measured.criteria.filter(item => item.measured !== null)) {
        for (const comparator of Object.keys(outcomes) as Comparator[]) {
          const variant: Challenge = { ...challenge, criteria: challenge.criteria.map(c => c.id === entry.id ? { ...c, comparator, threshold: entry.measured! } : c) };
          const outcome = regrade(variant).criteria.find(item => item.id === entry.id)!;
          expect(outcome.status, `${challenge.id}.${entry.id} ${comparator}`).toBe(outcomes[comparator] ? 'pass' : 'fail');
        }
        // Just past the threshold on the wrong side fails.
        const original = challenge.criteria.find(c => c.id === entry.id)!; const epsilon = original.comparator.startsWith('<') ? -0.001 : 0.001;
        const strict: Challenge = { ...challenge, criteria: challenge.criteria.map(c => c.id === entry.id ? { ...c, threshold: entry.measured! + epsilon, comparator: original.comparator.startsWith('<') ? '<=' : '>=' } : c) };
        expect(regrade(strict).criteria.find(item => item.id === entry.id)!.status, `${challenge.id}.${entry.id} just past`).toBe('fail');
      }
    }
  });

  it('reports measured values, thresholds and margins', () => {
    const s = starter('slow-api'); const result = submit(s.challenge, s.nodes, s.edges);
    const p95 = result.criteria.find(entry => entry.id === 'p95')!;
    expect(p95).toMatchObject({ status: 'fail', threshold: 100, comparator: '<=' });
    expect(p95.measured!).toBeGreaterThan(100); expect(p95.detail).toMatch(/over the limit/);
    expect(result.summary).toMatchObject({ offeredRps: 300, offeredRequests: 3000 });
    expect(result.summary!.successThroughput).toBeLessThan(result.summary!.offeredRps);
    expect(p95.missedBy).toBeCloseTo(p95.measured! - 100, 1);
    expect(result.criteria.find(entry => entry.id === 'budget')!.category).toBe('architecture');
    expect(p95.category).toBe('runtime');
    expect(result.mainBottleneck?.title).toMatch(/Profile API/); expect(result.mainBottleneck!.evidence.join(' ')).toMatch(/busy over the run/);
  });

  it('never passes invalid, incomplete or unmeasurable submissions', () => {
    const challenge = get('slow-api');
    const empty = grade(challenge, benchmarkInput(challenge, { nodes: [], edges: [] }), simulate(benchmarkInput(challenge, { nodes: [], edges: [] })), validateArchitecture({ nodes: [], edges: [] }));
    expect(empty.passed).toBe(false); expect(empty.invalidReason).toMatch(/no traffic/);
    expect(empty.criteria.filter(entry => entry.id === 'p95' || entry.id === 'throughput').map(entry => entry.status)).toEqual(['unavailable', 'unavailable']);

    const { nodes, edges } = solutions['slow-api'][0]();
    const input = benchmarkInput(challenge, toArchitecture(nodes, edges));
    expect(grade(challenge, input, null, validateArchitecture(input)).passed).toBe(false);
    const truncated = grade(challenge, input, simulate({ ...input, maxEvents: 500 }), validateArchitecture(input));
    expect(truncated.passed).toBe(false); expect(truncated.invalidReason).toMatch(/event limit/);
    const wrongWorkload = grade(challenge, input, simulate({ ...input, offeredRps: 50 }), validateArchitecture(input));
    expect(wrongWorkload.passed).toBe(false); expect(wrongWorkload.invalidReason).toMatch(/does not match/);

    const disconnected = submit(challenge, nodes, []);
    expect(disconnected.passed).toBe(false); expect(disconnected.criteria.find(entry => entry.id === 'p95')!.status).toBe('unavailable');
  });

  it('ships no requirement the simulator cannot measure', () => {
    for (const challenge of challenges) expect(challenge.criteria.filter(criterion => criterion.metric.kind === 'unsupported').map(criterion => criterion.id), challenge.id).toEqual([]);
  });

  it('marks unsupported metrics as unsupported and never lets a mandatory one pass', () => {
    // The grader still handles unsupported criteria safely, should one ever be declared.
    const base = get('reliable-checkout'); const { nodes, edges } = solutions['reliable-checkout'][0]();
    const unsupported = (mandatory: boolean): Challenge => ({ ...base, criteria: [...base.criteria, { id: 'exactly-once', label: 'Payments captured exactly once', metric: { kind: 'unsupported', reason: 'No idempotency model.' }, comparator: '<=', threshold: 0, unit: '', mandatory, advice: '' }] });
    const informational = submit(unsupported(false), nodes, edges);
    expect(informational.criteria.find(entry => entry.id === 'exactly-once')).toMatchObject({ status: 'unsupported', measured: null, missedBy: null });
    expect(informational.passed).toBe(true);
    expect(submit(unsupported(true), nodes, edges).passed).toBe(false);
  });

  it('treats missing metrics as unavailable, never as a pass', () => {
    const challenge = get('cache-it-right'); const s = starterArchitecture(challenge);
    // The criteria name the Orders DB; without it, its load share and utilization cannot be measured.
    const without = submit(challenge, [...s.nodes.filter(node => node.id !== 'orders-db')], wire([['users', 'api']]));
    for (const id of ['db-load', 'db-util']) expect(without.criteria.find(entry => entry.id === id)).toMatchObject({ status: 'unavailable', measured: null });
    expect(without.passed).toBe(false);
  });

  it('measures component utilization from the engine', () => {
    const challenge = get('cache-it-right'); const s = starterArchitecture(challenge);
    const starterResult = submit(challenge, s.nodes, s.edges);
    expect(starterResult.criteria.find(entry => entry.id === 'db-util')).toMatchObject({ status: 'fail' });
    const input = benchmarkInput(challenge, toArchitecture(s.nodes, s.edges)); const run = simulate(input);
    const engineValue = run.components.find(component => component.id === 'orders-db')!.utilization * 100;
    expect(grade(challenge, input, run, validateArchitecture(input)).criteria.find(entry => entry.id === 'db-util')!.measured).toBeCloseTo(engineValue, 6);
    const { nodes, edges } = solutions['cache-it-right'][0]();
    expect(submit(challenge, nodes, edges).criteria.find(entry => entry.id === 'db-util')!.status).toBe('pass');
  });

  it('explains behavior only from measured evidence', () => {
    // A bypassed cache: requests reach the database without passing through it.
    const cache = starter('cache-it-right');
    const bypassed = submit(cache.challenge, [...cache.nodes, add(cache.challenge, 'cache', 'cache', { concurrency: '4' })], wire([['users', 'api'], ['api', 'orders-db'], ['api', 'cache']]));
    expect(bypassed.findings.find(finding => finding.kind === 'cache')!.title).toMatch(/received no requests/);
    expect(bypassed.mainBottleneck!.component).toBe('orders-db');
    // A working cache: about 80% served from cache, evidence from traces.
    const reference = solutions['cache-it-right'][0](); const working = submit(cache.challenge, reference.nodes, reference.edges);
    const cacheFinding = working.findings.find(finding => finding.kind === 'cache')!;
    expect(cacheFinding.severity).toBe('info'); expect(cacheFinding.title).toMatch(/served (79|80|81)(\.\d)?% of its lookups/);
    expect(cacheFinding.evidence.join(' ')).toMatch(/of all requests reached Orders DB/);
    // Failure counts in findings equal the failures in the traces.
    const slow = starter('slow-api'); const input = benchmarkInput(slow.challenge, toArchitecture(slow.nodes, slow.edges)); const run = simulate(input);
    const result = grade(slow.challenge, input, run, validateArchitecture(input));
    const counted = result.findings.filter(finding => finding.kind === 'failures').reduce((sum, finding) => sum + Number(finding.title.split(' ')[0].replace(/,/g, '')), 0);
    expect(counted).toBe(run.requests.filter(request => request.status === 'failed').length);
    // A passing design has no high-severity finding; an invalid run has no findings at all.
    const { nodes, edges } = solutions['slow-api'][0]();
    expect(submit(slow.challenge, nodes, edges).findings.filter(finding => finding.severity === 'high')).toEqual([]);
    expect(grade(slow.challenge, input, null, validateArchitecture(input)).findings).toEqual([]);
  });

  it('returns frozen results and never mutates the architecture, the run or the validation', () => {
    const challenge = get('slow-api'); const { nodes, edges } = solutions['slow-api'][0]();
    const architecture = toArchitecture(nodes, edges); const before = JSON.stringify(architecture);
    const input = benchmarkInput(challenge, architecture); const run = simulate(input); const validation = validateArchitecture(input);
    const runBefore = JSON.stringify(run); const validationBefore = JSON.stringify(validation);
    const result = grade(challenge, input, run, validation);
    expect(JSON.stringify(architecture)).toBe(before); expect(JSON.stringify(run)).toBe(runBefore); expect(JSON.stringify(validation)).toBe(validationBefore);
    expect(Object.isFrozen(result) && Object.isFrozen(result.criteria) && Object.isFrozen(result.criteria[0]) && Object.isFrozen(result.summary)).toBe(true);
    expect(() => { (result.criteria[0] as { status: string }).status = 'pass'; }).toThrow();
    // The run itself stays usable (e.g. for playback): grading does not freeze it.
    expect(Object.isFrozen(run.requests)).toBe(false);
  });

  it('does not let the mere presence of a component satisfy a performance requirement', () => {
    const cache = starter('cache-it-right');
    const bypassed = submit(cache.challenge, [...cache.nodes, add(cache.challenge, 'cache', 'cache', { concurrency: '4' })], wire([['users', 'api'], ['api', 'orders-db'], ['api', 'cache']]));
    expect(failing(bypassed)).toEqual(expect.arrayContaining(['db-load', 'p95', 'errors']));
    const behind = submit(cache.challenge, [...cache.nodes, add(cache.challenge, 'cache', 'cache', { concurrency: '4' })], wire([['users', 'api'], ['api', 'orders-db'], ['orders-db', 'cache']]));
    expect(behind.passed).toBe(false);

    const ledger = starter('protect-the-ledger');
    const idleLimiter = submit(ledger.challenge, [...ledger.nodes, add(ledger.challenge, 'rl', 'rateLimiter', { ratePerSecond: '480' })], [...ledger.edges, ...wire([['users', 'rl']])]);
    expect(failing(idleLimiter)).toEqual(expect.arrayContaining(['ledger-queue', 'shed-early']));

    const checkout = starter('reliable-checkout');
    const unwired = submit(checkout.challenge, [...checkout.nodes, add(checkout.challenge, 'q', 'queue', { maxDeliveries: '8' }), add(checkout.challenge, 'pw', 'worker')], [...checkout.edges, ...wire([['q', 'pw']])]);
    expect(failing(unwired)).toEqual(expect.arrayContaining(['errors', 'dead']));
    const noRetries = submit(checkout.challenge, [...checkout.nodes, add(checkout.challenge, 'q', 'queue'), add(checkout.challenge, 'pw', 'worker', { concurrency: '20' })], wire([['users', 'checkout-api'], ['checkout-api', 'q'], ['q', 'pw'], ['pw', 'payment-provider']]));
    expect(failing(noRetries)).toEqual(['captured']);

    const asyncChallenge = starter('async-processing');
    const sync = submit(asyncChallenge.challenge, asyncChallenge.nodes, asyncChallenge.edges);
    expect(failing(sync)).toEqual(['p95']);
  });

  it('grades the benchmark workload and locked settings, not user edits or toolbar settings', () => {
    const challenge = get('cache-it-right'); const s = starterArchitecture(challenge);
    const boosted = set(s.nodes, 'orders-db', { concurrency: '500', queryLatencyMs: '1' });
    const input = benchmarkInput(challenge, toArchitecture(boosted, s.edges));
    expect(input.nodes.find(node => node.id === 'orders-db')!.config).toMatchObject({ concurrency: '8', queryLatencyMs: '40' });
    expect(input).toMatchObject({ offeredRps: 500, durationMs: 11_000, trafficDurationMs: 10_000, seed: 202 });
    expect(submit(challenge, boosted, s.edges).passed).toBe(false);
    const cheat = submit(challenge, [...s.nodes, add(challenge, 'cache', 'cache', { hitRatio: '100', concurrency: '4' })], wire([['users', 'api'], ['api', 'cache'], ['cache', 'orders-db']]));
    expect(cheat.criteria.find(entry => entry.id === 'db-load')!.measured!).toBeGreaterThan(15);
    const fast = submit(get('slow-api'), set(starter('slow-api').nodes, 'api', { processingLatencyMs: '1' }), starter('slow-api').edges);
    expect(fast.passed).toBe(false);
  });

  it('checks given systems and compute budgets structurally', () => {
    const s = starter('cache-it-right');
    const missing = submit(s.challenge, s.nodes.filter(node => node.id !== 'orders-db'), wire([['users', 'api']]));
    expect(missing.criteria.find(entry => entry.id === 'fixtures')).toMatchObject({ status: 'fail', measured: 1 });
    const slow = starter('slow-api');
    const over = submit(slow.challenge, set(slow.nodes, 'api', { instances: '25' }), slow.edges);
    expect(failing(over)).toEqual(['budget']);
    expect(computeSlots([{ id: 'a', kind: 'server', config: { instances: '4' } }, { id: 'b', kind: 'containerService', config: { maxTasks: '3', slotsPerTask: '2' } }, { id: 'c', kind: 'serverless', config: { concurrency: '5' } }])).toBe(15);
  });
});

describe('challenge definitions', () => {
  it('state functional and non-functional requirements, topics and hints for every challenge', () => {
    for (const challenge of challenges) {
      expect(challenge.functional.length, challenge.id).toBeGreaterThan(0);
      expect(challenge.requirements.length, challenge.id).toBeGreaterThan(0);
      expect(challenge.topics.length, challenge.id).toBeGreaterThan(0);
      expect(challenge.hints.length, challenge.id).toBeGreaterThan(1);
      expect(challenge.criteria.filter(criterion => criterion.mandatory).length, challenge.id).toBeGreaterThan(0);
    }
  });
  it('includes the five required challenges', () => {
    expect(challenges.map(challenge => challenge.title)).toEqual(expect.arrayContaining(['The Slow API', 'Cache It Right', 'Scale the Backend', 'Reliable Checkout', 'Async Processing']));
  });
});

describe('new challenges reject plausible but wrong designs for the right reason', () => {
  it('fan-out: a message queue reaches only one consumer', () => {
    const { challenge, nodes } = starter('fan-out-notifications');
    const result = submit(challenge, [...nodes, add(challenge, 'q', 'queue')], wire([['users', 'orders-api'], ['orders-api', 'q'], ['q', 'email'], ['q', 'analytics']]));
    expect(failing(result)).toContain('analytics'); expect(failing(result)).not.toContain('email');
  });
  it('read-heavy catalog: a low-hit cache alone does not relieve the primary', () => {
    const { challenge, nodes } = starter('read-heavy-catalog');
    const result = submit(challenge, [...nodes, add(challenge, 'cache', 'cache', { concurrency: '8' })], wire([['users', 'api'], ['api', 'cache'], ['cache', 'catalog-db']]));
    expect(failing(result)).toContain('primary-util');
  });
  it('go global: scaling out the origin side still sends every request to an origin', () => {
    const { challenge, nodes } = starter('go-global');
    const result = submit(challenge, [...nodes, add(challenge, 'lb', 'loadBalancer', { concurrency: '2' }), add(challenge, 'origin-2', 'server', { instances: '20' })], wire([['users', 'lb'], ['lb', 'origin'], ['lb', 'origin-2']]));
    expect(failing(result)).toContain('origin-load');
  });
  it('black friday: a single-slot cache becomes the bottleneck', () => {
    const { challenge, nodes } = starter('black-friday');
    const result = submit(challenge, [...set(set(nodes, 'lb', { concurrency: '4' }), 'app-1', { instances: '22' }), add(challenge, 'app-2', 'server', { instances: '22' }), add(challenge, 'cache', 'cache')], wire([['users', 'lb'], ['lb', 'app-1'], ['lb', 'app-2'], ['app-1', 'cache'], ['app-2', 'cache'], ['cache', 'products-db']]));
    expect(result.passed).toBe(false); expect(result.mainBottleneck?.component).toBe('cache');
  });
});
