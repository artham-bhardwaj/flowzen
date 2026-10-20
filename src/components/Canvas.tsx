import { useCallback, useRef, type DragEvent } from 'react';
import {
  Background, BackgroundVariant, MarkerType, MiniMap, ReactFlow, useReactFlow,
  type Connection, type OnEdgesChange, type OnNodesChange, type OnSelectionChangeFunc,
} from '@xyflow/react';
import { Boxes, Eraser, History, LayoutGrid, Map as MapIcon, Maximize, Minus, Plus, RotateCcw, ScanSearch } from 'lucide-react';
import { useValidation } from '../app/validationContext';
import { StatusIcon, statusLabels } from './status';
import type { Kind } from '../app/catalog';
import { isAllowedConnection } from '../app/edges';
import { NODE_WIDTH, type FlowEdge as FlowEdgeType, type FlowNode, type ViewMode } from '../app/model';
import type { Theme } from '../app/theme';
import { ArchitectureNode, stateDescriptions, stateLabels } from './ArchitectureNode';
import { FlowEdge, MAX_PARTICLES } from './FlowEdge';
import type { OperationalState } from '../simulation/playback';

export const DRAG_TYPE = 'application/x-flowzen-kind';
/** Pointer travel (px) before dropping an arrow's end counts as a drag that detaches it. */
const DETACH_DISTANCE = 8;
const nodeTypes = { architecture: ArchitectureNode };
const edgeTypes = { flow: FlowEdge };
const defaultEdgeOptions = { type: 'flow', markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--edge-marker)' } };
const states: OperationalState[] = ['idle', 'processing', 'near-capacity', 'queued', 'saturated', 'failed'];

type Props = {
  nodes: FlowNode[]; edges: FlowEdgeType[]; theme: Theme; view: ViewMode; hasResult: boolean; stale: boolean; minimap: boolean;
  onNodesChange: OnNodesChange<FlowNode>; onEdgesChange: OnEdgesChange; onConnect: (connection: Connection) => void;
  onSelectionChange: OnSelectionChangeFunc; onDropKind: (kind: Kind, position: { x: number; y: number }) => void;
  onLoadSample: () => void; onClear: () => void; onRun: () => void; onToggleMinimap: () => void;
  showIssues: boolean; onToggleIssues: () => void;
  challengeMode: boolean; onRestoreStarter: () => void;
  /** Dragging an end of an existing connection: a handle to move it to, or null when dropped elsewhere (detach). */
  onReconnectEdge: (edge: FlowEdgeType, connection: Connection | null) => void;
  /** Selects a connection (used when its end anchor was clicked rather than dragged). */
  onSelectEdge: (id: string) => void;
};

