import { lazy, Suspense, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, Gauge, ListTree, SkipBack } from 'lucide-react';
import { usePlayback, useThrottledTime } from '../app/playback';
import type { Theme } from '../app/theme';
import type { RequestRecord, SimulationResult } from '../simulation/engine';
import { phaseAt, timelineAt, type RequestPhase, type TimelineEvent } from '../simulation/playback';
// Recharts is only needed for the metrics tab, so it loads on demand.
const MetricsPanel = lazy(() => import('./MetricsPanel').then(module => ({ default: module.MetricsPanel })));
import { phaseLabels } from './RequestInspector';

export type BottomTab = 'timeline' | 'requests' | 'metrics';
const TIMELINE_ROWS = 60; const REQUEST_ROWS = 100; const REQUEST_SCAN = 50_000;
const fmt = (value: number, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits });

function describe(event: TimelineEvent, labels: Record<string, string>) {
  const at = event.componentId ? labels[event.componentId] ?? event.componentId : '';
  const who = event.jobId ? `Job #${-event.jobId}` : `Request #${event.requestId}`;
  switch (event.type) {
    case 'arrival': return `${who} sent by ${at}`;
    case 'queued': return `${who} waiting at ${at}`;
    case 'processing': return `${who} processing at ${at}`;
    case 'cache-hit': return `${who} cache hit at ${at}`;
    case 'cache-miss': return `${who} cache miss at ${at}`;
    case 'enqueued': return `${who} enqueued a job at ${at}`;
    case 'job-start': return `${who} processing at ${at}`;
    case 'job-done': return `${who} finished at ${at}`;
    case 'success': return `${who} completed at ${at}`;
    case 'failed': return `${who} failed at ${at}`;
    case 'timeout': return `${who} timed out at ${at}`;
    case 'unfinished': return `${who} unfinished when the run ended`;
    case 'dead-lettered': return `${who} moved to ${at} after its final delivery failed`;
  }
}

function Timeline({ labels }: { labels: Record<string, string> }) {
  const { index, selectRequest, selectedRequest } = usePlayback(); const time = useThrottledTime(150);
  const live = useMemo(() => timelineAt(index, time, TIMELINE_ROWS), [index, time]);
  // Hold the list still while the pointer or keyboard focus is inside it, so rows do not move under the cursor.
  const [held, setHeld] = useState<TimelineEvent[] | null>(null);
  const events = held ?? live;
  const hold = () => setHeld(current => current ?? live); const release = () => setHeld(null);
  if (!index) return <div className="fz-bottom__empty"><b>No events yet</b><span>Run a simulation to stream its recorded request events here.</span></div>;
  return <div className="fz-list-wrap" onMouseEnter={hold} onMouseLeave={release} onFocus={hold} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) release(); }}>
    <p className="fz-list-note">Latest {Math.min(TIMELINE_ROWS, events.length)} events up to the playhead · {fmt(index.events.at.length, 0)} recorded{held && live !== held ? ' · updates held while you browse' : ''}</p>
    {events.length ? <ol className="fz-timeline">{events.map((event, i) => {
      const id = event.jobId ?? event.requestId;
      return <li key={`${event.at}-${event.type}-${event.requestId}-${event.jobId ?? 0}-${i}`}>
        <button className={`fz-row ev-${event.type}${selectedRequest === id ? ' is-selected' : ''}`} onClick={() => selectRequest(id)}>
          <time>{fmt(event.at, 2)} ms</time><i aria-hidden /><span>{describe(event, labels)}</span>
        </button>
      </li>;
    })}</ol> : <p className="fz-empty-note">Waiting for the first simulated event…</p>}
  </div>;
}

type Filter = 'in-flight' | 'failed' | 'timeout' | 'success' | 'all';
const filters: Array<[Filter, string]> = [['in-flight', 'In flight'], ['failed', 'Failed'], ['timeout', 'Timed out'], ['success', 'Succeeded'], ['all', 'All arrived']];

function recentRequests(result: SimulationResult, time: number, filter: Filter) {
  const rows: Array<{ request: RequestRecord; phase: RequestPhase }> = [];
  for (let i = result.requests.length - 1, scanned = 0; i >= 0 && rows.length < REQUEST_ROWS && scanned < REQUEST_SCAN; i--, scanned++) {
    const request = result.requests[i]; if (request.arrivalTime > time) continue;
    const phase = phaseAt(request, time);
    if (filter === 'all' || phase === filter || (filter === 'failed' && phase === 'unfinished')) rows.push({ request, phase });
  }
  return rows;
}

