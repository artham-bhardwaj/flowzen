import { useEffect, useRef } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, BookOpen, Gauge, GitCompareArrows, History, ListChecks, RotateCcw, Search, X } from 'lucide-react';
import { DIFFICULTY_POINTS, type Challenge } from '../challenges/definitions';
import type { CriterionResult, Finding, Grade } from '../challenges/grading';
import type { AttemptSummary } from '../challenges/progress';
import { CriterionIcon, formatMeasured } from './ChallengePanel';
import { StatusIcon } from './status';

const fmt = (value: number | null, digits = 1) => value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const unitText = (unit: string) => unit === '%' ? '%' : unit ? ` ${unit}` : '';
/** A gap between two percentages is in percentage points, not a percentage. */
const gapText = (unit: string) => unit === '%' ? ' pts' : unitText(unit);
const STATUS_TEXT = { pass: 'Pass', fail: 'Fail', unsupported: 'Unsupported', unavailable: 'Not measurable' } as const;

/** Change versus an earlier attempt, phrased by whether it moved toward the requirement. */
function Delta({ now, before, lowerIsBetter, unit }: { now: number | null; before: number | null | undefined; lowerIsBetter: boolean; unit: string }) {
  if (before === undefined) return <span className="fz-delta">—</span>;
  if (now === null || before === null || now === before) return <span className="fz-delta">no change</span>;
  const improved = lowerIsBetter ? now < before : now > before; const Icon = now > before ? ArrowUpRight : ArrowDownRight;
  return <span className={`fz-delta ${improved ? 'is-better' : 'is-worse'}`} title={`was ${fmt(before, 2)}${unitText(unit)}`}><Icon size={12} aria-hidden />{fmt(Math.abs(now - before), 2)}{unit === '%' ? ' pts' : unitText(unit)}</span>;
}

function FindingView({ finding, main }: { finding: Finding; main?: boolean }) {
  return <li className={`fz-finding is-${finding.severity}${main ? ' is-main' : ''}`}>
    <b>{finding.title}</b>
    {finding.evidence.length > 0 && <ul>{finding.evidence.map(item => <li key={item}>{item}</li>)}</ul>}
  </li>;
}

type CriteriaProps = { title: string; note: string; entries: CriterionResult[]; previous: AttemptSummary | undefined; best: AttemptSummary | undefined };
function CriteriaTable({ title, note, entries, previous, best }: CriteriaProps) {
  if (!entries.length) return null;
  const before = (attempt: AttemptSummary | undefined, id: string) => attempt ? attempt.criteria.find(entry => entry.id === id)?.measured ?? null : undefined;
  return <>
    <h4 className="fz-subtitle">{title} <em>{note}</em></h4>
    <table className="fz-table fz-results__table">
      <thead><tr><th scope="col">Criterion</th><th scope="col">Measured</th><th scope="col">Required</th><th scope="col">Result</th><th scope="col">vs previous</th><th scope="col">vs best</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.id} className={`is-${entry.status}`}>
        <th scope="row"><span className="fz-results__crit">{entry.label}{!entry.mandatory && <em>informational</em>}</span><small>{entry.detail}</small></th>
        <td>{formatMeasured(entry)}</td>
        <td>{`${entry.comparator} ${fmt(entry.threshold, 2)}${unitText(entry.unit)}`}</td>
        <td><span className={`fz-result is-${entry.status}`}><CriterionIcon status={entry.status} />{STATUS_TEXT[entry.status]}</span>
          {entry.missedBy !== null && <small className="fz-missed">missed by {fmt(entry.missedBy, 2)}{gapText(entry.unit)}</small>}</td>
        <td><Delta now={entry.measured} before={before(previous, entry.id)} lowerIsBetter={entry.comparator.startsWith('<')} unit={entry.unit} /></td>
        <td><Delta now={entry.measured} before={before(best, entry.id)} lowerIsBetter={entry.comparator.startsWith('<')} unit={entry.unit} /></td>
      </tr>)}</tbody>
    </table>
  </>;
}

type Props = {
  challenge: Challenge; grade: Grade; previous: AttemptSummary | undefined; best: AttemptSummary | undefined; newlySolved: boolean;
  onClose: () => void; onInspect: () => void; onBackToList: () => void;
  /** Number of this attempt in the challenge's history, when it was recorded with one. */
  attemptNumber?: number; canCompare: boolean; onReview: (number: number) => void; onCompare: () => void;
  /** Lessons that explain a criterion, linked from the improvement advice. Opening one keeps the challenge draft. */
  lessonsFor?: (criterionId: string) => Array<{ id: string; title: string }>; onOpenLesson?: (id: string) => void;
};

