import { useMemo, useState } from 'react';
import { CopyPlus, FileText } from 'lucide-react';
import { Breadcrumbs } from '../catalog/Shell';
import { byKind } from '../../app/catalog';
import { problemById } from '../../interview';
import { evaluationOf } from '../../interview/analytics';
import { type SessionEventType } from '../../interview/session';
import { formatDuration } from '../../interview/workflow';
import type { InterviewRecord } from '../../interview/store';
import { STAGES, STAGE_LABELS, type StageId } from '../../interview/types';
import type { InterviewController } from '../../interview/useInterviews';
import type { Resource } from '../../interview/types';
import { ChangeComparisonView, SnapshotView, WhiteboardView } from './Review';
import { ScorePill } from './shared';

type Filter = 'all' | 'questions' | 'design' | 'changes' | 'measured' | 'help';
const FILTERS: Array<[Filter, string, SessionEventType[]]> = [
  ['all', 'Everything', []],
  ['questions', 'Questions and answers', ['clarification', 'followup-asked', 'followup-submitted']],
  ['design', 'Checkpoints', ['checkpoint', 'restore']],
  ['changes', 'Requirement changes', ['change-introduced', 'change-revised', 'change-submitted']],
  ['measured', 'Measurements', ['benchmark', 'scenario']],
  ['help', 'Hints and references', ['hint', 'reference']],
];
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Interview playback: everything the record holds, in the order it happened. The record is read-only; loading a
 * checkpoint creates a new, separate draft and never touches this record or any other draft.
 */
