import { Fragment, useState } from 'react';
import { ArrowLeft, BookOpen, Circle, CircleCheck, CircleDot, CircleHelp, CircleX, Clock, Code2, FileText, GitCompareArrows, Lightbulb, LoaderCircle, Lock, Send, TriangleAlert, X } from 'lucide-react';
import { byKind, type Kind } from '../app/catalog';
import { DIFFICULTY_LABELS, DIFFICULTY_POINTS, type Challenge, type Criterion } from '../challenges/definitions';
import { categoryOf, type CriterionResult, type Grade } from '../challenges/grading';
import type { ChallengeProgress } from '../challenges/progress';
import { parseAttemptRecord } from '../challenges/attempts';

const fmt = (value: number, digits = 1) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
export const formatMeasured = (entry: Pick<CriterionResult, 'measured' | 'unit'>) => entry.measured === null ? '—' : `${fmt(entry.measured, entry.unit === '%' ? 2 : 1)}${entry.unit === '%' ? '%' : entry.unit ? ` ${entry.unit}` : ''}`;
export const CriterionIcon = ({ status }: { status: CriterionResult['status'] | 'pending' }) =>
  status === 'pass' ? <CircleCheck size={14} aria-label="Passed" /> : status === 'fail' ? <CircleX size={14} aria-label="Failed" /> : status === 'unsupported' ? <CircleHelp size={14} aria-label="Unsupported" /> : status === 'unavailable' ? <TriangleAlert size={14} aria-label="Not measurable" /> : <span className="fz-crit__dot" aria-label="Not measured yet" />;
const time = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

type Props = {
  challenge: Challenge; entry: ChallengeProgress | undefined; preview: Grade | null; previewStale: boolean;
  grading: boolean; gradingError: string | null; onDismissError: () => void;
  onSubmit: () => void; onShowResult: () => void; hasResult: boolean; onBack: () => void;
  kindsOnCanvas: Set<Kind>; onOpenDesign: (kind: Kind) => void;
  onReviewAttempt: (number: number) => void; onCompareAttempts: () => void;
  /** Lessons whose concepts this challenge tests, with the learner's status. Opening one keeps the draft. */
  lessons?: Array<{ id: string; title: string; status: 'not-started' | 'in-progress' | 'completed' }>; onOpenLesson?: (id: string) => void;
};

function CriteriaList({ criteria, preview, previewStale }: { criteria: Criterion[]; preview: Grade | null; previewStale: boolean }) {
  return <ul className="fz-crit">
    {criteria.map(criterion => {
      const measured = preview?.criteria.find(item => item.id === criterion.id); const status = measured && !previewStale ? measured.status : 'pending';
      return <li key={criterion.id} className={`is-${status}${criterion.mandatory ? '' : ' is-optional'}`}>
        <CriterionIcon status={status} />
        <span>{criterion.label}{!criterion.mandatory && <em> · informational</em>}</span>
        <b>{measured && !previewStale ? formatMeasured(measured) : ''}</b>
      </li>;
    })}
  </ul>;
}

