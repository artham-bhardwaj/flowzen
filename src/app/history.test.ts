import { describe, expect, it } from 'vitest';
import { addEdge, applyEdgeChanges, applyNodeChanges, type NodeChange } from '@xyflow/react';
import { ArchitectureHistory, EditHistory, describeChange, historyShortcut, isEditableTarget, restoreSnapshot, snapshotOf } from './history';
import { place, sampleEdges, sampleNodes, type FlowEdge, type FlowNode } from './model';
import { starterArchitecture } from '../challenges/starter';
import { challengeById } from '../challenges/definitions';

/** A tiny stand-in for the canvas: holds state and lets the history observe each change, as App does. */
function canvas(initial = { nodes: sampleNodes(), edges: sampleEdges() }) {
  let nodes: FlowNode[] = initial.nodes; let edges: FlowEdge[] = initial.edges; let clock = 0;
  const history = new ArchitectureHistory('design', nodes, edges);
  const observe = (advance = 5000) => { clock += advance; history.observe(nodes, edges, clock); };
  return {
    history,
    get nodes() { return nodes; }, get edges() { return edges; },
    setNodes(update: (current: FlowNode[]) => FlowNode[], advance?: number) { nodes = update(nodes); observe(advance); },
    setEdges(update: (current: FlowEdge[]) => FlowEdge[], advance?: number) { edges = update(edges); observe(advance); },
    set(next: { nodes: FlowNode[]; edges: FlowEdge[] }) { nodes = next.nodes; edges = next.edges; observe(); },
    nodeChanges(changes: NodeChange<FlowNode>[], advance?: number) { nodes = applyNodeChanges(changes, nodes); observe(advance); },
    undo() { const next = history.undo({ nodes, edges }); if (next) this.set(next); return next !== null; },
    redo() { const next = history.redo({ nodes, edges }); if (next) this.set(next); return next !== null; },
  };
}
const node = (c: ReturnType<typeof canvas>, id: string) => c.nodes.find(entry => entry.id === id);

describe('EditHistory', () => {
  it('undoes and redoes in order and reports availability', () => {
    const history = new EditHistory(0);
    expect(history.canUndo).toBe(false); expect(history.canRedo).toBe(false);
    history.record(1, { label: 'one', at: 0 }); history.record(2, { label: 'two', at: 5000 });
    expect(history.undoLabel).toBe('two');
    expect(history.undo()).toBe(1); expect(history.redoLabel).toBe('two');
    expect(history.undo()).toBe(0); expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(1); expect(history.redo()).toBe(2); expect(history.redo()).toBeNull();
  });

  it('clears the redo branch when a new edit follows an undo', () => {
    const history = new EditHistory('a');
    history.record('b', { label: 'b', at: 0 }); history.record('c', { label: 'c', at: 5000 });
    history.undo(); expect(history.canRedo).toBe(true);
    history.record('d', { label: 'd', at: 10000 });
    expect(history.canRedo).toBe(false); expect(history.redo()).toBeNull();
    expect(history.undo()).toBe('b'); expect(history.undo()).toBe('a');
  });

  it('does not record a state equal to the present', () => {
    const history = new EditHistory('a');
    expect(history.record('a', { label: 'same' })).toBe(false); expect(history.canUndo).toBe(false);
  });

  it('merges coalescible edits only within the time window and only for the same key', () => {
    const history = new EditHistory('');
    history.record('C', { label: 'type', coalesce: 'name', at: 0 });
    history.record('Ca', { label: 'type', coalesce: 'name', at: 300 });
    history.record('Cac', { label: 'type', coalesce: 'name', at: 600 });
    expect(history.size.past).toBe(1);
    history.record('Cach', { label: 'type', coalesce: 'name', at: 3000 }); // pause → new entry
    expect(history.size.past).toBe(2);
    history.record('Cache', { label: 'other', coalesce: 'other', at: 3100 }); // different field → new entry
    expect(history.size.past).toBe(3);
    expect(history.undo()).toBe('Cach'); expect(history.undo()).toBe('Cac'); expect(history.undo()).toBe('');
  });

  it('drops a coalesced entry that returns to the state before the group (no no-op undo steps)', () => {
    const history = new EditHistory('Orders DB');
    history.record('Primary', { label: 'Rename', coalesce: 'name', at: 0 });
    history.record('Orders DB', { label: 'Rename', coalesce: 'name', at: 200 }); // e.g. the text field's own undo
    expect(history.canUndo).toBe(false); expect(history.present).toBe('Orders DB');
  });

  it('never merges into an entry that was reached by undo', () => {
    const history = new EditHistory('');
    history.record('a', { label: 'x', coalesce: 'k', at: 0 }); history.record('ab', { label: 'x', coalesce: 'k', at: 5000 });
    history.undo();
    history.record('az', { label: 'x', coalesce: 'k', at: 5100 });
    expect(history.undo()).toBe('a');
  });

  it('bounds memory with a history limit, dropping the oldest entries', () => {
    const history = new EditHistory(0, { limit: 3 });
    for (let i = 1; i <= 10; i += 1) history.record(i, { label: String(i), at: i * 5000 });
    expect(history.size.past).toBe(3);
    expect([history.undo(), history.undo(), history.undo(), history.undo()]).toEqual([9, 8, 7, null]);
  });
});

