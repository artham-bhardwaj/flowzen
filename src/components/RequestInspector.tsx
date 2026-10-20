import { Crosshair, SkipBack, X } from 'lucide-react';
import { usePlayback, useThrottledTime } from '../app/playback';
import type { FailureKind, RequestRecord } from '../simulation/engine';
import { findRequest, outcomeOf, phaseAt, traceSteps, type RequestPhase, type TraceStep } from '../simulation/playback';

const ms = (value: number | undefined) => value === undefined ? 'Unavailable' : `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
export const phaseLabels: Record<RequestPhase, string> = { waiting: 'Before arrival', 'in-flight': 'In flight', success: 'Succeeded', failed: 'Failed', timeout: 'Timed out', unfinished: 'Unfinished' };
const resultLabels: Record<TraceStep['result'], string> = {
  processed: 'Processed', routed: 'Routed to replica', 'cache-hit': 'Cache hit', 'cache-miss': 'Cache miss', enqueued: 'Enqueued job', rejected: 'Rejected · queue full',
  'timed-out': 'Timed out waiting', unfinished: 'Run ended', unrouted: 'No route', blocked: 'Blocked by WAF', 'rate-limited': 'Rate-limited', 'circuit-open': 'Circuit open', throttled: 'Throttled', unavailable: 'Unavailable (outage)',
};
/** Runtime failure causes, as recorded by the engine. */
export const failureKinds: Record<FailureKind, string> = {
  timeout: 'Timeout', rejected: 'Rejected (queue full)', unrouted: 'Routing failure', unfinished: 'Run ended first', blocked: 'Blocked by WAF',
  'rate-limited': 'Rate-limited', 'circuit-open': 'Circuit open', throttled: 'Throttled', unavailable: 'Dependency outage',
};

function Waterfall({ request, steps, time, labels }: { request: RequestRecord; steps: TraceStep[]; time: number; labels: Record<string, string> }) {
  const { result } = usePlayback();
  const start = request.arrivalTime; const end = Math.max(start + 1, request.completedAt ?? result?.durationMs ?? start + 1); const span = end - start;
  const pct = (value: number) => `${Math.max(0, Math.min(100, (value - start) / span * 100))}%`;
  const playhead = time >= start && time <= end;
  return <ol className="fz-waterfall" aria-label="Component visits">
    {steps.map((step, i) => {
      const queuedEnd = step.start ?? step.arrivedAt + step.wait;
      return <li key={`${step.component}-${i}`} className={`fz-waterfall__row result-${step.result}`}>
        <div className="fz-waterfall__label"><b>{labels[step.component] ?? step.component}</b><span>{resultLabels[step.result]}{step.note && step.result !== 'routed' ? ` · ${step.note}` : ''}</span></div>
        <div className="fz-waterfall__track" aria-hidden>
          {queuedEnd > step.arrivedAt && <span className="fz-waterfall__wait" style={{ left: pct(step.arrivedAt), width: `calc(${pct(queuedEnd)} - ${pct(step.arrivedAt)})` }} />}
          {step.start !== undefined && step.end !== undefined && <span className="fz-waterfall__proc" style={{ left: pct(step.start), width: `max(2px, calc(${pct(step.end)} - ${pct(step.start)}))` }} />}
          {playhead && <span className="fz-waterfall__playhead" style={{ left: pct(time) }} />}
        </div>
        <div className="fz-waterfall__nums">
          <span>wait {ms(step.wait)}</span>
          {step.start !== undefined && step.end !== undefined && <span>process {ms(step.end - step.start)}</span>}
        </div>
      </li>;
    })}
  </ol>;
}

type Props = { id: number; labels: Record<string, string>; jobs: RequestRecord[]; onSeek: (time: number) => void; onClose: () => void };

export function RequestInspector({ id, labels, jobs, onSeek, onClose }: Props) {
  const { result, selectRequest, travelWindowMs } = usePlayback(); const time = useThrottledTime(200);
  const request = findRequest(result, id);
  if (!result || !request) return <div className="fz-inspector__empty"><b>Request unavailable</b><span>This request is not part of the current simulation result.</span><button className="fz-btn" onClick={onClose}>Close</button></div>;
  const isJob = request.internal === true;
  const steps = traceSteps(result, request); const outcome = outcomeOf(request); const phase = phaseAt(request, time);
  const waits = steps.reduce((sum, step) => sum + step.wait, 0);
  const processing = request.processing.reduce((sum, span) => sum + (span.end - span.start), 0);
  const name = isJob ? `Job #${-request.id}` : `Request #${request.id}`;

  return <div className="fz-inspector__body">
    <div className="fz-panel__head">
      <span className="fz-eyebrow">{isJob ? 'Job trace' : 'Request trace'}</span>
      <button className="fz-icon-btn" onClick={onClose} aria-label="Close request trace" title="Close"><X size={15} /></button>
    </div>
    <div className="fz-trace-head">
      <div><h2>{name}</h2><span>from {labels[request.origin ?? ''] ?? request.origin ?? 'unknown'}</span></div>
      <span className={`fz-chip outcome-${outcome ?? 'pending'}`}>{outcome ? phaseLabels[outcome] : 'Pending at end'}</span>
    </div>
    <div className="fz-trace-phase"><span>At playhead</span><b className={`phase-${phase}`}>{phaseLabels[phase]}</b></div>

    <dl className="fz-facts">
      <dt>Arrived</dt><dd>{ms(request.arrivalTime)}</dd>
      <dt>{outcome === 'success' ? 'Completed' : outcome ? 'Ended' : 'Completed'}</dt><dd>{ms(request.completedAt)}</dd>
      <dt>End-to-end latency</dt><dd>{ms(request.latency)}</dd>
      <dt>Queue wait (total)</dt><dd>{ms(waits)}</dd>
      <dt>Processing (total)</dt><dd>{ms(processing)}</dd>
      {request.cache && <><dt>Cache</dt><dd>{request.cache}</dd></>}
      {isJob && <><dt>Deliveries</dt><dd>{request.attempts ?? 1}</dd></>}
      {request.deadLetteredTo && <><dt>Dead-lettered to</dt><dd>{labels[request.deadLetteredTo] ?? request.deadLetteredTo}</dd></>}
    </dl>

    {request.error && <div className="fz-alert is-bad" role="note">
      <b>{request.failureKind ? failureKinds[request.failureKind] : 'Failure'}{request.failedAt ? ` at ${labels[request.failedAt] ?? request.failedAt}` : ''}</b>
      <span>{request.error}</span>
    </div>}

    <div className="fz-actions-row">
      <button className="fz-btn fz-btn--small" onClick={() => onSeek(Math.max(0, request.arrivalTime - travelWindowMs))}><SkipBack size={13} /> Replay from arrival</button>
      {request.completedAt !== undefined && <button className="fz-btn fz-btn--small" onClick={() => onSeek(request.completedAt!)}><Crosshair size={13} /> Jump to end</button>}
    </div>

    <h3 className="fz-section-title">Execution trace <small>{steps.length} {steps.length === 1 ? 'step' : 'steps'}</small></h3>
    {steps.length ? <Waterfall request={request} steps={steps} time={time} labels={labels} /> : <p className="fz-empty-note">No component visits were recorded.</p>}
    <div className="fz-waterfall__legend" aria-hidden><span><i className="w" />Queue wait</span><span><i className="p" />Processing</span><span><i className="h" />Playhead</span></div>

    {jobs.length > 0 && <>
      <h3 className="fz-section-title">{jobs.length === 1 ? 'Dispatched job' : `Dispatched jobs (${jobs.length})`}</h3>
      {jobs.map(job => <button key={job.id} className="fz-linkcard" onClick={() => selectRequest(job.id)}>
        <b>Job #{-job.id} → {labels[job.destination ?? ''] ?? job.destination}</b>
        <span>{job.status === 'completed' ? `Processed in ${ms(job.latency)}` : job.status === 'failed' ? `${job.error}${job.deadLetteredTo ? ` · moved to ${labels[job.deadLetteredTo] ?? job.deadLetteredTo}` : ''}` : 'Still pending when the run ended'}{(job.attempts ?? 1) > 1 ? ` · ${job.attempts} deliveries` : ''}</span>
      </button>)}
    </>}
    {isJob && request.parentId !== undefined && <button className="fz-linkcard" onClick={() => selectRequest(request.parentId!)}>
      <b>Enqueued by request #{request.parentId}</b><span>Open the originating request</span>
    </button>}
  </div>;
}