export function Canvas(props: Props) {
  const { nodes, edges, theme, view, hasResult, stale, minimap } = props;
  const flow = useReactFlow(); const { validation } = useValidation();
  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault(); const kind = event.dataTransfer.getData(DRAG_TYPE) as Kind; if (!kind) return;
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    props.onDropKind(kind, { x: point.x - NODE_WIDTH / 2, y: point.y - 34 });
  }, [flow, props]);
  // While an existing connection is dragged, it does not count as a duplicate of itself.
  const reconnecting = useRef<string | null>(null); const landed = useRef(false); const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const isValidConnection = useCallback((connection: Connection | FlowEdgeType) => isAllowedConnection(edges, connection, reconnecting.current), [edges]);
  const { onReconnectEdge, onSelectEdge } = props;
  const onReconnectStart = useCallback((event: { clientX: number; clientY: number }, edge: FlowEdgeType) => { reconnecting.current = edge.id; landed.current = false; pressedAt.current = { x: event.clientX, y: event.clientY }; }, []);
  const onReconnect = useCallback((edge: FlowEdgeType, connection: Connection) => { landed.current = true; onReconnectEdge(edge, connection); }, [onReconnectEdge]);
  const onReconnectEnd = useCallback((event: MouseEvent | TouchEvent, edge: FlowEdgeType) => {
    // React Flow calls onReconnect first when the end lands on a valid handle. Otherwise the connection is detached,
    // but only after a real drag: a click on an arrow's end (short arrows are mostly end anchor) must never delete it.
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    const start = pressedAt.current;
    const dragged = start !== null && point !== undefined && Math.hypot(point.clientX - start.x, point.clientY - start.y) > DETACH_DISTANCE;
    if (!landed.current && dragged) onReconnectEdge(edge, null);
    else if (!landed.current) onSelectEdge(edge.id);
    reconnecting.current = null; landed.current = false; pressedAt.current = null;
  }, [onReconnectEdge, onSelectEdge]);

  return <section className={`fz-canvas${props.showIssues ? ' is-showing-issues' : ''}`} aria-label="Architecture canvas">
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={props.onNodesChange} onEdgesChange={props.onEdgesChange} onConnect={props.onConnect} onSelectionChange={props.onSelectionChange}
      isValidConnection={isValidConnection} onReconnectStart={onReconnectStart} onReconnect={onReconnect} onReconnectEnd={onReconnectEnd} reconnectRadius={10} elevateEdgesOnSelect
      onDrop={onDrop} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
      colorMode={theme} deleteKeyCode={['Backspace', 'Delete']} fitView fitViewOptions={{ padding: 0.18, maxZoom: 1 }} minZoom={0.2} maxZoom={2}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      {minimap && <MiniMap pannable zoomable ariaLabel="Canvas overview" nodeBorderRadius={6} />}
    </ReactFlow>

    <div className="fz-canvas__head">
      <div className="fz-canvas__title"><b>Architecture</b><span>{view} · {nodes.length} components · {edges.length} connections</span></div>
      {nodes.length > 0 && <div className="fz-vsummary" role="group" aria-label="Validation summary">
        {(['functional', 'warning', 'dead'] as const).map(status => <span key={status} className={`status-${status}${validation.counts[status] ? '' : ' is-zero'}`} title={`${validation.counts[status]} ${statusLabels[status].toLowerCase()}`}><StatusIcon status={status} size={13} /><b>{validation.counts[status]}</b><span className="fz-visually-hidden">{statusLabels[status]}</span></span>)}
        <button className={`fz-btn fz-btn--small${props.showIssues ? ' is-on' : ''}`} aria-pressed={props.showIssues} onClick={props.onToggleIssues} disabled={!validation.issues.length && !props.showIssues}>
          <ScanSearch size={13} />{props.showIssues ? 'Hide issues' : `Show issues${validation.issues.length ? ` (${validation.issues.length})` : ''}`}
        </button>
      </div>}
    </div>
    <div className="fz-canvas__tools" role="toolbar" aria-label="Canvas view">
      <button className="fz-icon-btn" onClick={() => flow.zoomIn({ duration: 160 })} aria-label="Zoom in" title="Zoom in"><Plus size={15} /></button>
      <button className="fz-icon-btn" onClick={() => flow.zoomOut({ duration: 160 })} aria-label="Zoom out" title="Zoom out"><Minus size={15} /></button>
      <button className="fz-icon-btn" onClick={() => flow.fitView({ padding: 0.18, duration: 220 })} aria-label="Fit architecture to view" title="Fit to view"><Maximize size={14} /></button>
      <span className="fz-sep" />
      {props.challengeMode
        ? <button className="fz-icon-btn" onClick={props.onRestoreStarter} aria-label="Restore starter architecture" title="Restore starter architecture"><History size={14} /></button>
        : <>
          <button className="fz-icon-btn" onClick={props.onLoadSample} aria-label="Load sample architecture" title="Load sample architecture"><Boxes size={14} /></button>
          <button className="fz-icon-btn" onClick={props.onClear} disabled={!nodes.length} aria-label="Clear canvas" title="Clear canvas"><Eraser size={14} /></button>
        </>}
      <span className="fz-sep" />
      <button className={`fz-icon-btn${minimap ? ' is-on' : ''}`} onClick={props.onToggleMinimap} aria-pressed={minimap} aria-label="Toggle overview map" title="Overview map"><MapIcon size={14} /></button>
    </div>

    {stale && hasResult && <div className="fz-banner" role="status">
      <span>Architecture or traffic changed since the last run. Results show the previous configuration.</span>
      <button className="fz-btn fz-btn--small fz-btn--primary" onClick={props.onRun}><RotateCcw size={13} /> Run again</button>
    </div>}

    {hasResult && <details className="fz-legend">
      <summary>Legend</summary>
      <div className="fz-legend__grid">
        <span className="fz-legend__h">In transit</span>
        <span><i className="lg-dot kind-request" />Request</span>
        <span><i className="lg-dot kind-miss" />After cache miss</span>
        <span><i className="lg-dot kind-job" />Queue job</span>
        <span><i className="lg-dot is-pinned" />Selected request</span>
        <span className="fz-legend__h">Outcome at component</span>
        <span><i className="lg-ring outcome-success" />Succeeded</span>
        <span><i className="lg-ring outcome-hit" />Cache hit</span>
        <span><i className="lg-ring outcome-failed" />Rejected / unroutable</span>
        <span><i className="lg-ring outcome-timeout" />Timed out</span>
        <span className="fz-legend__h">Component state</span>
        {states.map(state => <span key={state} title={stateDescriptions[state]}><i className={`lg-state state-${state}`} />{stateLabels[state]}</span>)}
      </div>
      <p>Transitions are instantaneous in the engine; each particle travels in a short visual window ending at its recorded arrival. Busy connections show up to {MAX_PARTICLES} evenly sampled particles.</p>
    </details>}

    {!nodes.length && <div className="fz-canvas__empty">
      <LayoutGrid size={22} aria-hidden />
      <b>Start with a component</b>
      <span>Drag from the library or click a component to add it. Connect the right handle of one component to the left handle of another to define the request path.</span>
      {props.challengeMode ? <button className="fz-btn" onClick={props.onRestoreStarter}><History size={13} /> Restore starter architecture</button> : <button className="fz-btn" onClick={props.onLoadSample}><Boxes size={13} /> Load sample architecture</button>}
    </div>}
  </section>;
}