function Requests({ labels }: { labels: Record<string, string> }) {
  const { result, selectRequest, selectedRequest } = usePlayback(); const time = useThrottledTime(250); const [filter, setFilter] = useState<Filter>('in-flight');
  const rows = useMemo(() => result ? recentRequests(result, time, filter) : [], [result, time, filter]);
  if (!result) return <div className="fz-bottom__empty"><b>No requests yet</b><span>Run a simulation to browse individual request traces.</span></div>;
  return <div className="fz-list-wrap">
    <div className="fz-filters" role="radiogroup" aria-label="Request filter">
      {filters.map(([value, label]) => <button key={value} role="radio" aria-checked={filter === value} className={filter === value ? 'is-on' : ''} onClick={() => setFilter(value)}>{label}</button>)}
      <span className="fz-list-note">Most recent {rows.length} matching, as of the playhead</span>
    </div>
    {rows.length ? <table className="fz-table fz-table--rows">
      <thead><tr><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Arrived</th><th scope="col">Latency</th><th scope="col">Path</th></tr></thead>
      <tbody>{rows.map(({ request, phase }) => <tr key={request.id} className={selectedRequest === request.id ? 'is-selected' : ''}>
        <th scope="row"><button className="fz-link" onClick={() => selectRequest(request.id)}>#{request.id}</button></th>
        <td><span className={`fz-chip fz-chip--small outcome-${phase}`}>{phaseLabels[phase]}</span></td>
        <td>{fmt(request.arrivalTime, 2)} ms</td>
        <td>{phase === 'in-flight' || request.latency === undefined ? '—' : `${fmt(request.latency)} ms`}</td>
        <td className="fz-path">{[request.origin, ...request.processing.map(span => span.component), ...(request.failedAt && request.failedAt !== (request.processing.at(-1)?.component ?? request.origin) ? [request.failedAt] : [])].map(id => labels[id ?? ''] ?? id).join(' › ')}</td>
      </tr>)}</tbody>
    </table> : <p className="fz-empty-note">No requests match this filter at the playhead.</p>}
  </div>;
}

type Props = {
  open: boolean; onToggle: () => void; tab: BottomTab; onTab: (tab: BottomTab) => void; theme: Theme; labels: Record<string, string>;
  durationMs: number; onSeek: (time: number) => void; error: string | null; onDismissError: () => void;
};

function Scrubber({ durationMs, onSeek }: { durationMs: number; onSeek: (time: number) => void }) {
  const { result } = usePlayback(); const time = useThrottledTime(80); const total = result?.durationMs ?? durationMs;
  return <div className="fz-scrubber">
    <button className="fz-icon-btn" onClick={() => onSeek(0)} disabled={!result} aria-label="Rewind to start" title="Rewind to start"><SkipBack size={14} /></button>
    <input type="range" min={0} max={total} step={Math.max(0.01, total / 2000)} value={result ? time : 0} disabled={!result} onChange={event => onSeek(Number(event.target.value))}
      aria-label="Simulated time" aria-valuetext={`${fmt(time / 1000, 3)} of ${fmt(total / 1000, 3)} seconds`} style={{ ['--fill' as string]: `${result ? time / total * 100 : 0}%` }} />
    <span className="fz-scrubber__time"><b>{fmt((result ? time : 0) / 1000, 3)}</b> / {fmt(total / 1000, 3)} s</span>
  </div>;
}

export function BottomPanel(props: Props) {
  const tabs: Array<[BottomTab, string, typeof Activity]> = [['timeline', 'Timeline', Activity], ['requests', 'Requests', ListTree], ['metrics', 'Metrics', Gauge]];
  return <section className={`fz-bottom${props.open ? '' : ' is-collapsed'}`} aria-label="Simulation panel">
    <div className="fz-bottom__bar">
      <div className="fz-tabs" role="tablist" aria-label="Simulation views">
        {tabs.map(([id, label, Icon]) => <button key={id} role="tab" id={`tab-${id}`} aria-selected={props.tab === id} aria-controls="fz-bottom-panel" className={props.tab === id ? 'is-on' : ''}
          onClick={() => { props.onTab(id); if (!props.open) props.onToggle(); }}><Icon size={14} aria-hidden />{label}</button>)}
      </div>
      <Scrubber durationMs={props.durationMs} onSeek={props.onSeek} />
      <button className="fz-icon-btn" onClick={props.onToggle} aria-expanded={props.open} aria-label={props.open ? 'Collapse simulation panel' : 'Expand simulation panel'} title={props.open ? 'Collapse' : 'Expand'}>
        {props.open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
    </div>
    {props.error && <div className="fz-alert is-bad fz-bottom__error" role="alert"><span><b>Simulation failed.</b> {props.error}</span><button className="fz-btn fz-btn--small" onClick={props.onDismissError}>Dismiss</button></div>}
    {props.open && <div className="fz-bottom__content" id="fz-bottom-panel" role="tabpanel" aria-labelledby={`tab-${props.tab}`}>
      {props.tab === 'timeline' && <Timeline labels={props.labels} />}
      {props.tab === 'requests' && <Requests labels={props.labels} />}
      {props.tab === 'metrics' && <Suspense fallback={<div className="fz-bottom__empty"><span>Loading metrics…</span></div>}><MetricsPanel theme={props.theme} labels={props.labels} /></Suspense>}
    </div>}
  </section>;
}
