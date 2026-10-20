import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Bookmark, CheckCircle2, ChevronDown, CircleDashed, CircleDot, FlaskConical, GitCompareArrows, History, Lightbulb, LoaderCircle, MessageSquareQuote, PencilRuler, Play, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { byKind } from '../../app/catalog';
import type { ArchitectureSnapshot } from '../../challenges/attempts';
import { validateArchitecture } from '../../app/validation';
import { useLabRunner } from '../../lab/useLabRunner';
import { nextQuestions, planFollowUps } from '../../interview/adaptive';
import { benchmarkInput, scenarioApplies, scenarioLabel, toEvidence } from '../../interview/benchmark';
import { changeRunLabel, changeRunnable, compareChange } from '../../interview/changes';
import { assessDecisions, majorDecisions } from '../../interview/reasoning';
import { buildRecord } from '../../interview/record';
import { architectureKey, update, type Endpoint, type Entity, type InterviewSession, type RunEvidence } from '../../interview/session';
import { EXPLANATION_FIELDS, answerChange, answerFollowUp, askClarification, canViewReference, checkpointById, clock, explain, formatDuration, goToStage, hintsShown, introduceChange, isSubmitted, logEvent, markAsked, newEndpoint, newEntity, pacing, recordChangeRun, restoreCheckpoint, revealHint, reviseChange, saveCheckpoint, stageHasContent, submitChange, submitFollowUp, tick, viewReference, MAX_CHECKPOINTS } from '../../interview/workflow';
import { COMPETENCY_LABELS, STAGE_LABELS, stagesOf, type HttpMethod, type InterviewDefinition, type Prompt, type RequirementChange, type Resource, type Scenario, type StageId } from '../../interview/types';
import type { InterviewController } from '../../interview/useInterviews';
import { reviewWhiteboard } from '../../interview/whiteboard';
import { ChangeComparisonView, DecisionRubricView, WhiteboardView } from './Review';
import { Answer, ResourceLinks, SessionClock } from './shared';

