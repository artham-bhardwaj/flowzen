import { useState } from 'react';
import { CircleAlert, CopyPlus, PlayCircle, RotateCcw } from 'lucide-react';
import { Breadcrumbs } from '../catalog/Shell';
import { byKind } from '../../app/catalog';
import { PROBLEMS, problemById } from '../../interview';
import { evaluationOf, recommendations } from '../../interview/analytics';
import { SCALE, type Basis, type CriterionResult } from '../../interview/evaluate';
import { formatDuration } from '../../interview/workflow';
import type { InterviewRecord } from '../../interview/store';
import { referenceFor } from '../../interview/references';
import { STAGES, STAGE_ALLOCATION, STAGE_LABELS, type InterviewDefinition, type ReferenceDesign, type Resource } from '../../interview/types';
import type { InterviewController } from '../../interview/useInterviews';
import { DiagramView } from '../learn/Rich';
import { ChangeComparisonView, DecisionRubricView, WhiteboardView } from './Review';
import { ResourceLinks, ScorePill } from './shared';

const BASIS: Record<Basis, string> = { structural: 'Structural', measured: 'Measured', arithmetic: 'Arithmetic', keyword: 'Keyword-based' };
const BASIS_HELP: Record<Basis, string> = {
  structural: 'read from your architecture, its validation, or which fields you filled in',
  measured: 'from an isolated simulation of your architecture',
  arithmetic: 'checked numerically against documented tolerances and your own inputs',
  keyword: 'required concepts recognised in your text; this checks vocabulary, not understanding',
};
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
type Props = { record: InterviewRecord; ctl: InterviewController; onBack: () => void; onResource: (resource: Resource) => void; onStartFrom: (record: InterviewRecord) => void; onRetry: (definitionId: string) => void; onOpenProblem: (id: string) => void; onPlayback: (recordId: string) => void };