describe('architecture undo/redo', () => {
  it('undoes and redoes adding a component', () => {
    const c = canvas();
    c.setNodes(current => [...current, place('extra', 'cache', 'Extra Cache', 10, 10)]);
    expect(c.history.active.undoLabel).toBe('Add Extra Cache');
    c.undo(); expect(node(c, 'extra')).toBeUndefined();
    c.redo(); expect(node(c, 'extra')?.data.label).toBe('Extra Cache');
  });

  it('restores a deleted component together with its connections and configuration', () => {
    const c = canvas();
    c.setNodes(current => current.map(entry => entry.id === 'cache' ? { ...entry, data: { ...entry.data, config: { ...entry.data.config, hitRatio: '95' } } } : entry));
    // Deleting through React Flow removes the node; App removes its edges in the same batch.
    c.set({ nodes: applyNodeChanges([{ type: 'remove', id: 'cache' }], c.nodes), edges: c.edges.filter(edge => edge.source !== 'cache' && edge.target !== 'cache') });
    expect(c.history.active.undoLabel).toBe('Delete Session Cache');
    c.undo();
    expect(node(c, 'cache')?.data.config.hitRatio).toBe('95');
    expect(c.edges.map(edge => edge.id).sort()).toEqual(sampleEdges().map(edge => edge.id).sort());
    c.redo(); expect(node(c, 'cache')).toBeUndefined(); expect(c.edges.some(edge => edge.target === 'cache')).toBe(false);
  });

  it('groups a continuous drag into one entry', () => {
    const c = canvas(); const start = { ...node(c, 'lb')!.position };
    for (let step = 1; step <= 30; step += 1) c.nodeChanges([{ type: 'position', id: 'lb', position: { x: start.x + step * 4, y: start.y + step }, dragging: true }], 16);
    expect(c.history.active.canUndo).toBe(false);
    c.nodeChanges([{ type: 'position', id: 'lb', position: { x: start.x + 120, y: start.y + 30 }, dragging: false }], 16);
    expect(c.history.active.size.past).toBe(1); expect(c.history.active.undoLabel).toBe('Move Load Balancer');
    c.undo(); expect(node(c, 'lb')!.position).toEqual(start);
    c.redo(); expect(node(c, 'lb')!.position).toEqual({ x: start.x + 120, y: start.y + 30 });
  });

  it('groups a multi-component drag into one entry', () => {
    const c = canvas();
    c.nodeChanges([{ type: 'position', id: 'lb', position: { x: 1, y: 1 }, dragging: true }, { type: 'position', id: 'db', position: { x: 2, y: 2 }, dragging: true }], 16);
    c.nodeChanges([{ type: 'position', id: 'lb', position: { x: 5, y: 5 }, dragging: false }, { type: 'position', id: 'db', position: { x: 6, y: 6 }, dragging: false }], 16);
    expect(c.history.active.size.past).toBe(1); expect(c.history.active.undoLabel).toBe('Move 2 components');
  });

  it('undoes and redoes connection creation and deletion', () => {
    const c = canvas();
    c.setEdges(current => addEdge({ source: 'events', target: 'lb', sourceHandle: null, targetHandle: null, type: 'flow' }, current));
    expect(c.history.active.undoLabel).toBe('Connect Order Events → Load Balancer');
    c.setEdges(current => applyEdgeChanges([{ type: 'remove', id: 'cache-db' }], current));
    expect(c.history.active.undoLabel).toBe('Disconnect Session Cache → Orders DB');
    c.undo(); expect(c.edges.some(edge => edge.id === 'cache-db')).toBe(true);
    c.undo(); expect(c.edges.some(edge => edge.source === 'events' && edge.target === 'lb')).toBe(false);
    c.redo(); c.redo(); expect(c.edges.some(edge => edge.id === 'cache-db')).toBe(false);
  });

  it('treats typing into a configuration field as one step', () => {
    const c = canvas();
    for (const value of ['1', '12', '120']) c.setNodes(current => current.map(entry => entry.id === 'db' ? { ...entry, data: { ...entry.data, config: { ...entry.data.config, queryLatencyMs: value } } } : entry), 200);
    expect(c.history.active.size.past).toBe(1); expect(c.history.active.undoLabel).toBe('Edit Orders DB · queryLatencyMs');
    c.undo(); expect(node(c, 'db')!.data.config.queryLatencyMs).toBe(sampleNodes().find(entry => entry.id === 'db')!.data.config.queryLatencyMs);
  });

  it('treats renaming as one step and restores the old name', () => {
    const c = canvas();
    for (const label of ['P', 'Pr', 'Primary DB']) c.setNodes(current => current.map(entry => entry.id === 'db' ? { ...entry, data: { ...entry.data, label } } : entry), 150);
    expect(c.history.active.size.past).toBe(1); expect(c.history.active.undoLabel).toBe('Rename Orders DB');
    c.undo(); expect(node(c, 'db')!.data.label).toBe('Orders DB');
    c.redo(); expect(node(c, 'db')!.data.label).toBe('Primary DB');
  });

  it('ignores selection, measured sizes and other transient UI state', () => {
    const c = canvas();
    c.nodeChanges([{ type: 'select', id: 'lb', selected: true }]);
    c.nodeChanges([{ type: 'dimensions', id: 'lb', dimensions: { width: 228, height: 80 } }]);
    c.setEdges(current => current.map(edge => ({ ...edge, selected: edge.id === 'lb-app-a' })));
    expect(c.history.active.canUndo).toBe(false);
  });

  it('keeps the selection of components that still exist after undo', () => {
    const c = canvas();
    c.setNodes(current => current.map(entry => entry.id === 'db' ? { ...entry, data: { ...entry.data, label: 'X' } } : entry));
    c.nodeChanges([{ type: 'select', id: 'db', selected: true }]);
    c.undo(); expect(node(c, 'db')!.selected).toBe(true);
  });

  it('labels bulk actions and makes them undoable', () => {
    const c = canvas();
    c.history.mark('Clear canvas'); c.set({ nodes: [], edges: [] });
    expect(c.history.active.undoLabel).toBe('Clear canvas');
    c.undo(); expect(c.nodes).toHaveLength(sampleNodes().length); expect(c.edges).toHaveLength(sampleEdges().length);
  });

  it('keeps a separate history per workspace and preserves locks on given systems', () => {
    const challenge = challengeById('cache-it-right')!; const c = canvas();
    c.setNodes(current => current.filter(entry => entry.id !== 'events'));
    const starter = starterArchitecture(challenge);
    c.history.switchTo('challenge:cache-it-right', starter.nodes, starter.edges); c.set(starter);
    expect(c.history.active.canUndo).toBe(false);
    c.setNodes(current => current.map(entry => entry.id === 'api' ? { ...entry, data: { ...entry.data, label: 'Renamed' } } : entry));
    c.undo();
    const db = node(c, 'orders-db')!;
    expect(db.data.fixture).toBe(true); expect(db.deletable).toBe(false); expect(db.data.config.concurrency).toBe('8');
    // Back on the design canvas, the earlier design edit can still be undone.
    const design = { nodes: sampleNodes().filter(entry => entry.id !== 'events'), edges: sampleEdges() };
    c.history.switchTo('design', design.nodes, design.edges);
    expect(c.history.active.undoLabel).toBe('Delete Order Events');
  });

  it('keeps each challenge’s history independent when switching between challenges', () => {
    const a = starterArchitecture(challengeById('slow-api')!); const b = starterArchitecture(challengeById('cache-it-right')!);
    const c = canvas();
    c.history.switchTo('challenge:slow-api', a.nodes, a.edges); c.set(a);
    c.setNodes(current => current.map(entry => entry.id === 'api' ? { ...entry, data: { ...entry.data, config: { ...entry.data.config, instances: '9' } } } : entry));
    const aEdited = { nodes: c.nodes, edges: c.edges };
    c.history.switchTo('challenge:cache-it-right', b.nodes, b.edges); c.set(b);
    expect(c.history.active.canUndo).toBe(false);
    c.setNodes(current => current.map(entry => entry.id === 'api' ? { ...entry, data: { ...entry.data, label: 'Renamed' } } : entry));
    expect(c.history.active.undoLabel).toBe('Rename Orders API');
    // Back to the first challenge with its saved draft: its own entry is still there; the second challenge's is not.
    c.history.switchTo('challenge:slow-api', aEdited.nodes, aEdited.edges); c.set(aEdited);
    expect(c.history.active.undoLabel).toBe('Edit Profile API · instances');
    c.undo(); expect(node(c, 'api')!.data.config.instances).toBe('2');
    // A draft that no longer matches (e.g. edited elsewhere) starts that challenge's history fresh instead of mixing states.
    c.history.switchTo('challenge:cache-it-right', b.nodes, b.edges);
    expect(c.history.active.canUndo).toBe(false);
  });

  it('drops connections whose components are missing when restoring', () => {
    const snapshot = snapshotOf([place('a', 'client', 'A', 0, 0)], [{ id: 'a-b', source: 'a', target: 'b' }]);
    expect(restoreSnapshot(snapshot, { nodes: [], edges: [] }).edges).toEqual([]);
  });

  it('describes mixed changes conservatively', () => {
    const before = snapshotOf(sampleNodes(), sampleEdges());
    const after = snapshotOf(sampleNodes().map(entry => entry.id === 'db' ? { ...entry, position: { x: 0, y: 0 }, data: { ...entry.data, label: 'Y' } } : entry), sampleEdges());
    expect(describeChange(before, after)).toEqual({ label: 'Edit architecture' });
  });
});