type Props = {
  definition: InterviewDefinition; session: InterviewSession; ctl: InterviewController;
  onOpenCanvas: () => void; onResource: (resource: Resource) => void; onFinished: (recordId: string) => void; onLeave: () => void;
};
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** The interview workspace: stage navigation with time per stage, the persistent problem statement, and one editor per stage. */
export function SessionView({ definition, session, ctl, onOpenCanvas, onResource, onFinished, onLeave }: Props) {
  const [statementOpen, setStatementOpen] = useState(true);
  const [expiryDismissed, setExpiryDismissed] = useState(false);
  // Shown once per opening when the session already has time on it: the timer only runs while the interview is open.
  const [resumedAt] = useState(() => session.timing.totalMs);
  const edit = (change: (current: InterviewSession) => InterviewSession) => ctl.edit(session.id, change);
  const patch = (value: Partial<InterviewSession>) => edit(current => update(current, value, Date.now()));
  const go = (stage: StageId) => { edit(current => goToStage(current, stage, Date.now())); document.querySelector('.fz-iv-main')?.scrollTo({ top: 0 }); };
  const stages = stagesOf(definition);
  const index = stages.indexOf(session.stage);
  const now = clock(session); const pace = pacing(session, stages);
  const finish = (early: boolean) => {
    const missing = stages.filter(stage => !stageHasContent(session, stage)).map(stage => STAGE_LABELS[stage]);
    const message = `${early ? 'Finish the interview early' : 'Finish the interview'} and generate the evaluation?\n\nThe session becomes a read-only record. ${missing.length ? `Stages without answers (scored as missing): ${missing.join(', ')}.` : 'Every stage has answers.'}`;
    if (!window.confirm(message)) return;
    const record = ctl.complete(session.id, (draft, recordId) => buildRecord(definition, draft, { recordId, at: Date.now(), finishedEarly: early })); if (record) onFinished(record.id);
  };
  const early = session.mode === 'mock' && index < stages.length - 1 && !now.overtime;
  return <div className="fz-iv-session">
    <aside className="fz-iv-side" aria-label="Interview">
      <button className="fz-btn fz-btn--small" onClick={onLeave}><ArrowLeft size={12} />Interviews</button>
      <div className="fz-iv-side__head"><span className="fz-eyebrow">{session.mode === 'mock' ? `Mock interview · ${session.durationMin} min` : 'Practice interview'}</span><h1>{definition.title}</h1></div>
      <SessionClock session={session} onCommit={(ms, stage) => edit(current => tick(current, ms, stage, Date.now()))} />
      {pace && <p className={`fz-iv-pace is-${pace.tone}`} role="status">{pace.message}</p>}
      {session.plan && <label className="fz-check fz-iv-pacing"><input type="checkbox" checked={session.pacing} onChange={event => patch({ pacing: event.target.checked })} />Pacing warnings</label>}
      {resumedAt > 0 && session.timing.totalMs - resumedAt < 15_000 && <p className="fz-brief__note">Resumed at {formatDuration(resumedAt)}. The timer only runs while the interview is open; closing or reloading pauses it.</p>}
      <section className="fz-iv-statement">
        <button className="fz-iv-statement__toggle" aria-expanded={statementOpen} onClick={() => setStatementOpen(open => !open)}><ChevronDown size={13} aria-hidden />Problem statement</button>
        {statementOpen && <p>{definition.statement}</p>}
      </section>
      <nav aria-label="Interview stages"><ol className="fz-iv-stages">{stages.map((stage, i) => {
        const done = session.completedStages.includes(stage) || (stage !== session.stage && stageHasContent(session, stage));
        const spent = session.timing.stageMs[stage] ?? 0; const planned = session.plan?.stageMs[stage];
        return <li key={stage}><button className={stage === session.stage ? 'is-on' : ''} aria-current={stage === session.stage ? 'step' : undefined} onClick={() => go(stage)}>
          {done ? <CheckCircle2 size={14} className="is-done" aria-label="Has answers" /> : stage === session.stage ? <CircleDot size={14} aria-hidden /> : <CircleDashed size={14} aria-hidden />}<span>{i + 1}. {STAGE_LABELS[stage]}</span>
          {(spent > 0 || planned) && <small className={`fz-iv-stagetime${planned && spent > planned ? ' is-over' : ''}`}>{formatDuration(spent)}{planned ? ` / ${formatDuration(planned)}` : ''}</small>}
          {planned ? <span className="fz-iv-stagebar" aria-hidden><span style={{ width: `${Math.min(100, spent / planned * 100)}%` }} /></span> : null}
        </button></li>;
      })}</ol></nav>
      <p className="fz-brief__note">Saved in this browser as you type. Leaving or reloading keeps your work; continue from the Interview dashboard.</p>
      <div className="fz-iv-side__actions">
        <button className="fz-btn fz-btn--primary" onClick={() => finish(early)}><Send size={13} />{early ? 'Finish early' : 'Finish and evaluate'}</button>
        <button className="fz-btn fz-btn--small" onClick={() => { if (window.confirm('Discard this unfinished interview? Its answers are deleted; completed interviews are not affected.')) { ctl.discard(session.id); onLeave(); } }}><Trash2 size={12} />Discard</button>
      </div>
    </aside>
    <main className="fz-iv-main" aria-labelledby="fz-iv-stage-title">
      {session.mode === 'mock' && now.overtime && !expiryDismissed && <div className="fz-alert is-bad fz-iv-expired" role="alert"><span><b>Time is up.</b> Nothing has been lost or locked: every answer and the design are saved. Finish now to see the evaluation and the reference, or keep working; extra time is recorded as overtime in the report.</span>
        <span className="fz-iv-expired__actions"><button className="fz-btn fz-btn--small fz-btn--primary" onClick={() => finish(false)}><Send size={12} />Finish and review</button><button className="fz-btn fz-btn--small" onClick={() => setExpiryDismissed(true)}>Keep working</button></span></div>}
      {session.definitionVersion !== definition.version && <p className="fz-brief__note">This draft was started on version {session.definitionVersion} of the problem; it continues on version {definition.version}.</p>}
      <header className="fz-iv-stagehead"><span className="fz-eyebrow">Stage {index + 1} of {stages.length}{session.plan?.stageMs[session.stage] ? ` · planned ${formatDuration(session.plan.stageMs[session.stage]!)}` : ''}</span><h2 id="fz-iv-stage-title">{STAGE_LABELS[session.stage]}</h2></header>
      {session.stage === 'requirements' && <RequirementsStage definition={definition} session={session} patch={patch} edit={edit} />}
      {session.stage === 'estimation' && <EstimationStage definition={definition} session={session} patch={patch} edit={edit} />}
      {session.stage === 'api' && <ApiStage definition={definition} session={session} patch={patch} edit={edit} />}
      {session.stage === 'data' && <DataStage definition={definition} session={session} patch={patch} edit={edit} />}
      {session.stage === 'design' && <DesignStage definition={definition} session={session} patch={patch} edit={edit} onOpenCanvas={onOpenCanvas} onResource={onResource} />}
      {session.stage === 'deepdive' && <DeepDiveStage definition={definition} session={session} patch={patch} edit={edit} onResource={onResource} />}
      {session.stage === 'followups' && <FollowUpStage definition={definition} session={session} patch={patch} edit={edit} onResource={onResource} />}
      {session.stage === 'changes' && <ChangesStage definition={definition} session={session} patch={patch} edit={edit} onResource={onResource} onOpenCanvas={onOpenCanvas} />}
      {session.stage === 'review' && <ReviewStage definition={definition} session={session} patch={patch} edit={edit} />}
      <Hints definition={definition} session={session} edit={edit} />
      <nav className="fz-lessonview__pager" aria-label="Stage navigation">
        {index > 0 ? <button className="fz-btn" onClick={() => go(stages[index - 1])}><ArrowLeft size={13} />{STAGE_LABELS[stages[index - 1]]}</button> : <span />}
        {index < stages.length - 1 ? <button className="fz-btn fz-btn--primary" onClick={() => go(stages[index + 1])}>{STAGE_LABELS[stages[index + 1]]}<ArrowRight size={13} /></button>
          : <button className="fz-btn fz-btn--primary" onClick={() => finish(false)}><Send size={13} />Finish and evaluate</button>}
      </nav>
    </main>
  </div>;
}

type StageProps = { definition: InterviewDefinition; session: InterviewSession; patch: (value: Partial<InterviewSession>) => void; edit: (change: (current: InterviewSession) => InterviewSession) => void };

/** Practice-mode hints, revealed one at a time and recorded. Mock interviews have none. */
function Hints({ definition, session, edit }: Pick<StageProps, 'definition' | 'session' | 'edit'>) {
  const hints = definition.hints[session.stage] ?? []; if (!hints.length) return null;
  if (session.mode === 'mock') return <p className="fz-brief__note">Hints are not available in a mock interview.</p>;
  const shown = hintsShown(session, session.stage);
  return <section className="fz-iv-hints" aria-label="Hints">
    {shown > 0 && <ol>{hints.slice(0, shown).map(hint => <li key={hint}>{hint}</li>)}</ol>}
    {shown < hints.length && <button className="fz-btn fz-btn--small" onClick={() => edit(current => revealHint(current, current.stage, shown, Date.now()))}><Lightbulb size={12} />Show hint {shown + 1} of {hints.length}</button>}
    <small>Hints used are recorded and shown in the report. They do not change the scoring rules.</small>
  </section>;
}
/** Reference considerations: practice mode only, once an answer exists (or is submitted); viewing is recorded. Mock mode shows them after the interview. */
function Reference({ session, edit, refKey, hasAnswer, children, label = 'Show reference considerations', need = 'Record an answer first' }: { session: InterviewSession; edit: StageProps['edit']; refKey: string; hasAnswer: boolean; children: React.ReactNode; label?: string; need?: string }) {
  const viewed = session.referencesViewed.includes(refKey);
  if (session.mode === 'mock') return <p className="fz-brief__note">Reference considerations are shown in the report after you finish.</p>;
  if (viewed) return <div className="fz-iv-reference" role="note"><b>Reference considerations</b><span className="fz-brief__note">One reasonable answer, not the only correct one. Viewing is recorded.</span>{children}</div>;
  return <button className="fz-btn fz-btn--small" disabled={!canViewReference(session, hasAnswer)} title={hasAnswer ? undefined : need} onClick={() => edit(current => viewReference(current, refKey, Date.now()))}><MessageSquareQuote size={12} />{label}</button>;
}
const List = ({ items }: { items: string[] }) => <ul className="fz-prose__list">{items.map(item => <li key={item}>{item}</li>)}</ul>;

