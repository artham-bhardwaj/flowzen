import type { FlowNode } from '../../app/model';
import type { Neighbor } from '../../app/neighbors';
import { lldModelFor } from '../../lld';
import { LldInspector } from './LldInspector';

/** Loaded on demand: resolves the selected component's model and renders its inspector. */
export default function LldPanel({ node, neighbors, onSelectNode, standalone }: { node: FlowNode; neighbors: { upstream: Neighbor[]; downstream: Neighbor[] }; onSelectNode: (id: string) => void; standalone?: boolean }) {
  const model = lldModelFor(node.data.kind);
  if (!model) return null;
  return <LldInspector key={node.id} node={node} model={model} neighbors={neighbors} onSelectNode={onSelectNode} standalone={standalone} />;
}
