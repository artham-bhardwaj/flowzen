import type { Edge, Node } from '@xyflow/react';
import type { SimulationInput } from '../simulation/engine';
import { byKind, type Kind } from './catalog';

export type ViewMode = 'HLD' | 'LLD' | 'Unified';
/** `fixture` marks a given system in a challenge: it cannot be deleted and its locked settings are fixed. */
export type ComponentData = { label: string; kind: Kind; config: Record<string, string>; fixture?: boolean };
export type FlowNode = Node<ComponentData, 'architecture'>;
export type FlowEdge = Edge;

export const NODE_WIDTH = 228;

export const place = (id: string, kind: Kind, label: string, x: number, y: number): FlowNode =>
  ({ id, type: 'architecture', position: { x, y }, data: { label, kind, config: { ...byKind[kind].defaults } } });

export const sampleNodes = (): FlowNode[] => [
  place('client', 'client', 'Web & Mobile', 0, 110),
  place('lb', 'loadBalancer', 'Load Balancer', 286, 110),
  place('app-a', 'server', 'Checkout API · A', 572, 0),
  place('app-b', 'server', 'Checkout API · B', 572, 220),
  place('cache', 'cache', 'Session Cache', 858, 110),
  place('db', 'database', 'Orders DB', 1144, 110),
  place('events', 'client', 'Order Events', 0, 400),
  place('queue', 'queue', 'Fulfilment Queue', 286, 400),
  place('worker', 'worker', 'Fulfilment Worker', 572, 400),
];
export const sampleEdges = (): FlowEdge[] =>
  [['client', 'lb'], ['lb', 'app-a'], ['lb', 'app-b'], ['app-a', 'cache'], ['app-b', 'cache'], ['cache', 'db'], ['events', 'queue'], ['queue', 'worker']]
    .map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'flow' }));

export function simulationInput(nodes: FlowNode[], edges: FlowEdge[], offeredRps: number, durationMs: number): SimulationInput {
  return {
    nodes: nodes.map(node => ({ id: node.id, kind: node.data.kind, config: node.data.config })),
    edges: edges.map(edge => ({ source: edge.source, target: edge.target })),
    durationMs, offeredRps, seed: 42,
  };
}
/** Identifies everything that affects simulation output (positions and names do not). */
export const simulationKey = (input: SimulationInput) => JSON.stringify([input.nodes, input.edges, input.durationMs, input.offeredRps, input.seed]);