function RequirementsStage({ definition, session, patch, edit }: StageProps) {
  const set = (key: keyof InterviewSession['requirements']) => (value: string) => patch({ requirements: { ...session.requirements, [key]: value } });
  return <>
    <p className="fz-prose__p">Clarify what the system must do and how well, before designing anything. Write one requirement per line.</p>
    <div className="fz-iv-grid">
      <Answer label="Functional requirements" value={session.requirements.functional} onChange={set('functional')} rows={6} placeholder="Users can …" />
      <Answer label="Non-functional requirements" value={session.requirements.nonFunctional} onChange={set('nonFunctional')} rows={6} placeholder="p95 latency under … at … req/s" hint="Give numbers where you can." />
      <Answer label="Scope and assumptions" value={session.requirements.scope} onChange={set('scope')} rows={3} />
      <Answer label="Explicitly excluded" value={session.requirements.excluded} onChange={set('excluded')} rows={3} />
    </div>
    <h3 className="fz-iv-h3">Ask the interviewer</h3>
    <p className="fz-brief__note">Asking reveals the interviewer’s answer. Asking the important questions is part of the evaluation; asking more is never penalised.</p>
    <ul className="fz-iv-clarify">{definition.clarifications.map(entry => { const asked = session.clarificationsAsked.includes(entry.id); return <li key={entry.id} className={asked ? 'is-asked' : ''}>
      <span>{entry.question}</span>
      {asked ? <p><b>Interviewer:</b> {entry.answer}</p> : <button className="fz-btn fz-btn--small" onClick={() => edit(current => askClarification(current, entry.id, Date.now()))}>Ask</button>}
    </li>; })}</ul>
    <Answer label="Your own questions and assumed answers" value={session.clarificationNotes} onChange={value => patch({ clarificationNotes: value })} rows={3} />
    <Reference session={session} edit={edit} refKey="requirements" hasAnswer={stageHasContent(session, 'requirements')}>
      <h4>Requirements a strong answer covers</h4><List items={definition.requirements.map(entry => `${entry.kind === 'functional' ? 'Functional' : 'Non-functional'}: ${entry.label}${entry.critical ? ' (critical)' : ''}. ${entry.why}`)} />
    </Reference>
  </>;
}

function EstimationStage({ definition, session, patch, edit }: StageProps) {
  return <>
    <p className="fz-prose__p">Estimate the workload. Numbers may use k, million or billion (for example “3.3 million”). The evaluation checks reasoning and order of magnitude, not one exact number:</p>
    <ul className="fz-prose__list fz-iv-tolerance"><li>Assumptions are accepted within the stated factor of the reference; a different assumption is still fine if your derived numbers follow from it.</li><li>Derived numbers must follow from your own assumptions (within 30%) and be within 10× of the reference.</li></ul>
    <table className="fz-table fz-iv-estimates"><thead><tr><th scope="col">Quantity</th><th scope="col">Your estimate</th><th scope="col">Unit</th></tr></thead>
      <tbody>{definition.estimates.map(quantity => <tr key={quantity.id}><th scope="row">{quantity.label}<small>{quantity.role === 'assumption' ? 'assumption' : 'derived'} · {quantity.why}</small></th>
        <td><input aria-label={quantity.label} value={session.estimates[quantity.id] ?? ''} onChange={event => patch({ estimates: { ...session.estimates, [quantity.id]: event.target.value } })} /></td><td>{quantity.unit}</td></tr>)}</tbody></table>
    <Answer label="Assumptions and calculations" value={session.estimateNotes} onChange={value => patch({ estimateNotes: value })} rows={5} placeholder="3.3 M/day ÷ 86,400 ≈ 38/s …" />
    <Reference session={session} edit={edit} refKey="estimation" hasAnswer={stageHasContent(session, 'estimation')} label="Submit estimates and compare">
      <table className="fz-table"><thead><tr><th scope="col">Quantity</th><th scope="col">Reference</th><th scope="col">Accepted</th><th scope="col">Working</th></tr></thead>
        <tbody>{definition.estimates.map(quantity => <tr key={quantity.id}><th scope="row">{quantity.label}</th><td>{quantity.reference.toLocaleString()} {quantity.unit}</td><td>{quantity.role === 'assumption' ? `÷/× ${quantity.factor}` : 'from your inputs ±30%, within 10×'}</td><td className="is-text">{quantity.working.join(' ')}</td></tr>)}</tbody></table>
    </Reference>
  </>;
}

