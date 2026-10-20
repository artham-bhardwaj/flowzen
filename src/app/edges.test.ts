import { describe, expect, it } from 'vitest';
import { isAllowedConnection, reconnectEdge } from './edges';
import { sampleEdges } from './model';
import { ArchitectureHistory } from './history';
import { sampleNodes } from './model';

const connection = (source: string, target: string) => ({ source, target, sourceHandle: null, targetHandle: null });

describe('detaching and moving connections', () => {
  it('detaches a connection dropped away from any handle', () => {
    const edges = sampleEdges(); const edge = edges.find(entry => entry.id === 'cache-db')!;
    const result = reconnectEdge(edges, edge, null);
    expect(result.change).toBe('detached'); expect(result.edges.some(entry => entry.id === 'cache-db')).toBe(false);
    expect(result.edges).toHaveLength(edges.length - 1); expect(edges).toHaveLength(sampleEdges().length); // input untouched
  });
  it('moves a connection to another handle and keeps the id convention', () => {
    const edges = sampleEdges(); const edge = edges.find(entry => entry.id === 'app-a-cache')!;
    const result = reconnectEdge(edges, edge, connection('app-a', 'db'));
    expect(result.change).toBe('moved');
    expect(result.edges.find(entry => entry.id === 'app-a-db')).toMatchObject({ source: 'app-a', target: 'db', type: 'flow' });
    expect(result.edges).toHaveLength(edges.length);
  });
  it('leaves the connection alone when dropped back where it was, or onto a duplicate or itself', () => {
    const edges = sampleEdges(); const edge = edges.find(entry => entry.id === 'lb-app-a')!;
    expect(reconnectEdge(edges, edge, connection('lb', 'app-a'))).toEqual({ edges, change: 'unchanged' });
    expect(reconnectEdge(edges, edge, connection('lb', 'app-b')).change).toBe('unchanged'); // lb → app-b already exists
    expect(reconnectEdge(edges, edge, connection('lb', 'lb')).change).toBe('unchanged');
  });
  it('validates new connections while ignoring the edge being dragged', () => {
    const edges = sampleEdges();
    expect(isAllowedConnection(edges, connection('lb', 'app-a'))).toBe(false);
    expect(isAllowedConnection(edges, connection('lb', 'app-a'), 'lb-app-a')).toBe(true);
    expect(isAllowedConnection(edges, connection('db', 'db'))).toBe(false);
    expect(isAllowedConnection(edges, connection('events', 'lb'))).toBe(true);
  });
  it('is undoable as one step', () => {
    const nodes = sampleNodes(); const edges = sampleEdges();
    const history = new ArchitectureHistory('design', nodes, edges);
    const detached = reconnectEdge(edges, edges[0], null).edges;
    history.observe(nodes, detached, 1);
    expect(history.active.undoLabel).toBe('Disconnect Web & Mobile → Load Balancer');
    const restored = history.undo({ nodes, edges: detached })!;
    expect(restored.edges.map(edge => edge.id).sort()).toEqual(edges.map(edge => edge.id).sort());
  });
});