describe('undo/redo keyboard shortcuts', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  it('maps Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y', () => {
    expect(historyShortcut(key('z', { ctrlKey: true }))).toBe('undo');
    expect(historyShortcut(key('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(historyShortcut(key('y', { ctrlKey: true }))).toBe('redo');
    expect(historyShortcut(key('z', { metaKey: true }), 'mac')).toBe('undo');
    expect(historyShortcut(key('z', { metaKey: true, shiftKey: true }), 'mac')).toBe('redo');
  });
  it('ignores unrelated combinations', () => {
    expect(historyShortcut(key('z'))).toBeNull();
    expect(historyShortcut(key('z', { metaKey: true }))).toBeNull(); // Cmd only counts on macOS
    expect(historyShortcut(key('z', { ctrlKey: true }), 'mac')).toBeNull();
    expect(historyShortcut(key('y', { metaKey: true }), 'mac')).toBeNull();
    expect(historyShortcut(key('z', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(historyShortcut(key('x', { ctrlKey: true }))).toBeNull();
  });
  it('leaves editable fields to the browser’s own undo', () => {
    const element = (tagName: string, extra: Partial<{ isContentEditable: boolean; closest: (selector: string) => unknown }> = {}) => ({ tagName, closest: () => null, ...extra });
    expect(isEditableTarget(element('INPUT'))).toBe(true);
    expect(isEditableTarget(element('textarea'))).toBe(true);
    expect(isEditableTarget(element('SELECT'))).toBe(true);
    expect(isEditableTarget(element('DIV', { isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(element('SPAN', { closest: selector => selector.includes('data-native-undo') ? {} : null }))).toBe(true);
    expect(isEditableTarget(element('BUTTON'))).toBe(false);
    expect(isEditableTarget(element('DIV'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