function ApiStage({ definition, session, patch, edit }: StageProps) {
  const setEndpoint = (id: string, value: Partial<Endpoint>) => patch({ endpoints: session.endpoints.map(endpoint => endpoint.id === id ? { ...endpoint, ...value } : endpoint) });
  return <>
    <p className="fz-prose__p">Define the APIs this system needs. Only operations relevant to the requirements are expected; extra endpoints are not penalised.</p>
    {session.endpoints.map((endpoint, i) => <fieldset key={endpoint.id} className="fz-iv-card">
      <legend>Endpoint {i + 1}</legend>
      <div className="fz-iv-row">
        <select aria-label="HTTP method" value={endpoint.method} onChange={event => setEndpoint(endpoint.id, { method: event.target.value as HttpMethod })}>{METHODS.map(method => <option key={method}>{method}</option>)}</select>
        <input aria-label="Path" placeholder="/v1/resource/{id}" value={endpoint.path} onChange={event => setEndpoint(endpoint.id, { path: event.target.value })} />
        <button className="fz-icon-btn is-danger" aria-label={`Remove endpoint ${i + 1}`} onClick={() => patch({ endpoints: session.endpoints.filter(entry => entry.id !== endpoint.id) })}><Trash2 size={13} /></button>
      </div>
      <div className="fz-iv-grid">
        <Answer label="Request fields" value={endpoint.request} onChange={value => setEndpoint(endpoint.id, { request: value })} rows={2} />
        <Answer label="Response fields and status" value={endpoint.response} onChange={value => setEndpoint(endpoint.id, { response: value })} rows={2} />
        <Answer label="Errors" value={endpoint.errors} onChange={value => setEndpoint(endpoint.id, { errors: value })} rows={2} placeholder="400 invalid input, 404 …" />
        <Answer label="Notes" value={endpoint.notes} onChange={value => setEndpoint(endpoint.id, { notes: value })} rows={2} />
      </div>
      <div className="fz-iv-flags">{(['auth', 'idempotent', 'paginated'] as const).map(flagKey => <label key={flagKey} className="fz-check"><input type="checkbox" checked={endpoint[flagKey]} onChange={event => setEndpoint(endpoint.id, { [flagKey]: event.target.checked })} />{flagKey === 'auth' ? 'Requires authentication' : flagKey === 'idempotent' ? 'Idempotent (safe to retry)' : 'Paginated'}</label>)}</div>
    </fieldset>)}
    <button className="fz-btn" onClick={() => patch({ endpoints: [...session.endpoints, newEndpoint(`ep-${Date.now().toString(36)}`)] })}><Plus size={13} />Add endpoint</button>
    <Reference session={session} edit={edit} refKey="api" hasAnswer={stageHasContent(session, 'api')}>
      <List items={definition.api.map(operation => `${operation.required ? 'Required' : 'Optional'}: ${operation.purpose} (${operation.methods.join('/')}). ${operation.considerations.map(entry => entry.label).join('; ')}.`)} />
      <List items={definition.reference.api} />
    </Reference>
  </>;
}

function DataStage({ definition, session, patch, edit }: StageProps) {
  const setEntity = (id: string, value: Partial<Entity>) => patch({ entities: session.entities.map(entity => entity.id === id ? { ...entity, ...value } : entity) });
  return <>
    <p className="fz-prose__p">Describe the main entities, their identifiers, important fields, relationships and indexes, the access patterns they serve, and their consistency needs.</p>
    {session.entities.map((entity, i) => <fieldset key={entity.id} className="fz-iv-card">
      <legend>Entity {i + 1}</legend>
      <div className="fz-iv-row">
        <input aria-label="Entity name" placeholder="Name" value={entity.name} onChange={event => setEntity(entity.id, { name: event.target.value })} />
        <input aria-label="Primary identifier" placeholder="Primary key" value={entity.primaryKey} onChange={event => setEntity(entity.id, { primaryKey: event.target.value })} />
        <button className="fz-icon-btn is-danger" aria-label={`Remove entity ${i + 1}`} onClick={() => patch({ entities: session.entities.filter(entry => entry.id !== entity.id) })}><Trash2 size={13} /></button>
      </div>
      <div className="fz-iv-grid">
        <Answer label="Fields" value={entity.fields} onChange={value => setEntity(entity.id, { fields: value })} rows={3} />
        <Answer label="Relationships" value={entity.relationships} onChange={value => setEntity(entity.id, { relationships: value })} rows={3} />
        <Answer label="Indexes" value={entity.indexes} onChange={value => setEntity(entity.id, { indexes: value })} rows={2} />
        <Answer label="Access patterns" value={entity.accessPatterns} onChange={value => setEntity(entity.id, { accessPatterns: value })} rows={2} />
        <Answer label="Consistency requirements" value={entity.consistency} onChange={value => setEntity(entity.id, { consistency: value })} rows={2} />
      </div>
    </fieldset>)}
    <button className="fz-btn" onClick={() => patch({ entities: [...session.entities, newEntity(`en-${Date.now().toString(36)}`)] })}><Plus size={13} />Add entity</button>
    <Reference session={session} edit={edit} refKey="data" hasAnswer={stageHasContent(session, 'data')}><List items={definition.reference.dataModel} /><List items={definition.modelConcerns.map(entry => `${entry.label}: ${entry.why}`)} /></Reference>
  </>;
}


