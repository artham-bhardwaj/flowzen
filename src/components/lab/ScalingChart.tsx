import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { readTokens, type Theme } from '../../app/theme';
import type { curveSeries } from '../../lab/lab';

type Point = ReturnType<typeof curveSeries>[number];
const TOKENS = ['viz-1', 'viz-2', 'viz-3', 'text', 'text-2', 'text-3', 'border', 'surface'] as const;
const fmt = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const LATENCY = [{ key: 'p50', label: 'p50', token: 'viz-1' }, { key: 'p95', label: 'p95', token: 'viz-2' }, { key: 'p99', label: 'p99', token: 'viz-3' }] as const;

function LatencyTip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as Point;
  return <div className="fz-tooltip"><b>{fmt(Number(label), 0)} req/s offered</b>
    {LATENCY.map(entry => <span key={entry.key}><i className={`fz-viz-key is-${entry.token}`} />{entry.label}<em>{fmt(point[entry.key])} ms</em></span>)}
    <span>{point.meetsTargets ? 'Targets met' : 'Target missed'}</span>
  </div>;
}
function ThroughputTip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as Point;
  return <div className="fz-tooltip"><b>{fmt(Number(label), 0)} req/s offered</b>
    <span><i className="fz-viz-key is-viz-1" />Successful<em>{fmt(point.successThroughput)} req/s</em></span>
    <span>Error rate<em>{fmt(point.errorRatePct, 2)}%</em></span>
  </div>;
}

/** Last-point direct label, so each line is identified without relying on color alone. */
const endLabel = (text: string, color: string, lastIndex: number) => (props: { x?: number; y?: number; index?: number }) =>
  props.index === lastIndex && props.x !== undefined && props.y !== undefined ? <text x={props.x + 8} y={props.y + 4} fill={color} fontSize={11} fontWeight={600}>{text}</text> : <g />;

/**
 * Two charts sharing the offered-traffic axis (no dual axis): latency percentiles, and successful throughput
 * against the offered-traffic line. Only simulated levels are plotted; lines connect them for readability.
 */
export default function ScalingChart({ points, theme, p95Target, firstFailingRps }: { points: Point[]; theme: Theme; p95Target: number; firstFailingRps: number | null }) {
  // Theme is a dependency so the tokens are re-read when the document theme changes.
  const colors = useMemo(() => readTokens(TOKENS), [theme]);
  if (points.length < 2) return <p className="fz-empty-note">At least two simulated levels are needed to draw a curve.</p>;
  const maxRps = points[points.length - 1].rps; const last = points.length - 1;
  const axis = { stroke: colors.border, tick: { fill: colors['text-3'], fontSize: 10 }, tickLine: false };
  const xAxis = <XAxis dataKey="rps" type="number" domain={[0, maxRps]} ticks={points.map(point => point.rps)} tickFormatter={value => fmt(value, 0)} {...axis} />;
  const breakLine = firstFailingRps !== null && <ReferenceLine x={firstFailingRps} stroke={colors['text-2']} strokeDasharray="3 3" label={{ value: 'first target miss (simulated)', position: 'insideTopLeft', fill: colors['text-2'], fontSize: 10 }} />;
  const maxThroughput = Math.max(maxRps, ...points.map(point => point.successThroughput));
  return <div className="fz-scaling">
    <figure className="fz-chart fz-scaling__chart" aria-label="Latency percentiles by offered traffic">
      <figcaption><span>Latency of successful requests (ms) vs offered traffic (req/s)</span>
        <span className="fz-chart__legend">{LATENCY.map(entry => <span key={entry.key}><i className={`fz-viz-key is-${entry.token}`} />{entry.label}</span>)}<span><i className="fz-viz-key is-ref" />p95 target</span></span></figcaption>
      <div className="fz-chart__plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 14, right: 76, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.border} vertical={false} />
            {xAxis}
            <YAxis tickFormatter={value => fmt(value, 0)} axisLine={false} width={44} {...axis} />
            <Tooltip content={<LatencyTip />} cursor={{ stroke: colors['text-3'], strokeWidth: 1 }} isAnimationActive={false} />
            <ReferenceLine y={p95Target} stroke={colors['text-3']} strokeDasharray="6 4" />
            {breakLine}
            {LATENCY.map(entry => <Line key={entry.key} dataKey={entry.key} name={entry.label} type="linear" stroke={colors[entry.token]} strokeWidth={2} connectNulls={false}
              dot={{ r: 4, strokeWidth: 2, stroke: colors.surface, fill: colors[entry.token] }} activeDot={{ r: 5, strokeWidth: 2, stroke: colors.surface }} isAnimationActive={false}
              label={endLabel(entry.label, colors[entry.token], last)} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
    <figure className="fz-chart fz-scaling__chart" aria-label="Successful throughput by offered traffic">
      <figcaption><span>Successful throughput vs offered traffic (req/s)</span>
        <span className="fz-chart__legend"><span><i className="fz-viz-key is-viz-1" />successful</span><span><i className="fz-viz-key is-ref" />offered (every request succeeds)</span></span></figcaption>
      <div className="fz-chart__plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 14, right: 76, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={colors.border} vertical={false} />
            {xAxis}
            <YAxis domain={[0, Math.ceil(maxThroughput)]} tickFormatter={value => fmt(value, 0)} axisLine={false} width={46} {...axis} />
            <Tooltip content={<ThroughputTip />} cursor={{ stroke: colors['text-3'], strokeWidth: 1 }} isAnimationActive={false} />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxRps, y: maxRps }]} stroke={colors['text-3']} strokeDasharray="6 4" />
            {breakLine}
            <Line dataKey="successThroughput" name="Successful throughput" type="linear" stroke={colors['viz-1']} strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, stroke: colors.surface, fill: colors['viz-1'] }} activeDot={{ r: 5, strokeWidth: 2, stroke: colors.surface }} isAnimationActive={false}
              label={endLabel('successful', colors['viz-1'], last)} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
    <p className="fz-brief__note">Dots are simulated traffic levels. Lines only connect them; nothing between dots was simulated. The table below lists every value.</p>
  </div>;
}
