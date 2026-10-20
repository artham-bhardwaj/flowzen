import { describe, expect, it } from 'vitest';
import { neighborsOf } from './neighbors';
import { sampleEdges, sampleNodes, simulationInput } from './model';
import { validateArchitecture } from './validation';

describe('neighborsOf', () => {
  it('lists upstream and downstream components with whether the simulator uses each connection', () => {
    const nodes = sampleNodes(); const edges = [...sampleEdges(), { id: 'app-a-db', source: 'app-a', target: 'db', type: 'flow' }];
    const validation = validateArchitecture(simulationInput(nodes, edges, 100, 1000));
    const lb = neighborsOf('lb', nodes, edges, validation);
    expect(lb.upstream.map(entry => entry.id)).toEqual(['client']);
    expect(lb.downstream.map(entry => [entry.id, entry.edgeStatus])).toEqual([['app-a', 'used'], ['app-b', 'used']]);
    // An application server only routes to its first connection, so the second one is reported unused with a reason.
    const app = neighborsOf('app-a', nodes, edges, validation);
    expect(app.downstream.find(entry => entry.id === 'db')?.edgeStatus).toBe('unused');
    expect(app.downstream.find(entry => entry.id === 'db')?.reason).toBeTruthy();
  });
  it('ignores connections to missing components', () => {
    const nodes = sampleNodes().filter(node => node.id !== 'db');
    expect(neighborsOf('cache', nodes, sampleEdges(), { edges: {} }).downstream).toEqual([]);
  });
});