/** Isolated runs of a given architecture: they never change the canvas, practice runs or challenges. */
function useIsolatedRun(definition: InterviewDefinition) {
  const runner = useLabRunner();
  const [error, setError] = useState<string | null>(null);
  const run = (architecture: ArchitectureSnapshot | null, scenario: Scenario | undefined, onEvidence: (evidence: RunEvidence) => void, label = scenarioLabel(definition, scenario)) => {
    if (!architecture?.nodes.length) return;
    setError(null);
    runner.run({
      label, inputs: [benchmarkInput(definition, architecture, scenario)], labels: Object.fromEntries(architecture.nodes.map(node => [node.id, node.label || byKind[node.kind].label])),
      onLevel: (_index, outcome) => { if (!outcome.ok) { setError(outcome.error); return; } onEvidence(toEvidence(outcome.measurements, architecture, label, Date.now())); },
      onDone: ({ cancelled }) => { if (cancelled) setError('Cancelled. Nothing was recorded.'); },
    });
  };
  return { running: runner.state.status === 'running', run, cancel: runner.cancel, error };
}
export function EvidenceView({ evidence, definition, stale, targets = definition.benchmark.targets }: { evidence: InterviewSession['benchmark']; definition: InterviewDefinition; stale: boolean; targets?: { p95Ms: number; minSuccessPct: number } }) {
  if (!evidence) return null;
  return <div className={`fz-iv-evidence${stale ? ' is-stale' : ''}`}>
    <span className="fz-basis is-measured">Measured</span> <b>{evidence.label}</b>{stale && <em> · run on an earlier version of the architecture; not used</em>}
    {!evidence.complete && <p>Incomplete: the simulator hit its event limit, so nothing from this run is used.</p>}
    <dl className="fz-facts"><dt>p95 latency</dt><dd>{evidence.p95 ?? '—'} ms <small>target ≤ {targets.p95Ms}</small></dd><dt>Offered requests that succeeded</dt><dd>{evidence.successPct}% <small>target ≥ {targets.minSuccessPct}%</small></dd>
      <dt>Busiest component</dt><dd>{evidence.busiest ? `${evidence.busiest.label} · ${Math.round(evidence.busiest.utilization * 100)}%` : '—'}</dd></dl>
    {evidence.failures.length > 0 && <ul className="fz-prose__list">{evidence.failures.map(failure => <li key={`${failure.label}${failure.kind}`}>{failure.count.toLocaleString()} failed at {failure.label} ({failure.kind})</li>)}</ul>}
  </div>;
}

/** Saved copies of the design. Restoring first saves the current design, so no edit is ever lost. */
function Checkpoints({ session, edit }: Pick<StageProps, 'session' | 'edit'>) {
  const [label, setLabel] = useState('');
  const full = session.checkpoints.length >= MAX_CHECKPOINTS;
  return <section className="fz-iv-checkpoints" aria-labelledby="iv-checkpoints">
    <h3 className="fz-iv-h3" id="iv-checkpoints">Checkpoints <small>saved copies of the design</small></h3>
    <p className="fz-brief__note">A checkpoint is saved automatically when you leave this stage with a changed design, and when a requirement change is introduced. Restoring one saves the current design first.</p>
    <form className="fz-iv-row" onSubmit={event => { event.preventDefault(); edit(current => saveCheckpoint(current, { at: Date.now(), label: label.trim() || `Checkpoint ${current.checkpoints.length + 1}`, kind: 'manual' })); setLabel(''); }}>
      <input aria-label="Checkpoint name" placeholder="Name (optional)" value={label} onChange={event => setLabel(event.target.value)} />
      <button className="fz-btn fz-btn--small" type="submit" disabled={!session.architecture?.nodes.length || full}><Bookmark size={12} />Save checkpoint</button>
    </form>
    {full && <p className="fz-brief__note">The limit of {MAX_CHECKPOINTS} manual and automatic checkpoints is reached. Requirement-change checkpoints are still saved.</p>}
    {session.checkpoints.length > 0 && <ol className="fz-iv-cplist">{[...session.checkpoints].reverse().map(checkpoint => <li key={checkpoint.id}>
      <span><b>{checkpoint.label}</b><small>{new Date(checkpoint.at).toLocaleTimeString()} · {checkpoint.architecture.nodes.length} components{architectureKey(checkpoint.architecture) === architectureKey(session.architecture) ? ' · same as the current design' : ''}</small></span>
      <button className="fz-btn fz-btn--small" disabled={architectureKey(checkpoint.architecture) === architectureKey(session.architecture)} onClick={() => { if (window.confirm(`Restore “${checkpoint.label}”? Your current design is saved as a checkpoint first.`)) edit(current => restoreCheckpoint(current, checkpoint.id, Date.now())); }}><RotateCcw size={12} />Restore</button>
    </li>)}</ol>}
  </section>;
}

