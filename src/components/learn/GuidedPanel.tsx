import { useEffect, useState } from 'react';
import { ArrowLeft, CircleCheck, CircleX, LoaderCircle, Lock, Play } from 'lucide-react';
import type { ArchitectureSnapshot } from '../../challenges/attempts';
import type { LabBenchmark } from '../../lab/measure';
import { useLabRunner } from '../../lab/useLabRunner';
import { lessonById } from '../../learn/curriculum';
import { buildInput, evaluateBuild, type BuildResult } from '../../learn/evaluate';
import { EXPERIMENTS, UNSUPPORTED_EXPERIMENTS, customVariant, experimentById, variantBenchmark, type ExperimentVariant } from '../../learn/experiments';
import type { LearnController } from '../../learn/useLearn';
import type { BuildTask } from '../../learn/types';
import { ExperimentPanel } from './ExperimentPanel';
import { Inline } from './Rich';

/** What the Playground was opened for from a lesson. */
export type PlaygroundFocus = { tab: 'guided'; experimentId?: string; exercise?: { lessonId: string; taskId: string }; nonce: number };

type Props = {
  learn: LearnController; snapshot: ArchitectureSnapshot; labels: Record<string, string>; focus: PlaygroundFocus | null;
  /** Replaces the canvas with a copy of a design (asks first); `then` runs only if the user confirms. */
  onLoad: (snapshot: ArchitectureSnapshot, label: string, then?: () => void) => void;
  onSetBenchmark: (benchmark: LabBenchmark) => void;
  onOpenLesson: (lessonId: string, section: 'exercise' | 'experiment') => void;
};

