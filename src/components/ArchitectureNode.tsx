import { memo, useLayoutEffect, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { byKind, categories, limitsSummary, specSummary } from '../app/catalog';
import type { FlowNode } from '../app/model';
import { usePlayback, usePlaybackSelector } from '../app/playback';
import { componentLive, type ComponentLive, type OperationalState } from '../simulation/playback';
import { CACHE_KINDS, MESSAGING_KINDS } from '../simulation/engine';
import { useValidation } from '../app/validationContext';
import { StatusIcon, statusLabels } from './status';
import { LLD_COVERAGE } from '../lld/coverage';
import { NODE_WIDTH } from '../app/model';
import { SHAPE_NAMES, ShapeSvg, shapeGeometry } from './shapes';

/** The node's measured height, so its outline is drawn at its true size. */
function useHeight() {
  const ref = useRef<HTMLDivElement>(null); const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    setHeight(element.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight)); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, height };
}

export const stateLabels: Record<OperationalState, string> = {
  idle: 'Idle', processing: 'Processing', queued: 'Queued', 'near-capacity': 'Near capacity', saturated: 'Saturated', failed: 'Failing',
};
export const stateDescriptions: Record<OperationalState, string> = {
  idle: 'No requests in progress at the playhead.',
  processing: 'Requests in progress with free slots.',
  queued: 'All slots busy and requests waiting.',
  'near-capacity': 'At least 80% of slots busy, nothing waiting.',
  saturated: 'Backlog at or above 10% of the queue limit.',
  failed: 'A request was rejected, timed out or unroutable here in the last moment of playback.',
};

const liveKey = (live: ComponentLive | null) => live ? `${live.state}|${live.active}|${live.queued}|${live.succeeded}|${live.failed}|${live.timedOut}|${live.hits}|${live.misses}|${live.jobs}|${live.sent}` : '-';
const n = (value: number) => value.toLocaleString();

function LiveLine({ kind, live }: { kind: FlowNode['data']['kind']; live: ComponentLive }) {
  if (kind === 'deadLetterQueue') return <span className="fz-node__live"><b>{n(live.jobs)}</b> dead-lettered</span>;
  if (kind === 'client') return <span className="fz-node__live"><b>{n(live.sent)}</b> sent{live.failed > 0 && <em className="is-bad"> · {n(live.failed)} unrouted</em>}</span>;
  return <span className="fz-node__live">
    <span title="Busy slots / capacity at the playhead"><b>{live.active}</b>/{live.capacity}</span>
    <span title="Requests waiting at the playhead"><b>{n(live.queued)}</b> waiting</span>
    {CACHE_KINDS.has(kind) ? <span title={`${n(live.hits)} hits · ${n(live.misses)} misses so far`}>{live.hits + live.misses ? <><b>{Math.round(live.hits / (live.hits + live.misses) * 100)}%</b> hit</> : 'no lookups'}</span>
      : MESSAGING_KINDS.has(kind) ? <span title="Jobs dispatched so far">{n(live.jobs)} jobs</span>
        : <span title="Succeeded / failed / timed out here so far">{live.succeeded > 0 && <>{n(live.succeeded)}<i className="is-ok">✓</i> </>}{live.failed > 0 && <>{n(live.failed)}<i className="is-bad">✕</i> </>}{live.timedOut > 0 && <>{n(live.timedOut)}<i className="is-warn">⏱</i></>}</span>}
  </span>;
}

function ArchitectureNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const item = byKind[data.kind]; const Icon = item.icon;
  const { index, view, failureWindowMs } = usePlayback();
  const live = usePlaybackSelector(time => componentLive(index, id, time, failureWindowMs), liveKey);
  const state = live?.state ?? 'idle';
  const fill = live && data.kind !== 'client' ? Math.min(1, live.active / Math.max(1, live.capacity)) : 0;
  const { validation, showIssues } = useValidation(); const check = validation.components[id];
  const vstatus = check?.status ?? 'functional';
  const checkTitle = check ? `${statusLabels[vstatus]}${check.simulated ? '' : ' · Not simulated'}\n${check.issues.length ? check.issues.map(issue => `• ${issue.message}`).join('\n') : check.summary}` : '';
  const highlight = showIssues ? (vstatus === 'functional' ? ' is-dimmed' : ' is-flagged') : '';
  const { ref, height } = useHeight();
  // Padding comes from the shape at a reference size, so it never depends on (and never feeds back into) measurement.
  const [pt, pr, pb, pl] = shapeGeometry(data.kind, NODE_WIDTH, 96).pad;
  return <div ref={ref} style={{ padding: `${pt}px ${pr}px ${pb}px ${pl}px` }} title={`${item.label}: drawn as ${SHAPE_NAMES[data.kind]}`} className={`fz-node cat-${item.category} state-${state} vstatus-${vstatus}${selected ? ' is-selected' : ''}${live ? ' has-live' : ''}${item.simulated ? '' : ' is-visual'}${highlight}`}
    aria-label={`${data.label}, ${item.label}, ${statusLabels[vstatus]}${item.simulated ? '' : ', not simulated'}${live ? `, ${stateLabels[state]}` : ''}`}>
    <ShapeSvg kind={data.kind} width={NODE_WIDTH} height={height} className="fz-node__shape" />
    <span className={`fz-node__vstatus status-${vstatus}`} title={checkTitle}>{vstatus !== 'functional' && <StatusIcon status={vstatus} size={11} />}</span>
    <Handle type="target" position={Position.Left} className="fz-handle" />
    <div className="fz-node__head">
      <span className="fz-node__icon"><Icon size={16} strokeWidth={1.8} aria-hidden /></span>
      <span className="fz-node__titles">
        <span className="fz-node__name" title={data.label}>{data.label}</span>
        <span className="fz-node__cat">{categories[item.category].short} · {live ? <span className="fz-node__state" title={stateDescriptions[state]}>{stateLabels[state]}</span> : item.label}</span>
      </span>
      {live && <span className="fz-node__dot" title={`${stateLabels[state]}: ${stateDescriptions[state]}`} aria-hidden />}
    </div>
    {view !== 'HLD' && <div className="fz-node__body">
      {!item.simulated && <span className="fz-node__spec fz-node__visual">Not simulated · visual only</span>}
      {item.simulated && (view === 'LLD' || !live) && <span className="fz-node__spec">{specSummary(data.kind, data.config)}</span>}
      {view === 'LLD' && limitsSummary(data.kind, data.config) && <span className="fz-node__spec">{limitsSummary(data.kind, data.config)}</span>}
      {view === 'LLD' && <span className={`fz-node__lld${LLD_COVERAGE[data.kind] ? '' : ' is-none'}`}>{LLD_COVERAGE[data.kind] ? `{ } Java design · ${LLD_COVERAGE[data.kind]!.types} types` : 'No Java design yet'}</span>}
      {live && <LiveLine kind={data.kind} live={live} />}
    </div>}
    {live && data.kind !== 'client' && <span className="fz-node__meter" aria-hidden><span style={{ transform: `scaleX(${fill})` }} /></span>}
    <Handle type="source" position={Position.Right} className="fz-handle" />
  </div>;
}
export const ArchitectureNode = memo(ArchitectureNodeView);