function DesignStage({ definition, session, patch, edit, onOpenCanvas, onResource }: StageProps & { onOpenCanvas: () => void; onResource: (resource: Resource) => void }) {
  const architecture = session.architecture;
  const validation = useMemo(() => architecture ? validateArchitecture({ nodes: architecture.nodes.map(node => ({ id: node.id, kind: node.kind, config: node.config })), edges: architecture.edges }) : null, [architecture]);
  const decisions = useMemo(() => assessDecisions(definition, session), [definition, session]);
  const review = useMemo(() => reviewWhiteboard(definition, session, decisions), [definition, session, decisions]);
  const major = new Set(majorDecisions(definition, session).map(node => node.id));
  const isolated = useIsolatedRun(definition);
  const stale = Boolean(session.benchmark && session.benchmark.architectureKey !== architectureKey(architecture));
  const practice = session.mode === 'practice';
  return <>
    <p className="fz-prose__p">Design the architecture on the Flowzen canvas. Nothing is pre-built: add components, connect them, configure them and record why you chose each one. Presence alone earns no credit; components are assessed on whether they carry traffic and on your explanation.</p>
    <div className="fz-brief__actions"><button className="fz-btn fz-btn--primary" onClick={onOpenCanvas}><PencilRuler size={13} />{architecture?.nodes.length ? 'Open the architecture canvas' : 'Start designing on the canvas'}</button></div>
    {architecture?.nodes.length ? <>
      <p className="fz-brief__note">{architecture.nodes.length} components, {architecture.edges.length} connections · validation: {validation!.counts.functional} functional, {validation!.counts.warning} warnings, {validation!.counts.dead} dead.</p>
      <h3 className="fz-iv-h3">Why each component? <small>decision notes and full explanations for major decisions</small></h3>
      <ul className="fz-iv-decisions">{architecture.nodes.filter(node => node.kind !== 'client').map(node => { const Icon = byKind[node.kind].icon; const assessment = decisions.find(entry => entry.nodeId === node.id); return <li key={node.id}>
        <label><span><Icon size={13} aria-hidden /><b>{node.label || byKind[node.kind].label}</b><em>{byKind[node.kind].label}</em>{validation!.components[node.id]?.status === 'dead' && <em className="is-bad"> · dead</em>}</span>
          <textarea rows={2} value={session.decisions[node.id] ?? ''} placeholder="Chosen approach: why is this here, and what would break without it?" onChange={event => patch({ decisions: { ...session.decisions, [node.id]: event.target.value } })} /></label>
        {major.has(node.id) && <details className="fz-iv-explain" open={Boolean(session.explanations[node.id])}>
          <summary>Explain this decision{assessment ? ` · ${assessment.dimensions.filter(dim => dim.met).length} of ${assessment.dimensions.length} parts${practice ? '' : ' written'}` : ''}</summary>
          <div className="fz-iv-grid">{EXPLANATION_FIELDS.map(field => {
            const dim = assessment?.dimensions.find(entry => entry.id === field.key);
            return <label key={field.key} className="fz-iv-answer"><span>{field.label}</span>{practice && dim && <small className={dim.met ? 'is-met' : ''}>{dim.met ? '✓ ' : ''}{dim.note}</small>}
              <textarea rows={2} value={session.explanations[node.id]?.[field.key] ?? ''} placeholder={field.placeholder} onChange={event => edit(current => explain(current, node.id, { [field.key]: event.target.value }, Date.now()))} /></label>;
          })}</div>
        </details>}
      </li>; })}</ul>
    </> : <p className="fz-empty-note">No architecture yet.</p>}
    <Answer label="Design notes (overall approach and key decisions)" value={session.designNotes} onChange={value => patch({ designNotes: value })} rows={4} />
    <h3 className="fz-iv-h3">Benchmark <small>isolated run</small></h3>
    <p className="fz-brief__note">{definition.benchmark.description}. Targets: p95 ≤ {definition.benchmark.targets.p95Ms} ms, at least {definition.benchmark.targets.minSuccessPct}% of requests succeed. Forced settings: {definition.benchmark.overrides.map(override => override.reason).join(' ')} The run uses a copy of your design on its own worker; it does not change the canvas or any practice run.</p>
    <div className="fz-brief__actions">
      <button className="fz-btn" disabled={!architecture?.nodes.length || isolated.running} onClick={() => isolated.run(architecture, undefined, evidence => edit(current => logEvent(update(current, { benchmark: evidence }, Date.now()), 'benchmark', `Benchmark: p95 ${evidence.p95 ?? '—'} ms, ${evidence.successPct}% ok`, Date.now())))}>{isolated.running ? <LoaderCircle size={13} className="fz-spin" /> : <Play size={13} />}{isolated.running ? 'Running…' : 'Run the benchmark on my design'}</button>
    </div>
    {isolated.error && <div className="fz-alert is-warn" role="alert"><span>{isolated.error}</span></div>}
    <EvidenceView evidence={session.benchmark} definition={definition} stale={stale} />
    {architecture?.nodes.length ? <>
      <h3 className="fz-iv-h3">Whiteboard review <small>what an interviewer would point at</small></h3>
      <WhiteboardView review={review} actions={practice} onResource={onResource} compact />
      {practice && decisions.length > 0 && <><h4>Reasoning rubric</h4><DecisionRubricView decisions={decisions} showSuggestions /></>}
      <Checkpoints session={session} edit={edit} />
    </> : null}
    <Reference session={session} edit={edit} refKey="design" hasAnswer={stageHasContent(session, 'design')}>
      <p>{definition.reference.architecture.summary}</p><List items={definition.roles.map(role => `${role.required ? 'Expected' : 'Optional'}: ${role.label} (${role.kinds.map(kind => byKind[kind].label).join(' / ')}). ${role.why}`)} />
    </Reference>
  </>;
}

function PromptCard({ prompt, session, value, onChange, edit, onResource, refKey, extra, submitted, onSubmit }: { prompt: Prompt; session: InterviewSession; value: string; onChange: (value: string) => void; edit: StageProps['edit']; onResource: (resource: Resource) => void; refKey: string; extra?: React.ReactNode; submitted?: boolean; onSubmit?: () => void }) {
  return <article className="fz-iv-card fz-iv-prompt">
    <header><b>{prompt.title}</b><span className="fz-tag">{COMPETENCY_LABELS[prompt.competency]}</span>{submitted && <span className="fz-tag is-accent">Answered</span>}</header>
    <p className="fz-task__prompt">{prompt.question}</p>
    {extra}
    <textarea aria-label={`Answer: ${prompt.title}`} rows={5} value={value} onChange={event => onChange(event.target.value)} placeholder="Explain your reasoning in terms of your design." />
    {onSubmit && !submitted && <div className="fz-brief__actions"><button className="fz-btn fz-btn--small fz-btn--primary" disabled={!value.trim()} onClick={onSubmit}><Send size={12} />Submit answer</button><span className="fz-brief__note">The interviewer’s next question depends on your submitted answer. You can still edit it afterwards.</span></div>}
    {session.mode === 'practice' && <ResourceLinks resources={prompt.resources} onResource={onResource} />}
    <Reference session={session} edit={edit} refKey={refKey} hasAnswer={onSubmit ? Boolean(submitted) : Boolean(value.trim())} need={onSubmit ? 'Submit your answer first' : undefined}><List items={prompt.reference} /><h4>Common mistakes</h4><List items={prompt.mistakes} />
      <h4>How the answer is assessed</h4><p className="fz-brief__note">Each consideration below that your answer covers raises the score (0–4 by the share covered). Answers under 8 words, or that state one of the contradictions, are capped at 1. These are keyword rules: they recognise vocabulary, not understanding.</p>
      <List items={[...prompt.concepts.map(concept => `Covers ${concept.label}`), ...(prompt.contradictions ?? []).map(entry => `Capped if it ${entry.label}`)]} /></Reference>
  </article>;
}

