import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { usePlayback, useThrottledTime } from '../app/playback';
import { readTokens, type Theme } from '../app/theme';
import { totalsAt } from '../simulation/playback';
import type { FailureKind } from '../simulation/engine';
import { failureKinds } from './RequestInspector';

const TOKENS = ['text-2', 'text-3', 'border', 'ok', 'bad', 'warn', 'surface'] as const;
const fmt = (value: number, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const series = [
  { key: 'offered', label: 'Offered', glyph: '—', token: 'text-3', dash: '4 3' },
  { key: 'success', label: 'Succeeded', glyph: '✓', token: 'ok' },
  { key: 'failed', label: 'Rejected / unroutable', glyph: '✕', token: 'bad' },
  { key: 'timeout', label: 'Timed out', glyph: '⏱', token: 'warn' },
] as const;

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return <div className="fz-tooltip">
    <b>{fmt(Number(label) / 1000, 2)} s</b>
    {series.map(entry => { const item = payload.find(row => row.dataKey === entry.key); return item && <span key={entry.key}><i className={`g-${entry.key}`}>{entry.glyph}</i>{entry.label}<em>{fmt(Number(item.value), 0)} rps</em></span>; })}
  </div>;
}

function ThroughputChart({ theme, time }: { theme: Theme; time: number }) {
  const { index } = usePlayback();
  // Theme is a dependency so colors are re-read after the document theme changes.
  const colors = useMemo(() => readTokens(TOKENS), [theme]);
  const data = useMemo(() => {
    if (!index) return [];
    const { bucketMs, success, failed, timeout, arrivals } = index.series; const rate = 1000 / bucketMs; const rows = [];
    for (let i = 0; i < success.length && i * bucketMs <= time; i++) rows.push({ t: (i + 1) * bucketMs, offered: arrivals[i] * rate, success: success[i] * rate, failed: failed[i] * rate, timeout: timeout[i] * rate });
    return rows;
  }, [index, time]);
  if (!index) return null;
  return <figure className="fz-chart" aria-label="Request outcomes per second over simulated time">
    <figcaption><span>Outcomes per second</span><span className="fz-chart__legend">{series.map(entry => <span key={entry.key}><i className={`g-${entry.key}`}>{entry.glyph}</i>{entry.label}</span>)}</span></figcaption>
    <div className="fz-chart__plot">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={colors.border} strokeDasharray="0" vertical={false} />
          <XAxis dataKey="t" type="number" domain={[0, index.durationMs]} tickFormatter={value => `${fmt(value / 1000, 1)}s`} stroke={colors.border} tick={{ fill: colors['text-3'], fontSize: 10 }} tickLine={false} />
          <YAxis tickFormatter={value => fmt(value, 0)} stroke={colors.border} tick={{ fill: colors['text-3'], fontSize: 10 }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors['text-3'], strokeWidth: 1 }} isAnimationActive={false} />
          <ReferenceLine x={Math.min(time, index.durationMs)} stroke={colors['text-2']} strokeDasharray="2 2" />
          {series.map(entry => <Line key={entry.key} dataKey={entry.key} name={entry.label} type="monotone" stroke={colors[entry.token]} strokeWidth={2} strokeDasharray={'dash' in entry ? entry.dash : undefined} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: colors.surface }} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  </figure>;
}

