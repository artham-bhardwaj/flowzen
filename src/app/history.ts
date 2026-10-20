import type { FlowEdge, FlowNode } from './model';

/**
 * Architecture edit history (undo/redo).
 *
 * History stores snapshots of the *architecture only*: component identity, kind, name, configuration,
 * position and connections. Selection, drag-in-progress state, measured sizes, simulation results and
 * playback are deliberately excluded, so they never create entries and are never rewound.
 */
export type SnapshotNode = { id: string; kind: FlowNode['data']['kind']; label: string; config: Record<string, string>; position: { x: number; y: number }; fixture?: boolean; deletable?: boolean };
export type SnapshotEdge = { id: string; source: string; target: string };
export type ArchitectureSnapshot = { nodes: SnapshotNode[]; edges: SnapshotEdge[] };

export function snapshotOf(nodes: FlowNode[], edges: FlowEdge[]): ArchitectureSnapshot {
  return {
    nodes: nodes.map(node => ({
      id: node.id, kind: node.data.kind, label: node.data.label, config: { ...node.data.config },
      position: { x: node.position.x, y: node.position.y },
      ...(node.data.fixture ? { fixture: true } : {}), ...(node.deletable === false ? { deletable: false } : {}),
    })),
    edges: edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target })),
  };
}

/**
 * Rebuilds React Flow nodes and edges from a snapshot. Selection is kept for components that still
 * exist, so undoing a config edit does not make the inspector jump away.
 */
export function restoreSnapshot(snapshot: ArchitectureSnapshot, current: { nodes: FlowNode[]; edges: FlowEdge[] }): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const selectedNodes = new Set(current.nodes.filter(node => node.selected).map(node => node.id));
  const selectedEdges = new Set(current.edges.filter(edge => edge.selected).map(edge => edge.id));
  const ids = new Set(snapshot.nodes.map(node => node.id));
  return {
    nodes: snapshot.nodes.map(node => ({
      id: node.id, type: 'architecture', position: { ...node.position }, selected: selectedNodes.has(node.id),
      ...(node.deletable === false ? { deletable: false } : {}),
      data: { label: node.label, kind: node.kind, config: { ...node.config }, ...(node.fixture ? { fixture: true } : {}) },
    })),
    // Graph consistency: a connection is only restored when both of its components exist.
    edges: snapshot.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target))
      .map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: 'flow', selected: selectedEdges.has(edge.id) })),
  };
}

const sameConfig = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};

export function snapshotsEqual(a: ArchitectureSnapshot, b: ArchitectureSnapshot): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  for (let i = 0; i < a.nodes.length; i += 1) {
    const x = a.nodes[i]; const y = b.nodes[i];
    if (x.id !== y.id || x.kind !== y.kind || x.label !== y.label || x.position.x !== y.position.x || x.position.y !== y.position.y || !!x.fixture !== !!y.fixture || !sameConfig(x.config, y.config)) return false;
  }
  for (let i = 0; i < a.edges.length; i += 1) {
    const x = a.edges[i]; const y = b.edges[i];
    if (x.id !== y.id || x.source !== y.source || x.target !== y.target) return false;
  }
  return true;
}

/**
 * Describes the change between two snapshots. `label` is shown in Undo/Redo tooltips; `coalesce`
 * identifies continuous edits (typing into one field, renaming one component) that are merged into
 * a single history entry when they follow each other closely.
 */