function DeepDiveStage({ definition, session, patch, edit, onResource }: StageProps & { onResource: (resource: Resource) => void }) {
  return <>
    <p className="fz-prose__p">Choose the topics where your design makes a real choice and explain how it handles them. Answer at least two; unanswered topics are not scored, but answering none is. Points you cover well here are not asked again as follow-ups.</p>
    {definition.deepDives.map(prompt => <PromptCard key={prompt.id} prompt={prompt} session={session} value={session.deepDives[prompt.id] ?? ''} onChange={value => patch({ deepDives: { ...session.deepDives, [prompt.id]: value } })} edit={edit} onResource={onResource} refKey={`deep:${prompt.id}`} />)}
  </>;
}

function FollowUpStage({ definition, session, edit, onResource }: StageProps & { onResource: (resource: Resource) => void }) {
  const plan = useMemo(() => planFollowUps(definition, session), [definition, session]);
  const isolated = useIsolatedRun(definition);
  // Record which questions were presented and why, so the report and playback show exactly what was asked.
  const pending = plan.active.filter(item => item.applies && !session.followUps[item.followUp.id]).map(item => ({ id: item.followUp.id, reason: `${item.reason} (Rule: ${item.rule}.)` }));
  const pendingKey = JSON.stringify(pending);
  useEffect(() => { const items = JSON.parse(pendingKey) as typeof pending; if (items.length) edit(current => markAsked(current, items, Date.now())); }, [edit, pendingKey]);
  return <>
    <p className="fz-prose__p">The interviewer challenges your design. Questions are chosen by explicit rules from your architecture, your answers and what you have left out; the rule is shown with each. Submitting an answer can open a deeper question. Questions marked “testable” can be run on your design in the simulator; the others are hypothetical.</p>
    {!session.architecture?.nodes.length && <div className="fz-alert is-warn"><span>Design your architecture first: most follow-ups depend on it.</span></div>}
    {plan.active.map(({ followUp, rule, applies, depth }) => {
      const scenario = followUp.scenario; const testable = scenario ? scenarioApplies(session.architecture, scenario) : false;
      const run = session.scenarioRuns[followUp.id]; const stale = Boolean(run && run.architectureKey !== architectureKey(session.architecture));
      const submitted = isSubmitted(session, followUp.id);
      const leads = submitted && session.mode === 'practice' ? nextQuestions(definition, followUp.id) : [];
      return <div key={followUp.id} className="fz-iv-followup" style={{ marginLeft: Math.min(depth, 3) * 18 }}>
        <PromptCard prompt={followUp} session={session} value={session.followUps[followUp.id]?.answer ?? ''} onChange={value => edit(current => answerFollowUp(current, followUp.id, value, Date.now()))} edit={edit} onResource={onResource} refKey={`fu:${followUp.id}`}
          submitted={submitted} onSubmit={() => edit(current => submitFollowUp(current, followUp.id, Date.now()))}
          extra={<>
            <p className="fz-iv-because">{applies ? <>Asked because: {followUp.because} <span className="fz-iv-rule">Rule: {rule}.</span></> : 'Asked earlier; its trigger no longer applies to your current design.'}</p>
            {scenario && testable ? <div className="fz-iv-scenario"><span className="fz-support is-simulated">Testable</span> The simulator can run this on your design: {scenarioLabel(definition, scenario)}.
              <button className="fz-btn fz-btn--small" disabled={isolated.running} onClick={() => isolated.run(session.architecture, scenario, evidence => edit(current => logEvent({ ...current, scenarioRuns: { ...current.scenarioRuns, [followUp.id]: evidence } }, 'scenario', `Scenario “${followUp.title}”: ${evidence.label}`, Date.now(), followUp.id)))}><FlaskConical size={12} />{isolated.running ? 'Running…' : 'Run scenario'}</button></div>
              : <p className="fz-iv-because"><span className="fz-support is-theory">Hypothetical</span> {scenario ? 'Your design has no component this scenario affects, so it is not simulated.' : 'Not simulated; answer from your design and reasoning.'}</p>}
            {run && <EvidenceView evidence={run} definition={definition} stale={stale} />}
            {leads.length > 0 && <details className="fz-iv-leads"><summary>Where this can lead</summary><ul className="fz-prose__list">{leads.map(entry => <li key={entry.followUp.id}><b>{entry.followUp.title}</b> — asked {entry.condition}.</li>)}</ul></details>}
          </>} />
      </div>;
    })}
    {plan.suppressed.length > 0 && <details className="fz-iv-suppressed"><summary>Questions held back ({plan.suppressed.length})</summary>
      <p className="fz-brief__note">The interviewer avoids repeating topics and asking what you already covered.</p>
      <ul className="fz-prose__list">{plan.suppressed.map(entry => <li key={entry.followUp.id}><b>{entry.followUp.title}</b> — {entry.why}</li>)}</ul></details>}
    {isolated.error && <div className="fz-alert is-warn" role="alert"><span>{isolated.error}</span></div>}
  </>;
}

