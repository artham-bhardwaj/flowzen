import { byKind, type Kind } from '../app/catalog';
import type { FlowEdge, FlowNode } from '../app/model';
import { GUIDES, type Alternative } from './components';

/**
 * "Try alternative": replace one component with an alternative kind, keeping its id, position and connections.
 * Pure. The app applies it as one undoable edit, and only after saving the current design as a variant, so the
 * original architecture is never lost or silently rewritten.
 */
export const swappableAlternatives = (kind: Kind): Array<Alternative & { kind: Kind }> =>
  GUIDES[kind].alternatives.filter((entry): entry is Alternative & { kind: Kind } => entry.kind !== undefined && entry.kind !== kind && entry.kind in byKind);

export function swapComponent(nodes: FlowNode[], edges: FlowEdge[], id: string, kind: Kind): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  const target = nodes.find(node => node.id === id);
  if (!target || target.data.fixture || target.data.kind === kind || !swappableAlternatives(target.data.kind).some(entry => entry.kind === kind)) return null;
  const previous = byKind[target.data.kind]; const next = byKind[kind];
  // A default label follows the kind; a label the user chose is kept.
  const label = target.data.label === previous.label || !target.data.label ? next.label : target.data.label;
  return {
    nodes: nodes.map(node => node.id === id ? { ...node, data: { label, kind, config: { ...next.defaults } } } : node),
    edges: edges.map(edge => ({ ...edge })),
  };
}
