import { useCallback, useState } from 'react';
import { CircleCheck, CircleHelp, CircleX, FlaskConical, LoaderCircle, Play, Square, Upload } from 'lucide-react';
import type { ExperimentRecord, ExperimentTemplate, ExperimentVariant } from '../../learn/experiments';
import { useExperimentRunner } from '../../learn/useLearn';
import { Inline } from './Rich';

const fmt = (value: number | null | undefined, unit: string) => value === null || value === undefined ? '—' : `${value.toLocaleString(undefined, { maximumFractionDigits: unit === 'ms' || unit === '%' ? 1 : 1 })}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
const when = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const STATUS = {
  supports: { label: 'Supports the hypothesis', icon: CircleCheck, tone: 'is-ok' },
  'does-not-support': { label: 'Does not support the hypothesis', icon: CircleX, tone: 'is-bad' },
  inconclusive: { label: 'Inconclusive', icon: CircleHelp, tone: 'is-warn' },
} as const;

type Props = {
  template: ExperimentTemplate; records: ExperimentRecord[]; onRecord: (record: ExperimentRecord) => void;
  /** Playground only: the current canvas as an extra, uncontrolled column. */
  yours?: ExperimentVariant;
  /** Playground only: copies a variant into the canvas (the caller confirms before replacing it). */
  onLoadVariant?: (variant: ExperimentVariant) => void;
};

/** A controlled experiment: question, hypothesis, controls, a measured comparison, and the explanation kept separate. */
export function ExperimentPanel({ template, records, onRecord, yours, onLoadVariant }: Props) {
  const [includeYours, setIncludeYours] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const record = useCallback((entry: ExperimentRecord) => { onRecord(entry); setSelected(null); setNotice(null); }, [onRecord]);
  const runner = useExperimentRunner(record);
  const running = runner.state.status === 'running';
  const shown = selected !== null ? records[selected] : records[records.length - 1];
  const extra = includeYours && yours ? [yours] : [];
  const start = () => { setNotice(null); if (!runner.run(template, extra)) setNotice('Another simulation is already running.'); };
  const cancelled = runner.results?.templateId === template.id && runner.results.cancelled;

  return <section className="fz-experiment" aria-label={`Experiment: ${template.title}`}>
    <div className="fz-experiment__head"><FlaskConical size={16} aria-hidden /><h3>{template.title}</h3></div>
    <dl className="fz-experiment__design">
      <dt>Question</dt><dd>{template.question}</dd>
      <dt>Hypothesis</dt><dd>{template.hypothesis}</dd>
      <dt>Held constant</dt><dd><ul>{template.controlled.map(item => <li key={item}>{item}</li>)}</ul></dd>
      <dt>Variable</dt><dd>{template.variable}</dd>
      <dt>Measured</dt><dd>{template.metrics.map(metric => metric.label).join(' · ')}</dd>
    </dl>
    <h4 className="fz-subtitle">Variants <em>{template.variants.length} · same seed ({template.benchmark.seed})</em></h4>
    <ul className="fz-experiment__variants">{template.variants.map(variant => <li key={variant.id}>
      <div><b>{variant.name}</b><span>{variant.description}</span></div>
      {onLoadVariant && <button className="fz-btn fz-btn--small" onClick={() => onLoadVariant(variant)} title="Copy this variant into the canvas to edit it"><Upload size={12} />Load into canvas</button>}
    </li>)}</ul>
    {yours && <label className="fz-check"><input type="checkbox" checked={includeYours} onChange={event => setIncludeYours(event.target.checked)} disabled={running} />Also run my current design with this benchmark <em>(shown separately: it is not a controlled variant)</em></label>}
    <div className="fz-brief__actions">
      {running ? <>
        <span className="fz-labstatus__inline" role="status"><LoaderCircle size={14} className="fz-spin" aria-hidden />Variant {runner.state.status === 'running' ? runner.state.done + 1 : 0} of {runner.state.status === 'running' ? runner.state.total : 0}</span>
        <button className="fz-btn fz-btn--small" onClick={runner.cancel}><Square size={12} />Cancel</button>
      </> : <button className="fz-btn fz-btn--primary" onClick={start}><Play size={13} />{records.length ? 'Run again' : `Run all ${template.variants.length + extra.length} variants`}</button>}
    </div>
    {notice && <div className="fz-alert is-warn" role="alert"><span>{notice}</span></div>}
    {cancelled && !running && <div className="fz-alert is-warn"><span>Cancelled. Nothing was recorded.</span></div>}

    {shown ? <RecordView template={template} record={shown} /> : !running && <p className="fz-empty-note">Run the experiment to see measured results. Each variant is a separate deterministic simulation with the benchmark above.</p>}
    {records.length > 1 && <div className="fz-experiment__history"><span>Earlier runs</span>{records.map((entry, i) => <button key={entry.at} className={`fz-chip fz-chip--small${(selected ?? records.length - 1) === i ? ' is-on' : ''}`} aria-pressed={(selected ?? records.length - 1) === i} onClick={() => setSelected(i)}>{when(entry.at)}</button>)}</div>}

    <h4 className="fz-subtitle">Why this happens <em>explanation, not measured</em></h4>
    <ul className="fz-prose__list">{template.theory.map(item => <li key={item}><Inline text={item} /></li>)}</ul>
    <h4 className="fz-subtitle">What the simulator does not model</h4>
    <ul className="fz-prose__list fz-limits">{template.limitations.map(item => <li key={item}>{item}</li>)}</ul>
  </section>;
}

function RecordView({ template, record }: { template: ExperimentTemplate; record: ExperimentRecord }) {
  const status = STATUS[record.conclusion.status]; const Icon = status.icon;
  const controlled = record.variants.filter(variant => template.variants.some(entry => entry.id === variant.id));
  const best = (metricId: string) => {
    const metric = template.metrics.find(entry => entry.id === metricId); if (!metric || metric.lowerIsBetter === null) return null;
    const values = controlled.map(variant => variant.values[metricId]).filter((value): value is number => value !== null && value !== undefined);
    if (values.length < 2 || values.every(value => value === values[0])) return null;
    return metric.lowerIsBetter ? Math.min(...values) : Math.max(...values);
  };
  return <div className="fz-experiment__result">
    <h4 className="fz-subtitle">Measured results <em>{when(record.at)}</em></h4>
    <div className="fz-prose__tablewrap" tabIndex={0} role="group" aria-label="Measured results by variant">
      <table className="fz-table fz-experiment__table">
        <thead><tr><th scope="col">Metric</th>{record.variants.map(variant => <th key={variant.id} scope="col">{variant.name}{variant.rps !== template.benchmark.rps && <small>{variant.rps.toLocaleString()} req/s</small>}{variant.id === 'yours' && <small>not controlled</small>}</th>)}</tr></thead>
        <tbody>{template.metrics.map(metric => { const top = best(metric.id); return <tr key={metric.id}><th scope="row">{metric.label}</th>
          {record.variants.map(variant => { const value = variant.values[metric.id]; return <td key={variant.id} className={top !== null && value === top && variant.id !== 'yours' ? 'is-best' : ''}>{variant.complete ? fmt(value, metric.unit) : variant.error ? 'failed' : 'incomplete'}</td>; })}</tr>; })}</tbody>
      </table>
    </div>
    <div className={`fz-alert ${status.tone} fz-experiment__conclusion`} role="note"><Icon size={15} aria-hidden /><span><b><span className="fz-basis is-measured">Measured</span> {status.label}</b>{record.conclusion.summary}</span></div>
    {record.conclusion.evidence.length > 0 && <ul className="fz-lesson__evidence">{record.conclusion.evidence.map(item => <li key={item}>{item}</li>)}</ul>}
  </div>;
}
