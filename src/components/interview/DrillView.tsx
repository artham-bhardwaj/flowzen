import { useState } from 'react';
import { LoaderCircle, RotateCcw, Send } from 'lucide-react';
import { Breadcrumbs } from '../catalog/Shell';
import { byKind } from '../../app/catalog';
import { labInput } from '../../lab/measure';
import { useLabRunner } from '../../lab/useLabRunner';
import { SKILL_LABELS, answerKey, bottleneckSnapshot, type BottleneckMeasurement, type Drill, type DrillAnswers, type DrillAttempt } from '../../interview/drills';
import type { PracticeController } from '../../interview/usePractice';
import type { Resource } from '../../interview/types';
import { ResourceLinks, ScorePill } from './shared';

const BASIS = { structural: 'Structural', measured: 'Measured', arithmetic: 'Arithmetic', keyword: 'Keyword-based' } as const;

/** One targeted-practice drill. Attempts are stored separately from interviews and never change interview results. */
export function DrillView({ drill, practice, onBack, onResource }: { drill: Drill; practice: PracticeController; onBack: () => void; onResource: (resource: Resource) => void }) {
  const [answers, setAnswers] = useState<DrillAnswers>({});
  const [attempt, setAttempt] = useState<DrillAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runner = useLabRunner();
  const previous = practice.state.attempts.filter(entry => entry.drillId === drill.id).reverse();
  const set = (key: string, value: string) => setAnswers(current => ({ ...current, [key]: value }));
  const bottlenecks = drill.tasks.filter(task => task.type === 'bottleneck');

  /** Bottleneck tasks are measured in the simulator at submission; the other tasks need no run. */
  const submit = () => {
    setError(null);
    if (!bottlenecks.length) { setAttempt(practice.submit(drill, answers, {})); return; }
    const measured: Record<string, BottleneckMeasurement> = {};
    const inputs = bottlenecks.map(task => { const graph = (task as Extract<typeof task, { type: 'bottleneck' }>).graph; return labInput(bottleneckSnapshot(graph), { rps: graph.rps, durationMs: 5000, drainMs: 1500, seed: 7, faults: [] }); });
    runner.run({
      label: drill.title, inputs, labels: {},
      onLevel: (index, outcome) => {
        if (!outcome.ok) { setError(outcome.error); return; }
        const components = outcome.measurements.components.filter(component => component.kind !== 'client');
        measured[bottlenecks[index].id] = { busiestId: components[0]?.id ?? '', utilization: Object.fromEntries(components.map(component => [component.id, Math.round(component.utilization * 1000) / 1000])) };
      },
      onDone: ({ cancelled }) => { if (cancelled) { setError('Cancelled. Nothing was recorded.'); return; } if (Object.keys(measured).length === bottlenecks.length) setAttempt(practice.submit(drill, answers, measured)); },
    });
  };
  const result = attempt?.result;
  return <article className="fz-iv-detail fz-iv-drill" aria-labelledby="fz-iv-drill-title">
    <header className="fz-detail-hero"><Breadcrumbs crumbs={[{ label: 'Flowzen', onClick: onBack }, { label: 'Interview', onClick: onBack }, { label: 'Targeted practice', onClick: onBack }, { label: drill.title }]} />
      <span className="fz-eyebrow">{SKILL_LABELS[drill.skill]} · about {drill.minutes} min · practice only</span><h1 id="fz-iv-drill-title">{drill.title}</h1>
      <p className="fz-detail-hero__summary">{drill.brief}</p></header>
    <p className="fz-brief__note">Targeted practice is stored separately from interviews and does not change interview scores or history. Grading rules are shown with each result.</p>
    {drill.tasks.map(task => <section key={task.id} className="fz-iv-card" aria-label={task.prompt}>
      <h2 className="fz-iv-h3">{task.prompt}</h2>
      {task.type === 'numbers' && <table className="fz-table fz-iv-estimates"><thead><tr><th scope="col">Quantity</th><th scope="col">Your estimate</th><th scope="col">Unit</th></tr></thead>
        <tbody>{task.quantities.map(quantity => <tr key={quantity.id}><th scope="row">{quantity.label}</th><td><input aria-label={quantity.label} inputMode="decimal" disabled={Boolean(attempt)} value={answers[answerKey(task.id, quantity.id)] ?? ''} onChange={event => set(answerKey(task.id, quantity.id), event.target.value)} /></td><td>{quantity.unit}</td></tr>)}</tbody></table>}
      {task.type === 'choice' && <fieldset className="fz-iv-choices" disabled={Boolean(attempt)}><legend className="fz-visually-hidden">{task.prompt}</legend>{task.options.map(option => <label key={option.id} className="fz-check"><input type="radio" name={`${drill.id}-${task.id}`} checked={answers[task.id] === option.id} onChange={() => set(task.id, option.id)} />{option.label}</label>)}</fieldset>}
      {task.type === 'bottleneck' && <>
        <table className="fz-table fz-iv-table"><caption>{task.graph.rps.toLocaleString()} requests per second enter at {task.graph.nodes[0].label}. Connections: {task.graph.edges.map(([from, to]) => `${task.graph.nodes.find(node => node.id === from)?.label} → ${task.graph.nodes.find(node => node.id === to)?.label}`).join(', ')}.</caption>
          <thead><tr><th scope="col">Component</th><th scope="col">Settings</th></tr></thead>
          <tbody>{task.graph.nodes.filter(node => node.kind !== 'client').map(node => <tr key={node.id}><th scope="row">{node.label}<small>{byKind[node.kind].label}</small></th><td>{Object.entries(node.config).map(([key, value]) => `${byKind[node.kind].fields.find(field => field.key === key)?.label ?? key}: ${value}${byKind[node.kind].fields.find(field => field.key === key)?.unit ? ` ${byKind[node.kind].fields.find(field => field.key === key)!.unit}` : ''}`).join(' · ')}</td></tr>)}</tbody></table>
        <fieldset className="fz-iv-choices" disabled={Boolean(attempt)}><legend>Your answer</legend>{task.graph.nodes.filter(node => node.kind !== 'client').map(node => <label key={node.id} className="fz-check"><input type="radio" name={`${drill.id}-${task.id}`} checked={answers[task.id] === node.id} onChange={() => set(task.id, node.id)} />{node.label}</label>)}</fieldset>
        <p className="fz-brief__note">On submission the simulator runs this exact design and your answer is compared with the measured busiest component.</p>
      </>}
      {task.type === 'text' && <textarea aria-label={task.prompt} rows={5} disabled={Boolean(attempt)} value={answers[task.id] ?? ''} onChange={event => set(task.id, event.target.value)} placeholder="Explain your reasoning." />}
      {result && (() => { const taskResult = result.tasks.find(entry => entry.taskId === task.id)!; return <div className="fz-iv-drillresult">
        <div className="fz-iv-criterion__head"><ScorePill score={taskResult.score} /><span className="fz-tag">{BASIS[taskResult.basis]}</span></div>
        <ul className="fz-iv-evidence-list">{taskResult.evidence.map((entry, i) => <li key={i} className={entry.positive ? 'is-pos' : 'is-neg'}>{entry.text}</li>)}</ul>
        {taskResult.missed.length > 0 && <p className="fz-brief__note">Not covered: {taskResult.missed.join('; ')}.</p>}
        {task.type === 'numbers' && <ul className="fz-prose__list">{task.quantities.map(quantity => <li key={quantity.id}>{quantity.working}</li>)}</ul>}
        {task.type === 'choice' && <ul className="fz-prose__list">{task.options.map(option => <li key={option.id}><b>{option.label}</b> ({option.verdict}): {option.why}</li>)}</ul>}
      </div>; })()}
    </section>)}
    {error && <div className="fz-alert is-warn" role="alert"><span>{error}</span></div>}
    {!attempt ? <div className="fz-brief__actions"><button className="fz-btn fz-btn--primary" disabled={runner.state.status === 'running' || !Object.values(answers).some(value => value.trim())} onClick={submit}>{runner.state.status === 'running' ? <LoaderCircle size={13} className="fz-spin" /> : <Send size={13} />}{runner.state.status === 'running' ? 'Measuring…' : 'Submit'}</button></div>
      : <>
        <section className="fz-iv-reference" aria-label="Explanation"><b>Result: {attempt.result.percent}%</b><ul className="fz-prose__list">{drill.explanation.map(item => <li key={item}>{item}</li>)}</ul><ResourceLinks resources={drill.resources} onResource={onResource} /></section>
        <div className="fz-brief__actions"><button className="fz-btn" onClick={() => { setAttempt(null); setAnswers({}); }}><RotateCcw size={13} />Try again</button><button className="fz-btn" onClick={onBack}>Back to practice</button></div>
      </>}
    {previous.length > 0 && <><h2 className="fz-iv-h2">Previous attempts</h2><ul className="fz-explist">{previous.slice(0, 8).map(entry => <li key={entry.id}><span>{new Date(entry.at).toLocaleString()}</span><span>{entry.result.percent}%</span></li>)}</ul></>}
  </article>;
}
