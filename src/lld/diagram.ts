import type { LldModel, RelationType } from './types';

export const BOX_W = 150; export const BOX_H = 44;
const GAP_X = 18; const GAP_Y = 54; const PAD = 14; const MAX_PER_ROW = 3;

export type DiagramBox = { id: string; x: number; y: number; w: number; h: number };
export type DiagramEdge = { from: string; to: string; type: RelationType; label?: string; x1: number; y1: number; x2: number; y2: number };
export type DiagramLayout = { width: number; height: number; boxes: DiagramBox[]; edges: DiagramEdge[] };

/**
 * Lays out a class diagram from the model's layers. Layers with more than three classes wrap onto extra
 * rows so the diagram stays readable in the inspector. Value types (`support`) are hidden unless asked for.
 */
export function layoutDiagram(model: LldModel, options: { showSupport: boolean }): DiagramLayout {
  const visible = model.classes.filter(entry => options.showSupport || !entry.support);
  const layers = [...new Set(visible.map(entry => entry.layer))].sort((a, b) => a - b);
  const rows: string[][] = [];
  for (const layer of layers) {
    const ids = visible.filter(entry => entry.layer === layer).map(entry => entry.id);
    for (let i = 0; i < ids.length; i += MAX_PER_ROW) rows.push(ids.slice(i, i + MAX_PER_ROW));
  }
  const widest = Math.max(1, ...rows.map(row => row.length));
  const width = PAD * 2 + widest * BOX_W + (widest - 1) * GAP_X;
  const boxes: DiagramBox[] = [];
  rows.forEach((row, rowIndex) => {
    const rowWidth = row.length * BOX_W + (row.length - 1) * GAP_X;
    const start = (width - rowWidth) / 2;
    row.forEach((id, column) => boxes.push({ id, x: start + column * (BOX_W + GAP_X), y: PAD + rowIndex * (BOX_H + GAP_Y), w: BOX_W, h: BOX_H }));
  });
  const height = PAD * 2 + rows.length * BOX_H + Math.max(0, rows.length - 1) * GAP_Y;
  const at = new Map(boxes.map(box => [box.id, box]));

  const edges: DiagramEdge[] = []; const pairCount = new Map<string, number>();
  for (const relation of model.relations) {
    const a = at.get(relation.from); const b = at.get(relation.to); if (!a || !b) continue;
    const pair = [relation.from, relation.to].sort().join('|'); const nth = pairCount.get(pair) ?? 0; pairCount.set(pair, nth + 1);
    const offset = nth === 0 ? 0 : (nth % 2 ? 1 : -1) * 10 * Math.ceil(nth / 2); // parallel relations are drawn side by side
    let x1: number; let y1: number; let x2: number; let y2: number;
    if (Math.abs(a.y - b.y) < 1) {
      const leftToRight = a.x < b.x;
      x1 = leftToRight ? a.x + a.w : a.x; x2 = leftToRight ? b.x : b.x + b.w; y1 = a.y + a.h / 2 + offset; y2 = b.y + b.h / 2 + offset;
    } else {
      const down = a.y < b.y;
      x1 = a.x + a.w / 2 + offset; x2 = b.x + b.w / 2 + offset; y1 = down ? a.y + a.h : a.y; y2 = down ? b.y : b.y + b.h;
    }
    edges.push({ from: relation.from, to: relation.to, type: relation.type, label: relation.label, x1, y1, x2, y2 });
  }
  return { width, height, boxes, edges };
}