/** The evaluation report of an immutable interview record, with separately stored corrections. */
export function ReportView({ record, ctl, onBack, onResource, onStartFrom, onRetry, onOpenProblem, onPlayback }: Props) {
  const definition = problemById(record.definitionId);
  const auto = record.evaluation; const corrections = ctl.state.corrections[record.id] ?? [];
  const shown = evaluationOf(ctl.state, record); const corrected = corrections.some(entry => entry.score !== null);
  const recs = recommendations(shown, null, PROBLEMS, ctl.state, record.definitionId);
  const strongest = shown.competencies.filter(entry => entry.score !== null && entry.score >= 3.25);
  const weakest = shown.competencies.filter(entry => entry.score !== null && entry.score < 2.5);
  const session = record.session;
  return <article className="fz-iv-report" aria-labelledby="fz-iv-report-title">
    <header className="fz-iv-report__head fz-detail-hero">
      <div><Breadcrumbs crumbs={[{ label: 'Flowzen', onClick: onBack }, { label: 'Interview', onClick: onBack }, { label: `${record.title} report` }]} /><span className="fz-eyebrow">{session.mode === 'mock' ? 'Mock interview' : 'Practice interview'} · {when(record.completedAt)}{record.finishedEarly ? ' · finished early' : ''}</span>
        <h1 id="fz-iv-report-title">{record.title}</h1>
        <p className="fz-brief__note">Definition v{record.definitionVersion} · evaluator v{record.evaluatorVersion}{definition && definition.version !== record.definitionVersion ? ` · the problem has since changed to v${definition.version}; this report keeps the version it was graded with` : ''}. This is a structured, rule-based evaluation, not an AI interviewer. The record is read-only.</p></div>
      <div className="fz-iv-overall"><b>{auto.overall.percent}%</b><span>automatic score</span>{corrected && <><b className="is-corrected">{shown.overall.percent}%</b><span>with your corrections</span></>}
        <small>{auto.overall.assessed} criteria assessed{auto.overall.notAssessed ? `, ${auto.overall.notAssessed} not assessed` : ''}</small></div>
    </header>
    <div className="fz-brief__actions">
      <button className="fz-btn fz-btn--primary" onClick={() => onStartFrom(record)}><CopyPlus size={13} />New session from this one</button>
      <button className="fz-btn" onClick={() => onPlayback(record.id)}><PlayCircle size={13} />Play back this interview</button>
      <button className="fz-btn" onClick={() => onRetry(record.definitionId)}><RotateCcw size={13} />Start fresh</button>
    </div>
    <p className="fz-brief__note">A new session copies your answers and architecture into a fresh, editable draft. This record never changes.</p>

    <section aria-labelledby="iv-comp"><h2 id="iv-comp">Competencies</h2>
      <ul className="fz-iv-bars">{shown.competencies.map(entry => <li key={entry.id}><span>{entry.label}</span><span className="fz-bar"><span style={{ width: `${entry.percent ?? 0}%` }} /></span><ScorePill score={entry.score} /></li>)}</ul>
      <div className="fz-guide__grid">
        <div><h3>Strongest</h3>{strongest.length ? <ul className="fz-prose__list">{strongest.map(entry => <li key={entry.id}>{entry.label}</li>)}</ul> : <p className="fz-empty-note">No competency reached 3.25 / 4.</p>}</div>
        <div><h3>Needs work</h3>{weakest.length ? <ul className="fz-prose__list">{weakest.map(entry => <li key={entry.id}>{entry.label}</li>)}</ul> : <p className="fz-empty-note">No competency below 2.5 / 4.</p>}</div>
      </div>
    </section>

    <section aria-labelledby="iv-req"><h2 id="iv-req">Requirements you missed</h2>
      {shown.missedRequirements.length ? <ul className="fz-prose__list">{shown.missedRequirements.map(entry => <li key={entry.label}><b>{entry.label}</b>{entry.critical && <em className="fz-tag">critical</em>} — {entry.why}</li>)}</ul> : <p className="fz-empty-note">None: every expected requirement was identified.</p>}
    </section>

    <section aria-labelledby="iv-est"><h2 id="iv-est">Capacity estimation</h2>
      <table className="fz-table fz-iv-table"><thead><tr><th scope="col">Quantity</th><th scope="col">Yours</th><th scope="col">Reference</th><th scope="col">Assessment</th></tr></thead>
        <tbody>{shown.estimates.map(row => <tr key={row.quantity.id} className={`is-${row.status}`}><th scope="row">{row.quantity.label}</th><td>{row.value === null ? '—' : row.value.toLocaleString()}</td><td>{row.quantity.reference.toLocaleString()} {row.quantity.unit}</td><td className="is-text">{row.note}</td></tr>)}</tbody></table>
    </section>

    <section aria-labelledby="iv-arch"><h2 id="iv-arch">Architecture</h2>
      <ul className="fz-iv-findings">{shown.architecture.findings.map(finding => <li key={finding.text} className={`is-${finding.tone}`}><span className={`fz-basis is-${finding.basis === 'measured' ? 'measured' : 'heuristic'}`}>{BASIS[finding.basis]}</span>{finding.text}</li>)}</ul>
      {definition && <><h3>Your decisions compared with the reference</h3>
        <p className="fz-brief__note">Compared by design decision (the role each component plays), not node by node. Documented alternatives count as valid choices.</p>
        <table className="fz-table fz-iv-table"><thead><tr><th scope="col">Decision</th><th scope="col">Reference</th><th scope="col">Yours</th><th scope="col">Assessment</th></tr></thead>
          <tbody>{shown.architecture.roles.map(review => <tr key={review.role.id}><th scope="row">{review.role.label}{!review.role.required && <small>optional</small>}</th>
            <td>{referenceKinds(definition, review.role.kinds).join(', ') || 'not used'}</td>
            <td>{review.nodes.length ? review.nodes.map(node => byKind[node.kind].label).join(', ') : '—'}</td>
            <td className="is-text">{roleVerdict(definition, review)}</td></tr>)}</tbody></table></>}
    </section>

    {auto.whiteboard && <section aria-labelledby="iv-wb"><h2 id="iv-wb">Whiteboard review</h2>
      <p className="fz-brief__note">As recorded when the interview was completed{auto.whiteboard.measuredOn ? `; measurements from “${auto.whiteboard.measuredOn}”` : '; no current benchmark run'}.</p>
      <WhiteboardView review={auto.whiteboard} actions onResource={onResource} /></section>}

    {auto.decisions && <section aria-labelledby="iv-reasoning"><h2 id="iv-reasoning">Reasoning behind major decisions</h2>
      <p className="fz-brief__note">Each decision is checked for six parts. The checks find whether each part is there and whether cited numbers match your own estimates or measurements; they do not judge whether the reasoning is right. Compare with the reference below and correct the criterion if needed.</p>
      <DecisionRubricView decisions={auto.decisions} showSuggestions /></section>}

    {auto.changes?.some(entry => entry.introduced) && <section aria-labelledby="iv-changes"><h2 id="iv-changes">Requirement changes</h2>
      {auto.changes.filter(entry => entry.introduced).map(entry => { const change = (record.changes ?? definition?.changes ?? []).find(item => item.id === entry.id); return <article key={entry.id} className="fz-iv-card">
        <h3>{entry.title}</h3>{change && <p className="fz-task__prompt">{change.change}</p>}
        <ChangeComparisonView comparison={entry} />
        <h4>Your response</h4><p className="fz-prose__p">{session.changes[entry.id]?.answer || <em>No response written.</em>}</p>
        {change && <><h4>Expected considerations</h4><ul className="fz-prose__list">{change.considerations.map(concept => <li key={concept.id}>{concept.label}</li>)}</ul><h4>Alternatives that suit the change</h4><ul className="fz-prose__list">{change.alternatives.map(item => <li key={item}>{item}</li>)}</ul></>}
      </article>; })}</section>}

    <div className="fz-guide__grid">
      <section><h2>Trade-offs not discussed</h2>{shown.untouchedTradeoffs.length ? <ul className="fz-prose__list">{shown.untouchedTradeoffs.map(entry => <li key={entry}>{entry}</li>)}</ul> : <p className="fz-empty-note">Every key trade-off was mentioned.</p>}</section>
      <section><h2>Failure scenarios overlooked</h2>{shown.overlookedFailures.length ? <ul className="fz-prose__list">{shown.overlookedFailures.map(entry => <li key={entry}>{entry}</li>)}</ul> : <p className="fz-empty-note">None.</p>}</section>
    </div>

    <section aria-labelledby="iv-time"><h2 id="iv-time">Time and help</h2>
      <table className="fz-table fz-iv-table"><thead><tr><th scope="col">Stage</th><th scope="col">Time</th>{session.durationMin && <th scope="col">Suggested</th>}</tr></thead>
        <tbody>{STAGES.filter(stage => stage !== 'changes' || session.plan?.stageMs.changes || session.timing.stageMs.changes).map(stage => <tr key={stage}><th scope="row">{STAGE_LABELS[stage]}</th><td>{formatDuration(session.timing.stageMs[stage] ?? 0)}</td>{session.durationMin && <td>{formatDuration(session.plan?.stageMs[stage] ?? session.durationMin * 60_000 * STAGE_ALLOCATION[stage])}</td>}</tr>)}
          <tr><th scope="row">Total</th><td>{formatDuration(session.timing.totalMs)}</td>{session.durationMin && <td>{session.durationMin}:00{shown.usage.overtime ? ' (over time)' : ''}</td>}</tr></tbody></table>
      {session.expired && <p className="fz-brief__note">Time ran out during {STAGE_LABELS[session.expired.stage]}; {formatDuration(Math.max(0, session.timing.totalMs - (session.durationMin ?? 0) * 60_000))} of work followed as overtime.</p>}
      <p className="fz-prose__p">Hints used: <b>{session.hintsUsed.length}</b>{session.hintsUsed.length ? ` (${[...new Set(session.hintsUsed.map(hint => STAGE_LABELS[hint.stage]))].join(', ')})` : ''}. Reference considerations viewed before submitting: <b>{session.referencesViewed.length}</b>{session.referencesViewed.length ? ` (${session.referencesViewed.join(', ')})` : ''}.
        {(session.hintsUsed.length || session.referencesViewed.length) ? ' The scoring rules are the same; read the score as assisted.' : ''}</p>
    </section>

    {recs.length > 0 && <section aria-labelledby="iv-recs"><h2 id="iv-recs">Recommended practice</h2>
      <ul className="fz-iv-recs">{recs.map(rec => <li key={rec.competency}><b>{rec.label}</b><ResourceLinks resources={rec.resources} onResource={onResource} />
        {rec.interview && <p className="fz-brief__note">Next interview: <button className="fz-link" onClick={() => onOpenProblem(rec.interview!.id)}>{rec.interview.title}</button></p>}</li>)}</ul></section>}

    <section aria-labelledby="iv-criteria"><h2 id="iv-criteria">Criteria and evidence</h2>
      <p className="fz-brief__note">Scale: {Object.entries(SCALE).map(([score, label]) => `${score} ${label.toLowerCase()}`).join(' · ')}. Bases: {(Object.keys(BASIS) as Basis[]).map(basis => `${BASIS[basis]} (${BASIS_HELP[basis]})`).join('; ')}. If an automatic assessment is clearly wrong, record a correction: it is stored separately and the automatic result stays visible.</p>
      <ol className="fz-iv-criteria">{auto.criteria.map(criterion => <CriterionView key={criterion.id} criterion={criterion} corrected={shown.criteria.find(entry => entry.id === criterion.id)!} onResource={onResource}
        onCorrect={(score, uncertain, note) => ctl.correct(record.id, { criterionId: criterion.id, at: Date.now(), score, uncertain, note })} history={corrections.filter(entry => entry.criterionId === criterion.id)} />)}</ol>
    </section>

    {definition && <ReferenceDesignView definition={definition} version={record.referenceVersion ?? 1} />}
  </article>;
}

