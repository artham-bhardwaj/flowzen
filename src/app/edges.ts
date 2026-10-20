import type { Connection } from '@xyflow/react';
import type { FlowEdge } from './model';

/**
 * Whether a new or moved connection is allowed: no self-loops and no duplicate of another connection.
 * `ignoreId` is the edge being dragged, so dropping it back where it started is valid.
 */
export function isAllowedConnection(edges: FlowEdge[], connection: Pick<Connection, 'source' | 'target'>, ignoreId?: string | null) {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  return !edges.some(edge => edge.id !== ignoreId && edge.source === connection.source && edge.target === connection.target);
}

/**
 * Result of dragging an end of an existing connection:
 * - dropped on a valid handle: the connection moves there (or nothing changes if it is the same place);
 * - dropped anywhere else (`connection` is null): the connection is detached, i.e. removed.
 */
export function reconnectEdge(edges: FlowEdge[], edge: FlowEdge, connection: Connection | null): { edges: FlowEdge[]; change: 'moved' | 'detached' | 'unchanged' } {
  if (!edges.some(entry => entry.id === edge.id)) return { edges, change: 'unchanged' };
  if (!connection) return { edges: edges.filter(entry => entry.id !== edge.id), change: 'detached' };
  if (connection.source === edge.source && connection.target === edge.target) return { edges, change: 'unchanged' };
  if (!isAllowedConnection(edges, connection, edge.id)) return { edges, change: 'unchanged' };
  return {
    change: 'moved',
    edges: edges.map(entry => entry.id === edge.id
      ? { ...entry, id: `${connection.source}-${connection.target}`, source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle, selected: false }
      : entry),
  };
}