export function describeChange(before: ArchitectureSnapshot, after: ArchitectureSnapshot): { label: string; coalesce?: string } {
  const prev = new Map(before.nodes.map(node => [node.id, node])); const next = new Map(after.nodes.map(node => [node.id, node]));
  const name = (node: SnapshotNode) => node.label || node.kind;
  const added = after.nodes.filter(node => !prev.has(node.id)); const removed = before.nodes.filter(node => !next.has(node.id));
  const edgeKey = (edge: SnapshotEdge) => `${edge.source}->${edge.target}`;
  const prevEdges = new Set(before.edges.map(edgeKey)); const nextEdges = new Set(after.edges.map(edgeKey));
  const addedEdges = after.edges.filter(edge => !prevEdges.has(edgeKey(edge))); const removedEdges = before.edges.filter(edge => !nextEdges.has(edgeKey(edge)));
  const label = (id: string) => { const node = next.get(id) ?? prev.get(id); return node ? name(node) : id; };

  if (added.length && !removed.length) return { label: added.length === 1 ? `Add ${name(added[0])}` : `Add ${added.length} components` };
  if (removed.length && !added.length) return { label: removed.length === 1 ? `Delete ${name(removed[0])}` : `Delete ${removed.length} components` };
  if (added.length || removed.length) return { label: 'Replace architecture' };
  if (addedEdges.length && !removedEdges.length) return { label: addedEdges.length === 1 ? `Connect ${label(addedEdges[0].source)} → ${label(addedEdges[0].target)}` : `Add ${addedEdges.length} connections` };
  if (removedEdges.length && !addedEdges.length) return { label: removedEdges.length === 1 ? `Disconnect ${label(removedEdges[0].source)} → ${label(removedEdges[0].target)}` : `Remove ${removedEdges.length} connections` };
  if (addedEdges.length || removedEdges.length) return { label: 'Change connections' };

  const changed = after.nodes.filter(node => { const old = prev.get(node.id)!; return (old.label !== node.label || !sameConfig(old.config, node.config) || old.position.x !== node.position.x || old.position.y !== node.position.y); });
  const renamed = changed.filter(node => prev.get(node.id)!.label !== node.label);
  const reconfigured = changed.filter(node => !sameConfig(prev.get(node.id)!.config, node.config));
  const moved = changed.filter(node => { const old = prev.get(node.id)!; return old.position.x !== node.position.x || old.position.y !== node.position.y; });
  if (renamed.length === 1 && reconfigured.length === 0 && moved.length === 0) return { label: `Rename ${prev.get(renamed[0].id)!.label || renamed[0].kind}`, coalesce: `rename:${renamed[0].id}` };
  if (reconfigured.length === 1 && renamed.length === 0 && moved.length === 0) {
    const node = reconfigured[0]; const old = prev.get(node.id)!;
    const keys = [...new Set([...Object.keys(old.config), ...Object.keys(node.config)])].filter(key => old.config[key] !== node.config[key]);
    return keys.length === 1 ? { label: `Edit ${name(node)} · ${keys[0]}`, coalesce: `config:${node.id}:${keys[0]}` } : { label: `Edit ${name(node)}` };
  }
  if (moved.length && !renamed.length && !reconfigured.length) return { label: moved.length === 1 ? `Move ${name(moved[0])}` : `Move ${moved.length} components` };
  return { label: 'Edit architecture' };
}

export type HistoryEntry<T> = { state: T; label: string; coalesce?: string; at: number };
export type HistoryOptions<T> = { limit?: number; coalesceMs?: number; equals?: (a: T, b: T) => boolean };
/** Default history depth: enough for a long editing session while bounding memory (snapshots are small). */
export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

/**
 * Linear undo/redo stack. `record` pushes a new state (and clears the redo branch); `undo`/`redo` move
 * through it. Pure and framework-free so it can be tested directly.
 */
export class EditHistory<T> {
  private past: HistoryEntry<T>[] = [];
  private future: HistoryEntry<T>[] = [];
  private current: HistoryEntry<T>;
  private readonly limit: number; private readonly coalesceMs: number; private readonly equals: (a: T, b: T) => boolean;

  constructor(initial: T, options: HistoryOptions<T> = {}) {
    this.current = { state: initial, label: 'Initial', at: 0 };
    this.limit = Math.max(1, options.limit ?? HISTORY_LIMIT); this.coalesceMs = options.coalesceMs ?? COALESCE_MS;
    this.equals = options.equals ?? Object.is;
  }