const referenceKinds = (definition: InterviewDefinition, kinds: string[]) => [...new Set(definition.reference.architecture.diagram.nodes.filter(node => node.kind && kinds.includes(node.kind)).map(node => byKind[node.kind!].label))];
function roleVerdict(definition: InterviewDefinition, review: ReturnType<typeof evaluationOf>['architecture']['roles'][number]): string {
  const reference = new Set(definition.reference.architecture.diagram.nodes.flatMap(node => node.kind && review.role.kinds.includes(node.kind) ? [node.kind] : []));
  if (review.status === 'missing') return review.role.required ? `Missing. ${review.role.why}` : 'Not used (optional).';
  if (review.status === 'unused') return 'Present, but it carries no traffic, so it earns no credit.';
  const same = review.nodes.some(node => reference.has(node.kind));
  const choice = same ? 'Same choice as the reference.' : reference.size ? 'A documented alternative to the reference choice.' : 'Used where the reference does not use it.';
  return `${choice} ${review.status === 'explained' ? `Explained: ${review.covered.join(', ')}.` : 'Not explained in a decision note.'}${review.missing.length && review.status === 'explained' ? ` Not covered: ${review.missing.join(', ')}.` : ''}`;
}

function CriterionView({ criterion, corrected, onCorrect, history, onResource }: { criterion: CriterionResult; corrected: CriterionResult; onCorrect: (score: number | null, uncertain: boolean, note: string) => void; history: Array<{ at: number; score: number | null; uncertain: boolean; note: string }>; onResource: (resource: Resource) => void }) {
  const [open, setOpen] = useState(false); const [score, setScore] = useState<string>(''); const [uncertain, setUncertain] = useState(corrected.uncertain); const [note, setNote] = useState('');
  const changed = corrected.score !== criterion.score;
  return <li className="fz-iv-criterion">
    <div className="fz-iv-criterion__head"><ScorePill score={criterion.score} />{changed && <><span aria-hidden>→</span><ScorePill score={corrected.score} /><em className="fz-tag is-accent">corrected</em></>}
      <b>{criterion.label}</b><span className="fz-tag">{BASIS[criterion.basis]}</span>{corrected.uncertain && <span className="fz-tag is-warn"><CircleAlert size={11} aria-hidden />uncertain</span>}</div>
    {criterion.uncertainReason && <p className="fz-brief__note">{criterion.uncertainReason}</p>}
    {criterion.manualReview && <p className="fz-iv-manual"><b>Needs your review.</b> {criterion.manualReview}</p>}
    {criterion.score === null && <p className="fz-brief__note">Not assessed: excluded from the totals.</p>}
    <ul className="fz-iv-evidence-list">{criterion.evidence.map((entry, i) => <li key={i} className={entry.positive ? 'is-pos' : 'is-neg'}><span className="fz-visually-hidden">{entry.positive ? 'Supports: ' : 'Against: '}</span>{entry.text}</li>)}</ul>
    {criterion.critical.length > 0 && <p className="fz-iv-critical">Critical omissions: {criterion.critical.join('; ')}.</p>}
    {criterion.missed.length > 0 && <details><summary>Not covered ({criterion.missed.length})</summary><ul className="fz-prose__list">{criterion.missed.map(entry => <li key={entry}>{entry}</li>)}</ul></details>}
    <ResourceLinks resources={criterion.resources} onResource={onResource} />
    {history.length > 0 && <p className="fz-brief__note">Corrections: {history.map(entry => `${new Date(entry.at).toLocaleString()} → ${entry.score === null ? 'score unchanged' : `${entry.score}/4`}${entry.uncertain ? ', marked uncertain' : ''}${entry.note ? ` (“${entry.note}”)` : ''}`).join('; ')}.</p>}
    {!open ? <button className="fz-link" onClick={() => setOpen(true)}>Correct this assessment</button> : <form className="fz-iv-correct" onSubmit={event => { event.preventDefault(); onCorrect(score === '' ? null : Number(score), uncertain, note.trim()); setOpen(false); setNote(''); setScore(''); }}>
      <label>Corrected score <select value={score} onChange={event => setScore(event.target.value)}><option value="">Keep automatic score</option>{[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>{value} — {SCALE[value as 0]}</option>)}</select></label>
      <label className="fz-check"><input type="checkbox" checked={uncertain} onChange={event => setUncertain(event.target.checked)} />Mark as uncertain</label>
      <input aria-label="Reason for the correction" placeholder="Why the automatic assessment is wrong" value={note} onChange={event => setNote(event.target.value)} />
      <button className="fz-btn fz-btn--small fz-btn--primary" type="submit" disabled={score === '' && uncertain === corrected.uncertain}>Save correction</button><button className="fz-btn fz-btn--small" type="button" onClick={() => setOpen(false)}>Cancel</button>
    </form>}
  </li>;
}

