import { byKind } from '../app/catalog';
import type { FlowEdge, FlowNode } from '../app/model';
import type { Challenge } from './definitions';
import { lockedConfig, type Architecture } from './grading';

/** Applies the benchmark's locked settings so the canvas shows exactly what will be graded. */
export function withLocks(challenge: Challenge, node: FlowNode): FlowNode {
  const locked = lockedConfig(challenge, { id: node.id, kind: node.data.kind });
  const fixture = challenge.fixtures[node.id]?.kind === node.data.kind;
  if (!Object.keys(locked).length && !fixture) return node;
  return { ...node, deletable: fixture ? false : node.deletable, data: { ...node.data, fixture: fixture || undefined, config: { ...node.data.config, ...locked } } };
}

export function starterArchitecture(challenge: Challenge): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes = challenge.starter.nodes.map(entry => withLocks(challenge, {
    id: entry.id, type: 'architecture', position: { x: entry.x, y: entry.y },
    data: { label: entry.label, kind: entry.kind, config: { ...byKind[entry.kind].defaults, ...entry.config } },
  }));
  const edges = challenge.starter.edges.map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'flow' }));
  return { nodes, edges };
}

export const toArchitecture = (nodes: FlowNode[], edges: FlowEdge[]): Architecture => ({
  nodes: nodes.map(node => ({ id: node.id, kind: node.data.kind, config: node.data.config, label: node.data.label })),
  edges: edges.map(edge => ({ source: edge.source, target: edge.target })),
});