/** The Playground's guided work: the current build exercise and the library of controlled experiments. */
export function GuidedPanel({ learn, snapshot, labels, focus, onLoad, onSetBenchmark, onOpenLesson }: Props) {
  const [experimentId, setExperimentId] = useState(focus?.experimentId ?? EXPERIMENTS[0].id);
  useEffect(() => { if (focus?.experimentId) setExperimentId(focus.experimentId); }, [focus]);
  const template = experimentById(experimentId) ?? EXPERIMENTS[0];
  const lesson = focus?.exercise ? lessonById(focus.exercise.lessonId) : undefined;
  const task = lesson?.exercise?.tasks.find((entry): entry is BuildTask => entry.type === 'build' && entry.id === focus!.exercise!.taskId);
  const loadVariant = (variant: ExperimentVariant) => onLoad(variant.architecture, `the “${variant.name}” variant`, () => onSetBenchmark(variantBenchmark(template, variant)));

  return <div className="fz-guided">
    {lesson && task && <BuildCheck key={`${lesson.id}-${task.id}`} lessonId={lesson.id} lessonTitle={lesson.title} task={task} snapshot={snapshot} labels={labels} learn={learn} onBack={() => onOpenLesson(lesson.id, 'exercise')} />}
    <h3 className="fz-section-title">Guided experiments <small>{EXPERIMENTS.length} available</small></h3>
    <label className="fz-field"><span>Experiment</span>
      <select value={template.id} onChange={event => setExperimentId(event.target.value)} aria-label="Guided experiment">{EXPERIMENTS.map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>
    </label>
    {template.lessons.map(id => lessonById(id)).filter(Boolean).map(entry => <p key={entry!.id} className="fz-brief__note">Lesson: <button className="fz-link" onClick={() => onOpenLesson(entry!.id, 'experiment')}>{entry!.title}</button></p>)}
    <ExperimentPanel key={template.id} template={template} records={learn.state.experiments[template.id] ?? []} onRecord={learn.recordExperiment} yours={customVariant(snapshot)} onLoadVariant={loadVariant} />
    <p className="fz-brief__note">Loading a variant copies it into the canvas and sets the lab benchmark to the variant’s workload, so you can edit it, set it as a baseline and compare. The experiment itself is never changed.</p>
    <details className="fz-labdetails"><summary>Why some experiments are not offered</summary><ul className="fz-prose__list fz-limits">{UNSUPPORTED_EXPERIMENTS.map(entry => <li key={entry.title}><b>{entry.title}.</b> {entry.reason}</li>)}</ul></details>
  </div>;
}

function BuildCheck({ lessonId, lessonTitle, task, snapshot, labels, learn, onBack }: { lessonId: string; lessonTitle: string; task: BuildTask; snapshot: ArchitectureSnapshot; labels: Record<string, string>; learn: LearnController; onBack: () => void }) {
  const runner = useLabRunner();
  const [result, setResult] = useState<{ build: BuildResult; key: string } | { error: string; key: string } | null>(null);
  const key = JSON.stringify([snapshot.nodes.map(node => [node.id, node.kind, node.config]), snapshot.edges]);
  const done = Boolean(learn.state.lessons[lessonId]?.tasks?.[task.id]);
  const running = runner.state.status === 'running';
  const check = () => {
    const architecture = snapshot; const runKey = key;
    runner.run({
      label: 'Checking your design', inputs: [buildInput(task, architecture)], labels,
      onLevel: (_index, outcome) => {
        if (!outcome.ok) { setResult({ error: outcome.error, key: runKey }); return; }
        const build = evaluateBuild(task, architecture, outcome.measurements);
        setResult({ build, key: runKey });
        if (build.passed) learn.recordTask(lessonId, task.id);
      },
      onDone: () => undefined,
    });
  };
  const stale = result !== null && result.key !== key;
  return <section className="fz-buildcheck" aria-label="Exercise">
    <div className="fz-panel__head"><span className="fz-eyebrow">Exercise · {lessonTitle}</span>{done && <span className="fz-cstatus is-solved"><CircleCheck size={12} aria-hidden />Completed</span>}</div>
    <p className="fz-task__prompt"><Inline text={task.prompt} /></p>
    <dl className="fz-facts"><dt>Workload</dt><dd>{task.benchmark.rps.toLocaleString()} req/s · {task.benchmark.durationMs / 1000} s + {task.benchmark.drainMs / 1000} s drain · seed {task.benchmark.seed}</dd></dl>
    {task.overrides.length > 0 && <ul className="fz-brief__fixed">{task.overrides.map(override => <li key={override.reason}><Lock size={11} aria-hidden />{override.reason}</li>)}</ul>}
    <ul className="fz-crit">{task.checks.map(entry => {
      const measured = result && 'build' in result && !stale ? result.build.checks.find(item => item.label === entry.label) : undefined;
      return <li key={entry.label} className={measured ? measured.met ? 'is-pass' : 'is-fail' : 'is-pending'}>
        {measured ? measured.met ? <CircleCheck size={14} aria-label="Met" /> : <CircleX size={14} aria-label="Not met" /> : <span className="fz-crit__dot" aria-label="Not checked yet" />}
        <span>{entry.label}</span><b>{measured?.measured ?? ''}</b></li>;
    })}</ul>
    {result && 'error' in result && <div className="fz-alert is-bad" role="alert"><span>The simulation failed: {result.error}</span></div>}
    {result && 'build' in result && !stale && <div className={`fz-alert ${result.build.passed ? 'is-ok' : 'is-warn'}`} role="status"><span><b>{result.build.passed ? 'All checks met.' : result.build.complete ? 'Not yet.' : 'The run was incomplete.'}</b>
      {result.build.passed ? 'This task is marked complete in your learning progress.' : result.build.complete ? 'Change the design and check again.' : 'It hit the simulator’s event limit, so nothing is counted.'}</span></div>}
    {stale && <p className="fz-labmatch is-warn">The design changed since the last check.</p>}
    <div className="fz-brief__actions">
      <button className="fz-btn fz-btn--primary" disabled={running || !snapshot.nodes.length} onClick={check}>{running ? <LoaderCircle size={13} className="fz-spin" /> : <Play size={13} />}{running ? 'Checking…' : 'Check my design'}</button>
      <button className="fz-btn fz-btn--small" onClick={onBack}><ArrowLeft size={12} />Back to the lesson</button>
    </div>
    <details className="fz-labdetails"><summary>Hints</summary><ol className="fz-hints">{task.hints.map(hint => <li key={hint}>{hint}</li>)}</ol></details>
    <p className="fz-brief__note">The check runs the exercise’s own workload on the canvas, with the forced settings above. It does not change the lab benchmark, baseline or variants, and it is not a challenge submission.</p>
  </section>;
}
