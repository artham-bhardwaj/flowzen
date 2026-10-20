import type { Kind } from '../../app/catalog';
import type { Block, Diagram } from '../types';

/** Small constructors that keep lesson files readable as data. */
export const p = (text: string): Block => ({ type: 'p', text });
export const list = (items: string[], ordered = false): Block => ({ type: 'list', items, ordered });
export const table = (caption: string, columns: string[], rows: string[][]): Block => ({ type: 'table', caption, columns, rows });
export const note = (title: string, text: string): Block => ({ type: 'callout', tone: 'note', title, text });
export const warn = (title: string, text: string): Block => ({ type: 'callout', tone: 'warn', title, text });
/** States what the simulator does or does not model for this topic. */
export const sim = (title: string, text: string): Block => ({ type: 'callout', tone: 'sim', title, text });
export const formula = (expression: string, explanation: string): Block => ({ type: 'formula', expression, explanation });
export const example = (title: string, blocks: Block[]): Block => ({ type: 'example', title, blocks });
export const figure = (diagram: Diagram): Block => ({ type: 'diagram', diagram });

type NodeSpec = [id: string, label: string, col: number, row: number, kind?: Kind, note?: string];
type EdgeSpec = [from: string, to: string, label?: string, dashed?: boolean];
export const diagram = (id: string, title: string, caption: string, nodes: NodeSpec[], edges: EdgeSpec[]): Diagram => ({
  id, title, caption,
  nodes: nodes.map(([nodeId, label, col, row, kind, nodeNote]) => ({ id: nodeId, label, col, row, ...(kind ? { kind } : {}), ...(nodeNote ? { note: nodeNote } : {}) })),
  edges: edges.map(([from, to, label, dashed]) => ({ from, to, ...(label ? { label } : {}), ...(dashed ? { dashed } : {}) })),
});
