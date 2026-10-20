import { useCallback, useEffect, useReducer, useRef, type Dispatch, type SetStateAction } from 'react';
import { ArchitectureHistory } from './history';
import type { FlowEdge, FlowNode } from './model';

export type HistoryControls = {
  canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null;
  undo: () => void; redo: () => void;
  /** Names the next recorded change, e.g. "Load sample architecture". */
  mark: (label: string) => void;
  /** Switches to another workspace's history (design canvas or a challenge) before loading its architecture. */
  switchTo: (workspace: string, next: { nodes: FlowNode[]; edges: FlowEdge[] }) => void;
};

/**
 * Observes the canvas state and records architectural changes in an `ArchitectureHistory`.
 * Every edit path (React Flow changes, inspector edits, fixes, bulk actions) goes through the same
 * observer, so no edit needs its own history hook.
 */
export function useArchitectureHistory(nodes: FlowNode[], edges: FlowEdge[], setNodes: Dispatch<SetStateAction<FlowNode[]>>, setEdges: Dispatch<SetStateAction<FlowEdge[]>>): HistoryControls {
  const ref = useRef<ArchitectureHistory | null>(null);
  if (!ref.current) ref.current = new ArchitectureHistory('design', nodes, edges);
  const history = ref.current;
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const latest = useRef({ nodes, edges }); latest.current = { nodes, edges };

  useEffect(() => { if (history.observe(nodes, edges)) rerender(); }, [history, nodes, edges]);

  const step = useCallback((direction: 'undo' | 'redo') => {
    // Never rewind in the middle of a drag; the drag becomes an entry when it ends.
    if (latest.current.nodes.some(node => node.dragging)) return;
    const next = direction === 'undo' ? history.undo(latest.current) : history.redo(latest.current);
    if (!next) return;
    setNodes(next.nodes); setEdges(next.edges); rerender();
  }, [history, setEdges, setNodes]);
  const undo = useCallback(() => step('undo'), [step]);
  const redo = useCallback(() => step('redo'), [step]);
  const mark = useCallback((label: string) => history.mark(label), [history]);
  const switchTo = useCallback((workspace: string, next: { nodes: FlowNode[]; edges: FlowEdge[] }) => { history.switchTo(workspace, next.nodes, next.edges); rerender(); }, [history]);

  const active = history.active;
  return { canUndo: active.canUndo, canRedo: active.canRedo, undoLabel: active.undoLabel, redoLabel: active.redoLabel, undo, redo, mark, switchTo };
}