export function PlaybackView({ record, ctl, onBack, onReport, onLoadDraft, onResource }: { record: InterviewRecord; ctl: InterviewController; onBack: () => void; onReport: (id: string) => void; onLoadDraft: (record: InterviewRecord, checkpointId?: string) => void; onResource: (resource: Resource) => void }) {
  const definition = problemById(record.definitionId);
  const session = record.session; const evaluation = evaluationOf(ctl.state, record);
  const [filter, setFilter] = useState<Filter>('all');
  const checkpoints = session.checkpoints;
  const [selected, setSelected] = useState<string>(checkpoints.length ? checkpoints[checkpoints.length - 1].id : 'final');
  const shownCheckpoint = selected === 'final' ? null : checkpoints.find(entry => entry.id === selected) ?? null;
  const architecture = shownCheckpoint ? shownCheckpoint.architecture : session.architecture;
  const events = useMemo(() => { const types = FILTERS.find(([id]) => id === filter)![2]; return session.events.filter(event => !types.length || types.includes(event.type)); }, [filter, session.events]);
  const stages = STAGES.filter(stage => stage !== 'changes' || session.plan?.stageMs.changes || session.timing.stageMs.changes || Object.keys(session.changes).length);
  const longest = Math.max(1, ...stages.map(stage => Math.max(session.timing.stageMs[stage] ?? 0, session.plan?.stageMs[stage] ?? 0)));
  const asked = Object.entries(session.followUps).sort((a, b) => a[1].askedAt - b[1].askedAt);
  const prompts = definition ? [...definition.followUps, ...definition.deepDives] : [];
  const titleOf = (id: string) => evaluation.followUps.find(entry => entry.id === id)?.title ?? prompts.find(entry => entry.id === id)?.title ?? id;
  const criterion = (id: string) => evaluation.criteria.find(entry => entry.id === id);
  const runs = [...(session.benchmark ? [{ key: 'benchmark', run: session.benchmark }] : []), ...Object.entries(session.scenarioRuns).map(([key, run]) => ({ key, run })), ...Object.entries(session.changes).flatMap(([key, entry]) => [entry.runs.original && { key: `${key}:original`, run: entry.runs.original }, entry.runs.revised && { key: `${key}:revised`, run: entry.runs.revised }].filter(Boolean) as Array<{ key: string; run: NonNullable<typeof session.benchmark> }>)];

  return <article className="fz-iv-report fz-iv-playback" aria-labelledby="fz-iv-playback-title">
    <header className="fz-iv-report__head fz-detail-hero">
      <div><Breadcrumbs crumbs={[{ label: 'Flowzen', onClick: onBack }, { label: 'Interview', onClick: onBack }, { label: `${record.title} playback` }]} />
        <span className="fz-eyebrow">{session.mode === 'mock' ? `Mock interview · ${session.durationMin} min` : 'Practice interview'} · {when(record.completedAt)}{record.finishedEarly ? ' · finished early' : ''}</span>
        <h1 id="fz-iv-playback-title">{record.title}: playback</h1>
        <p className="fz-brief__note">A read-only replay of the record: definition v{record.definitionVersion}, rubric v{record.evaluatorVersion}{record.referenceVersion ? `, reference v${record.referenceVersion}` : ''}. Loading a design creates a new draft; this record never changes.</p></div>
      <div className="fz-iv-overall"><b>{evaluation.overall.percent}%</b><span>final score</span><small>{formatDuration(session.timing.totalMs)} of interview time</small></div>
    </header>
    <div className="fz-brief__actions"><button className="fz-btn" onClick={() => onReport(record.id)}><FileText size={13} />Open the report</button></div>

    <section aria-labelledby="pb-time"><h2 id="pb-time">Time per stage</h2>
      <ul className="fz-iv-timebars">{stages.map(stage => { const spent = session.timing.stageMs[stage] ?? 0; const plan = session.plan?.stageMs[stage]; return <li key={stage}>
        <span>{STAGE_LABELS[stage]}</span>
        <span className="fz-iv-timebar" aria-hidden><span className={plan && spent > plan ? 'is-over' : ''} style={{ width: `${spent / longest * 100}%` }} />{plan ? <i style={{ left: `${plan / longest * 100}%` }} /> : null}</span>
        <small>{formatDuration(spent)}{plan ? ` of ${formatDuration(plan)} planned` : ''}</small></li>; })}</ul>
      {session.expired && <p className="fz-brief__note">Time ran out during {STAGE_LABELS[session.expired.stage]}; work continued as overtime.</p>}
    </section>

    <section aria-labelledby="pb-timeline"><h2 id="pb-timeline">Timeline</h2>
      {session.events.length === 0 ? <p className="fz-empty-note">This interview was recorded before timelines existed. Its answers, timing and evaluation are shown below.</p> : <>
        <div className="fz-chips" role="group" aria-label="Filter the timeline">{FILTERS.map(([id, label]) => <button key={id} className={`fz-chip${filter === id ? ' is-on' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</div>
        <ol className="fz-iv-timeline">{events.map((event, i) => <li key={`${event.at}-${i}`} className={`is-${event.type}`}>
          <time>{formatDuration(event.elapsedMs)}</time><span className="fz-tag">{STAGE_LABELS[event.stage as StageId] ?? event.stage}</span>
          <span>{event.type === 'followup-asked' || event.type === 'followup-submitted' ? `${event.type === 'followup-asked' ? 'Asked' : 'Answered'}: ${titleOf(event.ref ?? '')}` : event.label}</span>
          {event.type === 'checkpoint' && event.ref && <button className="fz-link" onClick={() => setSelected(event.ref!)}>View</button>}
        </li>)}</ol>
        {!events.length && <p className="fz-empty-note">Nothing of this kind happened.</p>}</>}
    </section>

    <section aria-labelledby="pb-req"><h2 id="pb-req">Requirements and assumptions</h2>
      <div className="fz-guide__grid">
        {(['functional', 'nonFunctional', 'scope', 'excluded'] as const).map(key => <section key={key}><h3>{{ functional: 'Functional', nonFunctional: 'Non-functional', scope: 'Scope and assumptions', excluded: 'Excluded' }[key]}</h3><p className="fz-prose__p fz-iv-pre">{session.requirements[key] || '—'}</p></section>)}
      </div>
      {session.clarificationsAsked.length > 0 && <><h3>Questions asked</h3><ul className="fz-prose__list">{session.clarificationsAsked.map(id => { const entry = definition?.clarifications.find(item => item.id === id); return <li key={id}><b>{entry?.question ?? id}</b>{entry && <> — {entry.answer}</>}</li>; })}</ul></>}
      {Object.keys(session.estimates).length > 0 && <><h3>Estimates</h3><ul className="fz-prose__list">{Object.entries(session.estimates).filter(([, value]) => value.trim()).map(([id, value]) => <li key={id}>{definition?.estimates.find(entry => entry.id === id)?.label ?? id}: {value}</li>)}</ul></>}
    </section>

    <section aria-labelledby="pb-arch"><h2 id="pb-arch">Architecture checkpoints</h2>
      <p className="fz-brief__note">Every saved checkpoint and the final design. Load any of them into a new editable draft; your current drafts, challenge attempts and Playground work are not affected.</p>
      <div className="fz-chips" role="group" aria-label="Choose a checkpoint">
        {checkpoints.map(checkpoint => <button key={checkpoint.id} className={`fz-chip${selected === checkpoint.id ? ' is-on' : ''}`} aria-pressed={selected === checkpoint.id} onClick={() => setSelected(checkpoint.id)}>{checkpoint.label}</button>)}
        <button className={`fz-chip${selected === 'final' ? ' is-on' : ''}`} aria-pressed={selected === 'final'} onClick={() => setSelected('final')}>Final design</button>
      </div>
      {architecture ? <>
        <SnapshotView id={`pb-${selected}`} title={shownCheckpoint ? shownCheckpoint.label : 'Final design'} caption={shownCheckpoint ? `Saved ${new Date(shownCheckpoint.at).toLocaleTimeString()} during ${STAGE_LABELS[shownCheckpoint.stage]}.` : 'The design as submitted.'} architecture={architecture} />
        <ul className="fz-iv-decisions is-compact">{architecture.nodes.filter(node => node.kind !== 'client').map(node => { const note = (shownCheckpoint ? shownCheckpoint.decisions : session.decisions)[node.id]; return <li key={node.id}><span><b>{node.label || byKind[node.kind].label}</b> <em>{byKind[node.kind].label}</em></span><p className="fz-prose__p">{note || <em>No decision note.</em>}</p></li>; })}</ul>
        <button className="fz-btn fz-btn--primary" disabled={!definition} onClick={() => onLoadDraft(record, shownCheckpoint?.id)}><CopyPlus size={13} />Load {shownCheckpoint ? 'this checkpoint' : 'the final design'} as a new draft</button>
      </> : <p className="fz-empty-note">No architecture was designed.</p>}
    </section>

    <section aria-labelledby="pb-fu"><h2 id="pb-fu">Follow-up questions</h2>
      {!asked.length ? <p className="fz-empty-note">No follow-up questions were asked.</p> : <ol className="fz-iv-pbqa">{asked.map(([id, entry]) => { const result = criterion(`fu-${id}`); return <li key={id}>
        <div className="fz-iv-pbqa__head"><b>{titleOf(id)}</b>{result && <ScorePill score={result.score} />}<small>asked at {new Date(entry.askedAt).toLocaleTimeString()}{entry.submittedAt ? `, answered at ${new Date(entry.submittedAt).toLocaleTimeString()}` : ', not answered'}</small></div>
        {entry.reason && <p className="fz-iv-because">Why it was asked: {entry.reason}</p>}
        <p className="fz-prose__p fz-iv-pre">{entry.answer || <em>No answer.</em>}</p>
        {result && result.missed.length > 0 && <p className="fz-brief__note">Not covered: {result.missed.join('; ')}.</p>}
      </li>; })}</ol>}
    </section>

    {evaluation.changes?.some(entry => entry.introduced) && <section aria-labelledby="pb-changes"><h2 id="pb-changes">Requirement changes</h2>
      {evaluation.changes.filter(entry => entry.introduced).map(entry => <article key={entry.id} className="fz-iv-card"><h3>{entry.title}</h3>
        <div className="fz-chips">{entry.baselineId && <button className="fz-chip" onClick={() => setSelected(entry.baselineId!)}>View the original</button>}{entry.revisionId && <button className="fz-chip" onClick={() => setSelected(entry.revisionId!)}>View the revision</button>}</div>
        <ChangeComparisonView comparison={entry} /><h4>Response</h4><p className="fz-prose__p fz-iv-pre">{session.changes[entry.id]?.answer || <em>No response.</em>}</p></article>)}</section>}

    <section aria-labelledby="pb-measured"><h2 id="pb-measured">Measured results</h2>
      {!runs.length ? <p className="fz-empty-note">Nothing was measured in this interview.</p> : <table className="fz-table fz-iv-table"><thead><tr><th scope="col">Run</th><th scope="col">p95</th><th scope="col">Succeeded</th><th scope="col">Busiest</th><th scope="col">When</th></tr></thead>
        <tbody>{runs.map(({ key, run }) => <tr key={key}><th scope="row">{run.label}</th><td>{run.p95 ?? '—'} ms</td><td>{run.successPct.toFixed(1)}%</td><td>{run.busiest ? `${run.busiest.label} ${Math.round(run.busiest.utilization * 100)}%` : '—'}</td><td>{new Date(run.at).toLocaleTimeString()}</td></tr>)}</tbody></table>}
      {record.benchmark && <p className="fz-brief__note">Benchmark settings recorded with the interview: {record.benchmark.rps.toLocaleString()} req/s for {record.benchmark.durationMs / 1000} s, seed {record.benchmark.seed}; targets p95 ≤ {record.benchmark.targets.p95Ms} ms, ≥ {record.benchmark.targets.minSuccessPct}%.</p>}
    </section>

    {evaluation.whiteboard && <section aria-labelledby="pb-wb"><h2 id="pb-wb">Findings on the final design</h2><WhiteboardView review={evaluation.whiteboard} actions onResource={onResource} compact /></section>}

    <section aria-labelledby="pb-final"><h2 id="pb-final">Final score and competencies</h2>
      <ul className="fz-iv-bars">{evaluation.competencies.map(entry => <li key={entry.id}><span>{entry.label}</span><span className="fz-bar"><span style={{ width: `${entry.percent ?? 0}%` }} /></span><ScorePill score={entry.score} /></li>)}</ul>
    </section>
  </article>;
}
