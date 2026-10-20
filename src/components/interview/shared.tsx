import { useEffect, useRef, useState } from 'react';
import { BookOpen, Code2, FlaskConical, ListTree, MessagesSquare, Timer } from 'lucide-react';
import { byKind } from '../../app/catalog';
import { MODULES } from '../../learn/curriculum';
import { experimentById } from '../../learn/experiments';
import { problemById } from '../../interview';
import { type InterviewSession } from '../../interview/session';
import { clock, formatDuration } from '../../interview/workflow';
import type { Resource, StageId } from '../../interview/types';

const LESSON_TITLES = new Map(MODULES.flatMap(module => module.lessons.map(lesson => [lesson.id, { title: lesson.title, written: 'concept' in lesson }] as const)));
export const resourceLabel = (resource: Resource): string => {
  switch (resource.type) {
    case 'lesson': return `Lesson: ${LESSON_TITLES.get(resource.id)?.title ?? resource.id}`;
    case 'component': return `Guide: ${byKind[resource.kind].label}`;
    case 'lld': return `LLD: ${byKind[resource.kind].label}`;
    case 'experiment': return `Experiment: ${experimentById(resource.id)?.title ?? resource.id}`;
    case 'interview': return `Interview: ${problemById(resource.id)?.title ?? resource.id}`;
  }
};
const ICONS = { lesson: BookOpen, component: ListTree, lld: Code2, experiment: FlaskConical, interview: MessagesSquare } as const;
/** Links into Learn, the Playground and other interviews. Planned (unwritten) lessons are shown but not linked. */
export function ResourceLinks({ resources, onResource }: { resources: Resource[]; onResource: (resource: Resource) => void }) {
  if (!resources.length) return null;
  return <div className="fz-chips fz-iv-resources">{resources.map(resource => {
    const Icon = ICONS[resource.type]; const planned = resource.type === 'lesson' && LESSON_TITLES.get(resource.id)?.written === false;
    return planned ? <span key={JSON.stringify(resource)} className="fz-chip fz-chip--small is-muted" title="Planned lesson">{resourceLabel(resource)} · planned</span>
      : <button key={JSON.stringify(resource)} className="fz-chip" onClick={() => onResource(resource)}><Icon size={11} aria-hidden />{resourceLabel(resource)}</button>;
  })}</div>;
}

export const SCORE_LABELS = ['Missing or incorrect', 'Major gaps', 'Partial', 'Solid', 'Thorough'];
export function ScorePill({ score }: { score: number | null }) {
  return score === null ? <span className="fz-iv-score is-na" title="Not assessed">n/a</span> : <span className={`fz-iv-score is-${Math.round(score)}`} title={SCORE_LABELS[Math.round(score)]}>{Number.isInteger(score) ? score : score.toFixed(1)}/4</span>;
}

/**
 * Interview clock. Active time ticks locally (only this component re-renders) and is committed to the session every
 * 5 seconds, when the page is hidden, on stage change and on unmount, so a reload or navigation loses at most a few
 * seconds of timing and no answers. Time runs only while the page is visible. Running out of time never locks or
 * discards anything; the session records when it ran out.
 */
export function SessionClock({ session, onCommit }: { session: InterviewSession; onCommit: (ms: number, stage: StageId) => void }) {
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0); const stageRef = useRef(session.stage); const commitRef = useRef(onCommit); commitRef.current = onCommit;
  useEffect(() => {
    stageRef.current = session.stage;
    const commit = () => { if (pendingRef.current) commitRef.current(pendingRef.current, stageRef.current); pendingRef.current = 0; setPending(0); };
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      pendingRef.current += 1000; setPending(pendingRef.current);
      if (pendingRef.current >= 5_000) commit();
    }, 1000);
    const onHide = () => { if (document.visibilityState === 'hidden') commit(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onHide); commit(); };
  }, [session.stage, session.id]);
  const shown = clock({ ...session, timing: { totalMs: session.timing.totalMs + pending, stageMs: { ...session.timing.stageMs, [session.stage]: (session.timing.stageMs[session.stage] ?? 0) + pending } } });
  return <div className={`fz-iv-clock${shown.overtime ? ' is-over' : shown.stageOver ? ' is-stage-over' : ''}`} role="timer" aria-live="off">
    <Timer size={14} aria-hidden />
    {shown.limitMs !== null ? <><b>{shown.overtime ? `+${formatDuration(shown.elapsedMs - shown.limitMs)}` : formatDuration(shown.remainingMs!)}</b><span>{shown.overtime ? 'over time' : 'left'}</span>
      <span className="fz-iv-clock__stage">This stage {formatDuration(shown.stageMs)} / {formatDuration(shown.stageBudgetMs!)} suggested</span></>
      : <><b>{formatDuration(shown.elapsedMs)}</b><span>elapsed · no time limit in practice</span></>}
  </div>;
}

/** A labelled text area for an answer. */
export function Answer({ label, value, onChange, rows = 4, placeholder, hint }: { label: string; value: string; onChange: (value: string) => void; rows?: number; placeholder?: string; hint?: string }) {
  return <label className="fz-iv-answer"><span>{label}</span>{hint && <small>{hint}</small>}<textarea rows={rows} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>;
}