  get present(): T { return this.current.state; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  /** Label of the edit that Undo would revert. */
  get undoLabel(): string | null { return this.past.length ? this.current.label : null; }
  /** Label of the edit that Redo would reapply. */
  get redoLabel(): string | null { return this.future.length ? this.future[this.future.length - 1].label : null; }
  get size() { return { past: this.past.length, future: this.future.length }; }

  /**
   * Records `state` as a new edit. Returns false if it equals the present state (no entry is created).
   * Consecutive edits with the same `coalesce` key within `coalesceMs` replace the latest entry instead
   * of adding one, so typing a name is a single undo step.
   */
  record(state: T, meta: { label: string; coalesce?: string; at?: number }): boolean {
    if (this.equals(state, this.current.state)) return false;
    const at = meta.at ?? Date.now();
    const merge = meta.coalesce !== undefined && this.past.length > 0 && this.future.length === 0
      && this.current.coalesce === meta.coalesce && at - this.current.at <= this.coalesceMs;
    // A merged entry keeps the label of the edit that started the group ("Rename Orders DB").
    if (merge) {
      // Typing back to where the group started (e.g. the field's own undo) leaves nothing to undo: drop the entry.
      if (this.equals(state, this.past[this.past.length - 1].state)) { this.current = this.past.pop()!; return true; }
      this.current = { ...this.current, state, at }; return true;
    }
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.current = { state, label: meta.label, coalesce: meta.coalesce, at };
    this.future = []; // A new edit invalidates the redo branch.
    return true;
  }

  undo(): T | null {
    const previous = this.past.pop(); if (!previous) return null;
    // The undone entry keeps its own label so Redo can name it; it is no longer eligible for merging.
    this.future.push({ ...this.current, coalesce: undefined });
    this.current = { ...previous, coalesce: undefined };
    return this.current.state;
  }

  redo(): T | null {
    const next = this.future.pop(); if (!next) return null;
    this.past.push({ ...this.current, coalesce: undefined });
    this.current = next;
    return this.current.state;
  }

  /** Starts a fresh history at `state` (used when switching to a different workspace). */
  reset(state: T) { this.past = []; this.future = []; this.current = { state, label: 'Initial', at: 0 }; }
}

/**
 * Connects the canvas state to an `EditHistory` per workspace (the free design canvas and each challenge).
 *
 * The canvas calls `observe` after every state change. Changes made while any component is being dragged
 * are ignored, so a whole drag becomes one entry when it ends. Changes that are not architectural
 * (selection, measured sizes) produce equal snapshots and are ignored as well.
 */
export class ArchitectureHistory {
  private readonly histories = new Map<string, EditHistory<ArchitectureSnapshot>>();
  private workspace: string;
  private pendingLabel: string | null = null;

  constructor(workspace: string, nodes: FlowNode[], edges: FlowEdge[], private readonly options: Omit<HistoryOptions<ArchitectureSnapshot>, 'equals'> = {}) {
    this.workspace = workspace; this.histories.set(workspace, this.create(snapshotOf(nodes, edges)));
  }
  private create(state: ArchitectureSnapshot) { return new EditHistory(state, { ...this.options, equals: snapshotsEqual }); }
  get active(): EditHistory<ArchitectureSnapshot> { return this.histories.get(this.workspace)!; }
  get workspaceKey() { return this.workspace; }

  /** Names the next recorded change (for bulk actions such as "Load sample architecture"). */
  mark(label: string) { this.pendingLabel = label; }

  /** Records the current canvas state if it is an architectural change. Returns true if an entry was added or merged. */
  observe(nodes: FlowNode[], edges: FlowEdge[], at?: number): boolean {
    if (nodes.some(node => node.dragging)) return false;
    const label = this.pendingLabel; this.pendingLabel = null;
    const next = snapshotOf(nodes, edges); const history = this.active;
    if (snapshotsEqual(next, history.present)) return false;
    return history.record(next, label ? { label, at } : { ...describeChange(history.present, next), at });
  }

  undo(current: { nodes: FlowNode[]; edges: FlowEdge[] }) { const state = this.active.undo(); return state ? restoreSnapshot(state, current) : null; }
  redo(current: { nodes: FlowNode[]; edges: FlowEdge[] }) { const state = this.active.redo(); return state ? restoreSnapshot(state, current) : null; }

  /**
   * Switches to another workspace's history. An existing history is kept only if its present state still
   * matches what is being loaded (e.g. a restored draft); otherwise that workspace starts fresh.
   */
  switchTo(workspace: string, nodes: FlowNode[], edges: FlowEdge[]) {
    const state = snapshotOf(nodes, edges); const existing = this.histories.get(workspace);
    this.workspace = workspace; this.pendingLabel = null;
    if (!existing || !snapshotsEqual(existing.present, state)) this.histories.set(workspace, this.create(state));
  }
}

export type ShortcutEvent = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
/** Maps a keyboard event to an undo/redo command: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. */
export function historyShortcut(event: ShortcutEvent, platform: 'mac' | 'other' = 'other'): 'undo' | 'redo' | null {
  if (event.altKey) return null;
  const mod = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (!mod) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  // Ctrl+Y is the Windows/Linux redo convention; on macOS Cmd+Y opens history in many apps, so it is not used.
  if (key === 'y' && platform === 'other' && !event.shiftKey) return 'redo';
  return null;
}

export type TargetLike = { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown } | null | undefined;
/**
 * True when the event target accepts text editing, so the browser's own undo must handle the keystroke.
 * Covers inputs, textareas, selects, contenteditable regions, and anything marked `data-native-undo`
 * (for example a code viewer that might gain editing later).
 */
export function isEditableTarget(target: TargetLike): boolean {
  if (!target) return false;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.('[contenteditable=""], [contenteditable="true"], [data-native-undo]'));
}

export const isMacPlatform = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