export function ReferenceDesignView({ definition, version }: { definition: InterviewDefinition; version?: number }) {
  const found = referenceFor(definition, version);
  const reference: ReferenceDesign = found.reference;
  const block = (title: string, items: string[] | undefined) => items?.length ? <section><h3>{title}</h3><ul className="fz-prose__list">{items.map(item => <li key={item}>{item}</li>)}</ul></section> : null;
  return <section className="fz-iv-refdesign" aria-labelledby="iv-ref"><h2 id="iv-ref">Reference design <small>version {found.version}</small></h2>
    <p className="fz-callout is-note"><span><b>One reasonable design, not the only correct answer.</b> Other designs are valid when they meet the requirements and their trade-offs are explained. Your design is not graded by how closely it matches this diagram.</span></p>
    {!found.exact && <p className="fz-brief__note">This interview was compared with reference version {version}, which is no longer available; the current version {found.version} is shown.</p>}
    {block('Requirements and assumptions', reference.requirements)}{block('Estimates', reference.estimates)}{block('API', reference.api)}{block('Data model', reference.dataModel)}
    <section><h3>High-level architecture</h3><p className="fz-prose__p">{reference.architecture.summary}</p><DiagramView diagram={reference.architecture.diagram} />{block('Key decisions', reference.architecture.decisions)}</section>
    {block('Why it works', reference.whyItWorks)}
    {block('Low-level design considerations', reference.lld)}
    <div className="fz-guide__grid">{block('Scaling strategy', reference.scaling)}{block('Reliability and failure handling', reference.failures)}{block('Alternatives', reference.alternatives)}{block('Bottlenecks and trade-offs', reference.tradeoffs)}</div>
    {reference.preferAlternatives?.length ? <section><h3>When an alternative is the better choice</h3><dl className="fz-terms">{reference.preferAlternatives.map(entry => <div key={entry.alternative}><dt>{entry.alternative}</dt><dd>{entry.when}</dd></div>)}</dl></section> : null}
    <h3>Common mistakes</h3><ul className="fz-prose__list">{definition.mistakes.map(item => <li key={item}>{item}</li>)}</ul>
  </section>;
}
