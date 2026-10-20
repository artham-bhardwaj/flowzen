import { describe, expect, it } from 'vitest';
import { simulate, type ComponentKind, type SimulationNode } from '../simulation/engine';
import { createPlaybackIndex } from '../simulation/playback';
import { byKind, catalog } from './catalog';
import { sampleEdges, sampleNodes, simulationInput } from './model';
import { edgeKey, validateArchitecture } from './validation';

const node = (id: string, kind: ComponentKind, config: Record<string, string | number> = {}): SimulationNode => ({ id, kind, config: { ...Object.fromEntries(Object.entries(byKind[kind].defaults)), ...Object.fromEntries(Object.entries(config).map(([k, v]) => [k, String(v)])) } });
const graph = (nodes: SimulationNode[], edges: Array<[string, string]>) => ({ nodes, edges: edges.map(([source, target]) => ({ source, target })) });
const status = (g: ReturnType<typeof graph>, id: string) => validateArchitecture(g).components[id];
const codes = (g: ReturnType<typeof graph>, id: string) => status(g, id).issues.map(issue => issue.code);

describe('architecture validation', () => {
  it('marks every component of the sample architecture functional', () => {
    const result = validateArchitecture(simulationInput(sampleNodes(), sampleEdges(), 400, 1000));
    expect(result.counts).toEqual({ functional: sampleNodes().length, warning: 0, dead: 0 });
    expect(result.issues).toEqual([]);
  });

  it('flags disconnected and unreachable components as dead with explanations', () => {
    const g = graph([node('c', 'client'), node('app', 'server'), node('lonely', 'cache'), node('island', 'server'), node('db', 'database')], [['c', 'app'], ['island', 'db']]);
    expect(status(g, 'lonely')).toMatchObject({ status: 'dead', issues: [{ code: 'disconnected' }] });
    expect(status(g, 'island').status).toBe('dead');
    expect(status(g, 'db').issues[0].message).toMatch(/Application Server is itself unreachable/);
    expect(status(g, 'app').status).toBe('functional');
  });

  it('treats incomplete paths through forwarding components as dead', () => {
    const g = graph([node('c', 'client'), node('lb', 'loadBalancer'), node('gw', 'gateway')], [['c', 'gw'], ['gw', 'lb']]);
    expect(status(g, 'lb')).toMatchObject({ status: 'dead' });
    expect(codes(g, 'lb')).toContain('no-compute');
    expect(status(g, 'lb').issues[0].fix).toMatchObject({ type: 'add-downstream', kind: 'server' });
    expect(status(g, 'gw').status).toBe('functional');
  });

  it('accepts valid branching through load balancers, proxies, streams and replicas', () => {
    const g = graph([
      node('c', 'client'), node('rp', 'reverseProxy'), node('lb', 'loadBalancer'), node('a', 'server'), node('b', 'containerService'), node('fn', 'serverless'),
      node('db', 'database'), node('r1', 'readReplica'), node('r2', 'readReplica'), node('s', 'eventStream'), node('w1', 'worker'), node('w2', 'worker'),
    ], [['c', 'rp'], ['rp', 'lb'], ['rp', 's'], ['lb', 'a'], ['lb', 'b'], ['lb', 'fn'], ['a', 'db'], ['db', 'r1'], ['db', 'r2'], ['s', 'w1'], ['s', 'w2']]);
    const result = validateArchitecture(g);
    expect(result.counts).toEqual({ functional: 12, warning: 0, dead: 0 });
  });

  it('does not mark optional components dead and keeps observability visual-only', () => {
    const g = graph([node('c', 'client'), node('app', 'server'), node('q', 'queue'), node('w', 'worker'), node('dlq', 'deadLetterQueue'), node('m', 'metricsCollector'), node('logs', 'logAggregator')],
      [['c', 'app'], ['app', 'q'], ['q', 'w'], ['q', 'dlq'], ['app', 'm']]);
    expect(status(g, 'dlq').status).toBe('functional');
    expect(status(g, 'm')).toMatchObject({ status: 'functional', simulated: false });
    expect(status(g, 'logs')).toMatchObject({ status: 'warning', simulated: false, issues: [{ code: 'no-telemetry' }] });
    expect(validateArchitecture(g).edges[edgeKey('app', 'm')].status).toBe('telemetry');
    // The telemetry connection is not "first connection" for routing: the queue still receives traffic.
    expect(status(g, 'app').status).toBe('functional');
  });

  it('detects bypassed connections and explains which route is used', () => {
    const g = graph([node('c', 'client'), node('app', 'server'), node('cache', 'cache'), node('db', 'database')], [['c', 'app'], ['app', 'cache'], ['app', 'db'], ['cache', 'db']]);
    const app = status(g, 'app');
    expect(app.status).toBe('warning');
    expect(app.issues[0]).toMatchObject({ code: 'bypassed-connection', edge: { source: 'app', target: 'db' }, fix: { type: 'remove-edge' } });
    expect(app.issues[0].message).toMatch(/first connection \(Cache\)/);
    expect(status(g, 'db').status).toBe('functional');
  });

  it('applies component-specific configuration rules', () => {
    const blocked = graph([node('c', 'client'), node('waf', 'waf', { blockRatePct: 100 }), node('app', 'server')], [['c', 'waf'], ['waf', 'app']]);
    expect(codes(blocked, 'waf')).toContain('blocks-all'); expect(status(blocked, 'app').status).toBe('dead');
    expect(status(blocked, 'app').issues[0].message).toMatch(/blocks 100%/);

    const allHits = graph([node('c', 'client'), node('cache', 'cache', { hitRatio: 100 }), node('db', 'database')], [['c', 'cache'], ['cache', 'db']]);
    expect(codes(allHits, 'cache')).toContain('never-misses'); expect(status(allHits, 'db').status).toBe('dead');

    const noReads = graph([node('c', 'client'), node('db', 'database', { readRatio: 0 }), node('r', 'readReplica')], [['c', 'db'], ['db', 'r']]);
    expect(codes(noReads, 'db')).toContain('replicas-unused'); expect(status(noReads, 'r').status).toBe('dead');

    const limiter = graph([node('c', 'client'), node('rl', 'rateLimiter', { ratePerSecond: 0, burst: 0 }), node('app', 'server')], [['c', 'rl'], ['rl', 'app']]);
    expect(status(limiter, 'rl').status).toBe('dead');

    const invalid = graph([node('c', 'client'), node('app', 'server', { processingLatencyMs: 'fast' })], [['c', 'app']]);
    expect(status(invalid, 'app')).toMatchObject({ status: 'warning', issues: [{ code: 'invalid-config', fix: { type: 'set-config', key: 'processingLatencyMs', value: '25' } }] });

    const range = graph([node('c', 'client'), node('cdn', 'cdn', { hitRatio: 140 }), node('o', 'server')], [['c', 'cdn'], ['cdn', 'o']]);
    expect(codes(range, 'cdn')).toEqual(expect.arrayContaining(['percent-range', 'never-misses']));
  });

  it('flags messaging without consumers, workers without queues, and connections into clients', () => {
    const g = graph([node('c', 'client'), node('q', 'queue'), node('w', 'worker'), node('c2', 'client'), node('app', 'server')], [['c', 'q'], ['c2', 'app'], ['app', 'c'], ['w', 'app']]);
    expect(status(g, 'q')).toMatchObject({ status: 'dead' }); expect(codes(g, 'q')).toContain('no-consumer');
    expect(status(g, 'w').issues[0].message).toMatch(/Workers only receive jobs/);
    expect(codes(g, 'c')).toContain('into-client');
  });

  it('reports a missing client as a global issue', () => {
    const result = validateArchitecture(graph([node('app', 'server'), node('db', 'database')], [['app', 'db']]));
    expect(result.global[0].code).toBe('no-client');
    expect(result.counts.dead).toBe(2);
  });

  it('agrees with the engine about which connections carry traffic', () => {
    const g = graph([
      node('c', 'client'), node('dns', 'dns'), node('cdn', 'cdn'), node('waf', 'waf'), node('rl', 'rateLimiter'), node('lb', 'loadBalancer'), node('a', 'server'), node('b', 'server'),
      node('cache', 'distributedCache'), node('db', 'database'), node('r', 'readReplica'), node('m', 'metricsCollector'), node('extra', 'nosql'),
    ], [['c', 'dns'], ['dns', 'cdn'], ['cdn', 'waf'], ['waf', 'rl'], ['rl', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'cache'], ['b', 'cache'], ['a', 'm'], ['cache', 'db'], ['cache', 'extra'], ['db', 'r']]);
    const validation = validateArchitecture(g);
    const used = Object.entries(validation.edges).filter(([, edge]) => edge.status === 'used').map(([key]) => key).sort();
    const lanes = Object.keys(createPlaybackIndex(simulate({ ...g, durationMs: 2000, offeredRps: 200, seed: 5 })).lanes).sort();
    expect(lanes).toEqual(used);
    expect(validation.components.extra.status).toBe('dead');
  });

  it('every catalog component has a contract and engine-backed defaults', () => {
    for (const entry of catalog) {
      expect(entry.inputs && entry.outputs && entry.behavior).toBeTruthy();
      for (const field of entry.fields.filter(field => field.simulated)) expect(field.fallback, `${entry.kind}.${field.key}`).toBeTypeOf('number');
    }
  });
});
