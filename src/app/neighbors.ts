import { byKind, type Kind } from './catalog';
import type { FlowEdge, FlowNode } from './model';
import { edgeKey, type Validation } from './validation';

export type Neighbor = { id: string; label: string; kind: Kind; kindLabel: string; edgeStatus: 'used' | 'unused' | 'telemetry' | 'dead-letter' | 'unknown'; reason?: string };

/**
 * A component's direct neighbors on the canvas, with whether the simulator actually uses each
 * connection (from static validation). Used to explain a component's role in the architecture.
 */
export function neighborsOf(nodeId: string, nodes: FlowNode[], edges: FlowEdge[], validation: Pick<Validation, 'edges'>): { upstream: Neighbor[]; downstream: Neighbor[] } {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const describe = (otherId: string, source: string, target: string): Neighbor | null => {
    const other = byId.get(otherId); if (!other) return null;
    const status = validation.edges[edgeKey(source, target)];
    return { id: other.id, label: other.data.label || byKind[other.data.kind].label, kind: other.data.kind, kindLabel: byKind[other.data.kind].label, edgeStatus: status?.status ?? 'unknown', reason: status?.reason };
  };
  const upstream = edges.filter(edge => edge.target === nodeId).map(edge => describe(edge.source, edge.source, edge.target)).filter((entry): entry is Neighbor => entry !== null);
  const downstream = edges.filter(edge => edge.source === nodeId).map(edge => describe(edge.target, edge.source, edge.target)).filter((entry): entry is Neighbor => entry !== null);
  return { upstream, downstream };
}