/** The problem, its benchmark and acceptance criteria, shown next to the canvas while solving. */
export function ChallengePanel({ challenge, entry, preview, previewStale, grading, gradingError, onDismissError, onSubmit, onShowResult, hasResult, onBack, kindsOnCanvas, onOpenDesign, onReviewAttempt, onCompareAttempts, lessons = [], onOpenLesson }: Props) {
  const [allAttempts, setAllAttempts] = useState(false);
  const [hintsShown, setHintsShown] = useState(0);
  const { workload } = challenge;
  const runtime = challenge.criteria.filter(criterion => categoryOf(criterion) === 'runtime');
  const architecture = challenge.criteria.filter(criterion => categoryOf(criterion) === 'architecture');
  const mandatory = challenge.criteria.filter(criterion => criterion.mandatory).length;
  // Retained attempts, newest first, numbered as stored (older entries fall back to their position).
  const retained = (entry?.history ?? []).map((attempt, index) => ({ attempt, number: attempt.number ?? index + 1, reviewable: parseAttemptRecord(attempt.record).status === 'ok' })).reverse();
  const attempts = allAttempts ? retained : retained.slice(0, 5);
  const comparable = retained.filter(item => item.reviewable).length >= 2;
  return <div className="fz-inspector__body fz-brief">
    <div className="fz-panel__head">
      <button className="fz-btn fz-btn--small" onClick={onBack}><ArrowLeft size={13} />All challenges</button>
      <span className={`fz-diff-pill is-${challenge.difficulty}`}>{DIFFICULTY_LABELS[challenge.difficulty]} · {DIFFICULTY_POINTS[challenge.difficulty]} pts</span>
    </div>
    <h2 className="fz-brief__title">{challenge.number}. {challenge.title}{entry?.solved && <span className="fz-cstatus is-solved"><CircleCheck size={13} aria-hidden />Solved</span>}</h2>
    <p className="fz-brief__meta"><Clock size={12} aria-hidden />About {challenge.estimatedMinutes} min (estimate)</p>
    <p className="fz-brief__text">{challenge.statement}</p>
    <p className="fz-brief__text is-muted">{challenge.scenario}</p>
    {challenge.completion && <div className="fz-alert is-ok fz-brief__completion"><span><b>Completion semantics</b>{challenge.completion}</span></div>}
    <ul className="fz-brief__topics" aria-label="Topics tested">{challenge.topics.map(topic => <li key={topic} className="fz-chip fz-chip--small">{topic}</li>)}</ul>

    <h3 className="fz-section-title">What you’ll learn</h3>
    <ul className="fz-brief__reqs">{challenge.learningObjectives.map(item => <li key={item}>{item}</li>)}</ul>
    {lessons.length > 0 && onOpenLesson && <>
      <h3 className="fz-section-title"><span><BookOpen size={13} aria-hidden /> Concepts tested</span><small>lessons</small></h3>
      <ul className="fz-brief__lessons">{lessons.map(lesson => <li key={lesson.id} className={`is-${lesson.status}`}>
        {lesson.status === 'completed' ? <CircleCheck size={13} aria-label="Completed" /> : lesson.status === 'in-progress' ? <CircleDot size={13} aria-label="In progress" /> : <Circle size={13} aria-label="Not started" />}
        <button className="fz-link" onClick={() => onOpenLesson(lesson.id)}>{lesson.title}</button></li>)}</ul>
      <p className="fz-brief__note">Opening a lesson keeps this challenge’s draft and attempts.</p>
    </>}

    <h3 className="fz-section-title">Requirements</h3>
    <h4 className="fz-subtitle">Functional</h4>
    <ul className="fz-brief__reqs">{challenge.functional.map(item => <li key={item}>{item}</li>)}</ul>
    <h4 className="fz-subtitle">Non-functional <em>checked by the criteria below</em></h4>
    <ul className="fz-brief__reqs">{challenge.requirements.map(item => <li key={item}>{item}</li>)}</ul>

    <h3 className="fz-section-title">Benchmark <small>seed {workload.seed}</small></h3>
    <dl className="fz-facts fz-brief__workload">
      <dt>Offered traffic</dt><dd>{fmt(workload.rps, 0)} req/s</dd>
      <dt>Traffic window</dt><dd>{fmt((workload.trafficDurationMs ?? workload.durationMs) / 1000)} s</dd>
      <dt>Run length</dt><dd>{fmt(workload.durationMs / 1000)} s</dd>
      <dt>Pattern</dt><dd className="is-text">{workload.pattern}</dd>
      {workload.faults.map(fault => <Fragment key={fault.nodeId}><dt>Failure</dt><dd className="is-text">{fault.description}</dd></Fragment>)}
    </dl>
    <p className="fz-brief__note">Fixed for every practice run and submission. The toolbar’s traffic and duration are ignored here.</p>
    {workload.overrides.length > 0 && <ul className="fz-brief__fixed">{workload.overrides.map(override => <li key={override.reason}><Lock size={11} aria-hidden />{override.reason}</li>)}</ul>}
    {Object.values(challenge.fixtures).length > 0 && <ul className="fz-brief__fixed">{Object.values(challenge.fixtures).map(fixture => <li key={fixture.label}><Lock size={11} aria-hidden /><b>{fixture.label}</b>: {fixture.description}</li>)}</ul>}

    <h3 className="fz-section-title">Acceptance criteria <small>{preview ? (previewStale ? 'last run · outdated' : 'last practice run') : 'run to measure'}</small></h3>
    <p className="fz-brief__note"><b>Pass rule:</b> all {mandatory} mandatory criteria must pass. A criterion that cannot be measured never passes.</p>
    <h4 className="fz-subtitle">Runtime <em>measured from the benchmark run</em></h4>
    <CriteriaList criteria={runtime} preview={preview} previewStale={previewStale} />
    {architecture.length > 0 && <><h4 className="fz-subtitle">Architecture <em>checked on the design</em></h4><CriteriaList criteria={architecture} preview={preview} previewStale={previewStale} /></>}
    {preview?.invalidReason && !previewStale && <div className="fz-alert is-warn"><span>{preview.invalidReason}</span></div>}
    <p className="fz-brief__note">Run plays the benchmark as practice without recording it. Submit grades the same benchmark separately: your practice results and playback are left as they are.</p>
    <div className="fz-brief__actions">
      <button className="fz-btn fz-btn--primary" onClick={onSubmit} disabled={grading}>{grading ? <LoaderCircle size={14} className="fz-spin" /> : <Send size={14} />}{grading ? 'Grading…' : 'Submit solution'}</button>
      {hasResult && <button className="fz-btn" onClick={onShowResult}>Last result</button>}
    </div>
    {gradingError && <div className="fz-alert is-bad" role="alert"><span>Grading failed: {gradingError}</span><button className="fz-icon-btn" onClick={onDismissError} aria-label="Dismiss"><X size={13} /></button></div>}

    {attempts.length > 0 && <>
      <h3 className="fz-section-title">Your attempts <small>{retained.length} retained · {entry!.attempts} total</small></h3>
      <ol className="fz-attempts">{attempts.map(({ attempt, number, reviewable }) => <li key={`${attempt.at}-${number}`} className={attempt.passed ? 'is-pass' : 'is-fail'}>
        <b>#{number} {attempt.passed ? 'PASS' : 'FAIL'}</b><span>{attempt.criteriaPassed}/{attempt.criteriaTotal} criteria</span>
        <button className="fz-link" onClick={() => onReviewAttempt(number)} aria-label={`Review attempt ${number}`}>{reviewable ? 'Review' : 'Summary'}</button>
        <time dateTime={new Date(attempt.at).toISOString()}>{attempt.p95 === null ? 'p95 —' : `p95 ${fmt(attempt.p95)} ms`} · {time(attempt.at)}</time>
        {entry!.best?.at === attempt.at && <em>best</em>}
      </li>)}</ol>
      <div className="fz-brief__actions">
        {retained.length > 5 && <button className="fz-btn fz-btn--small" onClick={() => setAllAttempts(all => !all)}>{allAttempts ? 'Show latest 5' : `Show all ${retained.length}`}</button>}
        {comparable && <button className="fz-btn fz-btn--small" onClick={onCompareAttempts}><GitCompareArrows size={12} />Compare attempts</button>}
      </div>
      <p className="fz-brief__note">The last 20 attempts are kept, each with the architecture and benchmark it was graded on.</p>
    </>}

    <h3 className="fz-section-title">Hints <small>{hintsShown}/{challenge.hints.length} shown</small></h3>
    <p className="fz-brief__note">Hints are optional and separate from grading.</p>
    <ol className="fz-hints">{challenge.hints.slice(0, hintsShown).map(hint => <li key={hint}>{hint}</li>)}</ol>
    {hintsShown < challenge.hints.length && <button className="fz-btn fz-btn--small" onClick={() => setHintsShown(count => count + 1)}><Lightbulb size={13} />Reveal hint {hintsShown + 1}</button>}

    <h3 className="fz-section-title">Related designs <small>LLD</small></h3>
    <div className="fz-chips">{challenge.relatedDesigns.map(kind => {
      const present = kindsOnCanvas.has(kind);
      return <button key={kind} className="fz-chip is-design" disabled={!present} onClick={() => onOpenDesign(kind)}
        title={present ? `Select a ${byKind[kind].label} and open its low-level design` : `Add a ${byKind[kind].label} to the canvas to explore its design`}><Code2 size={11} aria-hidden />{byKind[kind].label}</button>;
    })}</div>
    <p className="fz-brief__note">The low-level designs are illustrative Java. They explain the concepts; they do not change simulation results.</p>
  </div>;
}

/** Shown above the inspector during a challenge, so the brief and criteria stay one click away. */
export function ChallengeStrip({ challenge, preview, previewStale, grading, onOpenBrief }: { challenge: Challenge; preview: Grade | null; previewStale: boolean; grading: boolean; onOpenBrief: () => void }) {
  const mandatory = challenge.criteria.filter(criterion => criterion.mandatory);
  const passed = preview && !previewStale ? preview.criteria.filter(entry => entry.mandatory && entry.status === 'pass').length : null;
  return <div className="fz-cstrip" role="region" aria-label="Current challenge">
    <span className="fz-cstrip__title">{challenge.number}. {challenge.title}</span>
    <span className="fz-cstrip__state">{grading ? 'Grading…' : passed === null ? 'Not measured yet' : `${passed}/${mandatory.length} criteria in last practice run`}</span>
    <button className="fz-btn fz-btn--small" onClick={onOpenBrief}><FileText size={12} />Brief</button>
  </div>;
}