export function ResultsDialog({ challenge, grade, previous, best, newlySolved, onClose, onInspect, onBackToList, attemptNumber, canCompare, onReview, onCompare, lessonsFor, onOpenLesson }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const mandatory = grade.criteria.filter(entry => entry.mandatory);
  const failed = mandatory.filter(entry => entry.status !== 'pass');
  const summary = grade.summary; const main = grade.mainBottleneck;
  const others = grade.findings.filter(finding => finding !== main);
  return <div className="fz-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="fz-dialog fz-results" role="dialog" aria-modal="true" aria-labelledby="fz-results-title" ref={dialog}>
      <div className="fz-dialog__head">
        <div className={`fz-verdict ${grade.passed ? 'is-pass' : 'is-fail'}`}>
          <span className="fz-verdict__badge">{grade.passed ? 'PASS' : 'FAIL'}</span>
          <div><h2 id="fz-results-title">{challenge.title}</h2>
            <span>{grade.passed ? (newlySolved ? `Solved: +${DIFFICULTY_POINTS[challenge.difficulty]} points` : 'All mandatory criteria met') : `${failed.length} of ${mandatory.length} mandatory criteria not met. Not solved.`}</span>
          </div>
        </div>
        <button className="fz-icon-btn" onClick={onClose} aria-label="Close results"><X size={15} /></button>
      </div>
      {grade.invalidReason && <div className="fz-alert is-bad"><span><b>Runtime criteria could not be evaluated</b>{grade.invalidReason}</span></div>}

      {grade.findings.length > 0 && <>
        <h3 className="fz-section-title"><span><Search size={14} aria-hidden /> Why it performed this way</span><small>from the benchmark’s traces and metrics</small></h3>
        <ul className="fz-findings">
          {main && <FindingView finding={main} main />}
          {others.map(finding => <FindingView key={finding.title} finding={finding} />)}
        </ul>
      </>}

      <h3 className="fz-section-title"><span><ListChecks size={14} aria-hidden /> Acceptance criteria</span><small>{previous ? 'compared with your previous and best attempts (before this one)' : 'first attempt'}</small></h3>
      <CriteriaTable title="Runtime" note="measured from the benchmark run" entries={grade.criteria.filter(entry => entry.category === 'runtime')} previous={previous} best={best} />
      <CriteriaTable title="Architecture" note="checked on the design" entries={grade.criteria.filter(entry => entry.category === 'architecture')} previous={previous} best={best} />

      {summary && <>
        <h3 className="fz-section-title"><span><Gauge size={14} aria-hidden /> Performance</span><small>engine · benchmark seed {challenge.workload.seed}</small></h3>
        <div className="fz-kpis fz-results__kpis">
          <div className="fz-kpi"><span>Latency p50 · p95 · p99</span><b>{fmt(summary.p50)} · {fmt(summary.p95)} · {fmt(summary.p99)} ms</b>{best && <small>best p95: {fmt(best.p95)} ms</small>}</div>
          <div className="fz-kpi"><span>Successful throughput</span><b>{fmt(summary.successThroughput)} req/s</b><small>of {fmt(summary.offeredRps, 0)} req/s offered ({fmt(summary.offeredRequests, 0)} requests)</small></div>
          <div className="fz-kpi"><span>Error rate</span><b>{fmt(summary.errorRate, 2)}%</b><small>{fmt(summary.failedRequests, 0)} failed</small></div>
        </div>
        <ul className="fz-results__util" aria-label="Component utilization">{summary.utilization.slice(0, 6).map(entry => <li key={entry.id}><span>{entry.label}</span><span className="fz-bar"><span style={{ width: `${Math.min(100, entry.utilization * 100)}%` }} /></span><b>{fmt(entry.utilization * 100, 0)}%</b><small>{entry.maxQueueDepth ? `max queue ${fmt(entry.maxQueueDepth, 0)}` : ''}</small></li>)}</ul>
      </>}

      <h3 className="fz-section-title">Architecture validation <small>static, before the run</small></h3>
      <div className="fz-status-counts">{(['functional', 'warning', 'dead'] as const).map(status => <span key={status} className={`status-${status}`}><StatusIcon status={status} /><b>{grade.validation.counts[status]}</b>{status}</span>)}</div>
      {grade.validation.issues.length > 0 ? <ul className="fz-results__list">{grade.validation.issues.slice(0, 5).map((issue, i) => <li key={i} className={`sev-${issue.severity}`}>{issue.message}</li>)}</ul>
        : <p className="fz-empty-note">No validation issues. Any failures above happened at runtime.</p>}

      {failed.length > 0 && <>
        <h3 className="fz-section-title">How to improve</h3>
        <ul className="fz-results__list">{failed.map(entry => { const lessons = lessonsFor?.(entry.id) ?? []; return <li key={entry.id}><b>{entry.label}</b>{entry.missedBy !== null ? ` (missed by ${fmt(entry.missedBy, 2)}${gapText(entry.unit)})` : entry.status === 'unavailable' ? ' (could not be measured)' : ''}: {entry.advice ?? entry.detail}
          {lessons.length > 0 && onOpenLesson && <span className="fz-results__learn"><BookOpen size={12} aria-hidden />Review: {lessons.map((lesson, i) => <span key={lesson.id}>{i > 0 && ' · '}<button className="fz-link" onClick={() => onOpenLesson(lesson.id)}>{lesson.title}</button></span>)}</span>}</li>; })}</ul>
        <p className="fz-brief__note">Progressive hints are in the challenge brief. Your architecture is kept exactly as you submitted it.</p>
      </>}

      <div className="fz-dialog__actions">
        <button className="fz-btn" onClick={onBackToList}>All challenges</button>
        {attemptNumber !== undefined && <button className="fz-btn" onClick={() => onReview(attemptNumber)}><History size={14} />Review attempt #{attemptNumber}</button>}
        {canCompare && <button className="fz-btn" onClick={onCompare}><GitCompareArrows size={14} />Compare with previous</button>}
        <button className="fz-btn" onClick={onInspect} title="Replaces your current practice run in playback and metrics"><Activity size={14} />Load benchmark run into playback</button>
        <button className="fz-btn fz-btn--primary" onClick={onClose} data-autofocus><RotateCcw size={14} />{grade.passed ? 'Keep practicing' : 'Try again'}</button>
      </div>
    </div>
  </div>;
}