/** One requirement change: introduce it (the design is checkpointed), revise, measure both designs where possible, and respond. */
function ChangeCard({ definition, session, edit, change, onResource, onOpenCanvas }: Pick<StageProps, 'definition' | 'session' | 'edit'> & { change: RequirementChange; onResource: (resource: Resource) => void; onOpenCanvas: () => void }) {
  const isolated = useIsolatedRun(definition);
  const response = session.changes[change.id];
  const comparison = useMemo(() => compareChange(definition, session, change), [definition, session, change]);
  const baseline = checkpointById(session, response?.baselineId); const revision = checkpointById(session, response?.revisionId);
  const runnable = changeRunnable(change, session.architecture);
  const revisionStale = Boolean(revision && architectureKey(revision.architecture) !== architectureKey(session.architecture));
  const runOn = (which: 'original' | 'revised') => { const architecture = which === 'original' ? baseline?.architecture : revision?.architecture; if (!architecture) return;
    isolated.run(architecture, change.scenario, evidence => edit(current => recordChangeRun(current, change.id, which, evidence, Date.now())), changeRunLabel(definition, change)); };
  return <article className="fz-iv-card fz-iv-change">
    <header><b>{change.title}</b><span className="fz-tag">{COMPETENCY_LABELS[change.competency]}</span>{change.scenario || change.targets ? <span className="fz-support is-simulated">Measurable</span> : <span className="fz-support is-theory">Hypothetical</span>}{response?.submittedAt && <span className="fz-tag is-accent">Answered</span>}</header>
    {!response ? <>
      <p className="fz-brief__note">{change.why}</p>
      <button className="fz-btn fz-btn--small fz-btn--primary" disabled={!session.architecture?.nodes.length} onClick={() => edit(current => introduceChange(current, change.id, change.title, Date.now()))}><GitCompareArrows size={12} />Take on this change</button>
      {!session.architecture?.nodes.length && <small className="fz-brief__note"> Design an architecture first.</small>}
    </> : <>
      <p className="fz-task__prompt"><b>Interviewer:</b> {change.change}</p>
      <p className="fz-brief__note">{change.why} The design as it was is kept as the checkpoint “{baseline?.label}”. Revise the working design on the canvas, then save the revision; the original is never overwritten.</p>
      <p className="fz-iv-because"><b>What the simulator can show:</b> {change.measurable} <b>Not modelled:</b> {change.notModelled}</p>
      <div className="fz-brief__actions">
        <button className="fz-btn fz-btn--small" onClick={onOpenCanvas}><PencilRuler size={12} />Revise on the canvas</button>
        <button className="fz-btn fz-btn--small" onClick={() => edit(current => reviseChange(current, change.id, change.title, Date.now()))}><Bookmark size={12} />{revision ? 'Save the revision again' : 'Save revised design'}</button>
        {(change.scenario || change.targets) && <>
          <button className="fz-btn fz-btn--small" disabled={isolated.running || !runnable || !baseline} onClick={() => runOn('original')}><FlaskConical size={12} />Run on original</button>
          <button className="fz-btn fz-btn--small" disabled={isolated.running || !revision || !changeRunnable(change, revision.architecture)} onClick={() => runOn('revised')}><FlaskConical size={12} />Run on revised</button></>}
      </div>
      {revisionStale && <p className="fz-brief__note">The working design has changed since the revision was saved. Save it again to compare the latest version.</p>}
      {change.scenario && !runnable && <p className="fz-brief__note">Your design has no component this scenario affects, so it cannot be run.</p>}
      {isolated.error && <div className="fz-alert is-warn" role="alert"><span>{isolated.error}</span></div>}
      <ChangeComparisonView comparison={comparison} />
      <label className="fz-iv-answer"><span>Your response</span><small>What breaks, what you changed and why, and what you would measure.</small>
        <textarea aria-label={`Response: ${change.title}`} rows={5} value={response.answer} onChange={event => edit(current => answerChange(current, change.id, event.target.value, Date.now()))} /></label>
      {!response.submittedAt && <div className="fz-brief__actions"><button className="fz-btn fz-btn--small fz-btn--primary" disabled={!response.answer.trim()} onClick={() => edit(current => submitChange(current, change.id, Date.now()))}><Send size={12} />Submit response</button></div>}
      {session.mode === 'practice' && <ResourceLinks resources={change.resources} onResource={onResource} />}
      <Reference session={session} edit={edit} refKey={`change:${change.id}`} hasAnswer={Boolean(response.submittedAt)} need="Submit your response first">
        <h4>Expected considerations</h4><List items={change.considerations.map(concept => concept.label)} />
        <h4>Alternatives that suit the change</h4><List items={change.alternatives} />
        <h4>Common mistakes</h4><List items={change.mistakes} />
      </Reference>
    </>}
  </article>;
}
function ChangesStage({ definition, session, edit, onResource, onOpenCanvas }: StageProps & { onResource: (resource: Resource) => void; onOpenCanvas: () => void }) {
  const changes = definition.changes ?? [];
  const taken = changes.filter(change => session.changes[change.id]).length;
  return <>
    <p className="fz-prose__p">Requirements change mid-interview. Take on at least one change: your current design is kept as the original, you revise the working design, and the two are compared, by measurement where the simulator can model the change and structurally otherwise. Hypothetical changes are judged on your reasoning only.</p>
    <p className="fz-brief__note">{taken} of {changes.length} changes taken on. {session.checkpoints.length} checkpoint{session.checkpoints.length === 1 ? '' : 's'} saved.</p>
    {!session.architecture?.nodes.length && <div className="fz-alert is-warn"><span>Design your architecture first: changes are applied to it.</span></div>}
    {changes.map(change => <ChangeCard key={change.id} definition={definition} session={session} edit={edit} change={change} onResource={onResource} onOpenCanvas={onOpenCanvas} />)}
    <p className="fz-brief__note"><History size={12} aria-hidden /> Every checkpoint is kept in the interview record and can be inspected in its playback.</p>
  </>;
}

function ReviewStage({ session, patch }: StageProps) {
  const set = (key: keyof InterviewSession['review']) => (value: string) => patch({ review: { ...session.review, [key]: value } });
  return <>
    <p className="fz-prose__p">Summarise as you would at the end of a real interview. Each section is checked for completeness (at least 12 words); trade-off vocabulary across all your answers is checked against this problem’s key trade-offs.</p>
    <div className="fz-iv-grid">
      <Answer label="Final architecture" value={session.review.architecture} onChange={set('architecture')} />
      <Answer label="Most important design decisions" value={session.review.decisions} onChange={set('decisions')} />
      <Answer label="Major bottlenecks" value={session.review.bottlenecks} onChange={set('bottlenecks')} />
      <Answer label="Failure handling" value={session.review.failures} onChange={set('failures')} />
      <Answer label="Known limitations" value={session.review.limitations} onChange={set('limitations')} />
      <Answer label="Trade-offs and alternatives" value={session.review.tradeoffs} onChange={set('tradeoffs')} />
    </div>
  </>;
}