export function MetricsPanel({ theme, labels }: { theme: Theme; labels: Record<string, string> }) {
  const { result, index, runValidation } = usePlayback(); const time = useThrottledTime(250);
  if (!result || !index) return <div className="fz-bottom__empty"><b>No measurements yet</b><span>Run a simulation to see engine metrics. Nothing here is estimated before a run.</span></div>;
  const live = totalsAt(index, time);
  const kpis: Array<[string, string, string]> = [
    ['Latency p50 · p95 · p99', [result.latency.p50, result.latency.p95, result.latency.p99].map(value => value === null ? '—' : fmt(value)).join(' · ') + ' ms', 'Completed requests only'],
    ['Successful throughput', `${fmt(result.successfulThroughput)} rps`, `${fmt(result.offeredRequests, 0)} offered`],
    ['Error rate', `${fmt(result.errorRate * 100)}%`, `${fmt(result.failedRequests, 0)} of ${fmt(result.requests.length, 0)} failed`],
    ['Cache hit ratio', result.cache.hitRatio === null ? '—' : `${fmt(result.cache.hitRatio * 100)}%`, result.cache.hitRatio === null ? 'No cache lookups' : `${fmt(result.cache.hits, 0)} hits · ${fmt(result.cache.misses, 0)} misses`],
  ];
  return <div className="fz-metrics">
    <div className="fz-metrics__col">
      <h3 className="fz-section-title">Run totals <small>engine · {fmt(result.durationMs / 1000)} s</small></h3>
      <div className="fz-kpis">{kpis.map(([label, value, note]) => <div key={label} className="fz-kpi"><span>{label}</span><b>{value}</b><small>{note}</small></div>)}</div>
      <h3 className="fz-section-title">At playhead <small>{fmt(time / 1000, 2)} s</small></h3>
      <div className="fz-live-counts">
        <span><b>{fmt(live.arrived, 0)}</b> arrived</span><span className="c-flight"><b>{fmt(live.inFlight, 0)}</b> in flight</span>
        <span className="c-ok"><b>{fmt(live.succeeded, 0)}</b> ✓ succeeded</span><span className="c-bad"><b>{fmt(live.failed, 0)}</b> ✕ failed</span>
        <span className="c-warn"><b>{fmt(live.timedOut, 0)}</b> ⏱ timed out</span>{live.unfinished > 0 && <span><b>{fmt(live.unfinished, 0)}</b> unfinished</span>}
      </div>
      {Object.keys(result.failuresByKind).length > 0 && <>
        <h3 className="fz-section-title">Runtime failures by cause <small>engine</small></h3>
        <div className="fz-causes">{(Object.entries(result.failuresByKind) as Array<[FailureKind, number]>).sort((a, b) => b[1] - a[1]).map(([kind, count]) => <span key={kind}><b>{fmt(count, 0)}</b>{failureKinds[kind]}</span>)}</div>
      </>}
      {runValidation && (runValidation.counts.dead > 0 || runValidation.counts.warning > 0) && <div className="fz-alert is-warn fz-run-disclosure">
        <span><b>Run with architecture issues</b>This run started with {runValidation.counts.dead} dead and {runValidation.counts.warning} warning components. Dead paths process no traffic, and requests that reach them fail with the cause shown above. These validation issues are separate from runtime failures.</span>
      </div>}
      {result.stoppedEarly && <div className="fz-alert is-warn"><span>The engine reached its event limit and stopped early. Later traffic was not simulated.</span></div>}
    </div>
    <ThroughputChart theme={theme} time={time} />
    <div className="fz-metrics__col fz-metrics__table">
      <table className="fz-table">
        <caption>Components <small>engine totals</small></caption>
        <thead><tr><th scope="col">Component</th><th scope="col">Util.</th><th scope="col">Done</th><th scope="col">Rejected</th><th scope="col">Max queue</th><th scope="col">Avg wait</th></tr></thead>
        <tbody>{result.components.map(metric => <tr key={metric.id}>
          <th scope="row">{labels[metric.id] ?? metric.id}</th>
          <td>{metric.kind === 'deadLetterQueue' ? '—' : <span className="fz-util-cell"><span className="fz-bar"><span style={{ width: `${Math.min(100, metric.utilization * 100)}%` }} /></span>{fmt(metric.utilization * 100, 0)}%</span>}</td>
          <td>{fmt(metric.completed, 0)}</td><td className={metric.rejected ? 'c-bad' : ''}>{fmt(metric.rejected, 0)}</td><td>{fmt(metric.maxQueueDepth, 0)}</td><td>{fmt(metric.averageWaitMs)} ms</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
