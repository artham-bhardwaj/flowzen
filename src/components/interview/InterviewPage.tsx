import { useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, CircleCheck, CircleDot, Clock, FlaskConical, History, MessagesSquare, Play, PlayCircle, Target, Timer, Trophy } from 'lucide-react';
import type { Kind } from '../../app/catalog';
import { PROBLEMS, problemById } from '../../interview';
import { COMPETENCY_RESOURCES, evaluationOf, recommendations, stats, suggestInterview } from '../../interview/analytics';
import { DRILLS, SKILLS, SKILL_LABELS, drillById, recommendDrills } from '../../interview/drills';
import { planFor } from '../../interview/session';
import { formatDuration } from '../../interview/workflow';
import { usePractice, type PracticeController } from '../../interview/usePractice';
import type { InterviewRecord } from '../../interview/store';
import { CATEGORY_LABELS, COMPETENCY_LABELS, DIFFICULTY_LABELS, MOCK_DURATIONS, STAGE_LABELS, stagesOf, type Category, type CompetencyId, type Difficulty, type InterviewDefinition, type Resource } from '../../interview/types';
import type { InterviewController } from '../../interview/useInterviews';
import { CatalogBody, CatalogCard, CatalogHero, DetailHero, Facet, FilterSidebar, RelatedResources, ResultsBar, SiteFooter, type FooterTarget } from '../catalog/Shell';
import { DrillView } from './DrillView';
import { PlaybackView } from './PlaybackView';
import { ReportView } from './ReportView';
import { SessionView } from './SessionView';
import { ResourceLinks, ScorePill } from './shared';

export type InterviewView =
  | { type: 'dashboard' } | { type: 'library'; competency?: CompetencyId } | { type: 'problem'; id: string }
  | { type: 'session'; id: string } | { type: 'report'; id: string } | { type: 'playback'; id: string } | { type: 'history' } | { type: 'drill'; id: string };
type Props = {
  ctl: InterviewController; view: InterviewView; onView: (view: InterviewView) => void;
  onOpenCanvas: (sessionId: string, definition: InterviewDefinition) => void; onResource: (resource: Resource) => void;
  onFooter: (target: FooterTarget) => void;
};
const when = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const TONES: Record<Difficulty, string> = { beginner: 'level-easy', intermediate: 'level-medium', advanced: 'level-hard', expert: 'level-expert' };
const ROUTING: Kind[] = ['server', 'containerService', 'serverless', 'loadBalancer', 'gateway', 'reverseProxy', 'client'];
/** The component that best represents a problem on its card: its first distinctive required role. */
/** The offered mock length closest to a problem's typical duration. */
const nearestDuration = (minutes: number) => MOCK_DURATIONS.reduce((best, value) => Math.abs(value - minutes) < Math.abs(best - minutes) ? value : best, MOCK_DURATIONS[0]);
const problemKind = (problem: InterviewDefinition): Kind => problem.roles.find(role => role.required && !ROUTING.includes(role.kinds[0]))?.kinds[0] ?? problem.roles[0].kinds[0];

/** The Interview section: catalog dashboard, problem detail, session workspace, reports and history. */
export function InterviewPage(props: Props) {
  const { ctl, view, onView } = props;
  const practice = usePractice();
  const start = (definitionId: string, mode: 'practice' | 'mock', durationMin?: number, from?: InterviewRecord, checkpointId?: string) => { const definition = problemById(definitionId); if (!definition) return; const session = ctl.start(definition, mode, durationMin, from, checkpointId); onView({ type: 'session', id: session.id }); };
  const alerts = (ctl.dropped.length > 0 || ctl.state.unreadable.length > 0 || ctl.saveFailed || practice.saveFailed) && <div className="fz-learn__alerts">
    {(ctl.dropped.length > 0 || ctl.state.unreadable.length > 0) && <div className="fz-alert is-warn"><span><b>Some saved interviews could not be loaded</b>They are kept unchanged and not shown, rather than repaired{ctl.dropped.length ? `: ${ctl.dropped.join('; ')}` : ` (${ctl.state.unreadable.length})`}.
      <button className="fz-link" onClick={() => { if (window.confirm(`Permanently delete ${ctl.state.unreadable.length} unreadable interview entr${ctl.state.unreadable.length === 1 ? 'y' : 'ies'}? Readable drafts and records are not affected.`)) ctl.purgeUnreadable(); }}>Delete them</button></span></div>}
    {practice.saveFailed && <div className="fz-alert is-bad"><span>Targeted practice could not be saved in this browser.</span></div>}
    {ctl.saveFailed && <div className="fz-alert is-bad"><span>Interviews could not be saved in this browser (storage full or blocked). Work is kept for this session only.</span></div>}
  </div>;
  if (view.type === 'session') {
    const session = ctl.state.drafts.find(entry => entry.id === view.id); const definition = session && problemById(session.definitionId);
    if (!session || !definition) return <div className="fz-page fz-iv"><div className="fz-iv-page"><p className="fz-empty-note">This session is no longer available (it was finished or discarded).</p><button className="fz-btn" onClick={() => onView({ type: 'dashboard' })}>Interviews</button></div></div>;
    return <div className="fz-page fz-iv is-session">{alerts}<SessionView definition={definition} session={session} ctl={ctl} onOpenCanvas={() => props.onOpenCanvas(session.id, definition)} onResource={props.onResource} onFinished={id => onView({ type: 'report', id })} onLeave={() => onView({ type: 'dashboard' })} /></div>;
  }
  if (view.type === 'dashboard' || view.type === 'library') return <div className="fz-page fz-catalog fz-iv">{alerts}<Catalog {...props} start={start} practice={practice} competency={view.type === 'library' ? view.competency : undefined} /><SiteFooter onNavigate={props.onFooter} /></div>;
  return <div className="fz-page fz-iv"><div className="fz-iv-page">{alerts}
    {view.type === 'problem' && problemById(view.id) && <ProblemDetail definition={problemById(view.id)!} ctl={ctl} start={start} onBack={() => onView({ type: 'dashboard' })} onResource={props.onResource} onView={onView} />}
    {view.type === 'history' && <HistoryView ctl={ctl} onView={onView} />}
    {view.type === 'report' && (() => { const record = ctl.state.records.find(entry => entry.id === view.id); return record
      ? <ReportView record={record} ctl={ctl} onBack={() => onView({ type: 'dashboard' })} onResource={props.onResource} onStartFrom={from => start(from.definitionId, from.session.mode, from.session.durationMin ?? undefined, from)} onRetry={id => onView({ type: 'problem', id })} onOpenProblem={id => onView({ type: 'problem', id })} onPlayback={id => onView({ type: 'playback', id })} />
      : <p className="fz-empty-note">This interview record is not available.</p>; })()}
    {view.type === 'playback' && (() => { const record = ctl.state.records.find(entry => entry.id === view.id); return record
      ? <PlaybackView record={record} ctl={ctl} onBack={() => onView({ type: 'dashboard' })} onReport={id => onView({ type: 'report', id })} onResource={props.onResource} onLoadDraft={(from, checkpointId) => start(from.definitionId, 'practice', undefined, from, checkpointId)} />
      : <p className="fz-empty-note">This interview record is not available.</p>; })()}
    {view.type === 'drill' && (drillById(view.id) ? <DrillView key={view.id} drill={drillById(view.id)!} practice={practice} onBack={() => onView({ type: 'dashboard' })} onResource={props.onResource} /> : <p className="fz-empty-note">This drill is not available.</p>)}
  </div><SiteFooter onNavigate={props.onFooter} /></div>;
}

type Status = 'new' | 'draft' | 'done';
type Duration = 'short' | 'medium' | 'long';
type Sort = 'recommended' | 'easiest' | 'shortest' | 'skill';
type Filters = { levels: Difficulty[]; categories: Category[]; statuses: Status[]; durations: Duration[] };
const EMPTY: Filters = { levels: [], categories: [], statuses: [], durations: [] };
const STATUS_LABELS: Record<Status, string> = { new: 'Not started', draft: 'In progress', done: 'Completed' };
const DURATION_LABELS: Record<Duration, string> = { short: '40 minutes or less', medium: '45 minutes', long: '50 minutes or more' };
const durationOf = (problem: InterviewDefinition): Duration => problem.minutes <= 40 ? 'short' : problem.minutes < 50 ? 'medium' : 'long';
const relevance = (problem: InterviewDefinition, competency: CompetencyId) => [...problem.deepDives, ...problem.followUps].filter(prompt => prompt.competency === competency).length;
const LEVELS: Difficulty[] = ['beginner', 'intermediate', 'advanced', 'expert'];
const STATUS_CLASS: Record<Status, string> = { new: 'new', draft: 'attempted', done: 'solved' };

function Catalog({ ctl, onView, onResource, start, competency, practice }: Props & { start: (id: string, mode: 'practice' | 'mock', durationMin?: number) => void; competency?: CompetencyId; practice: PracticeController }) {
  const summary = useMemo(() => stats(ctl.state), [ctl.state]);
  const recs = recommendations(null, summary, PROBLEMS, ctl.state);
  const firstPick = suggestInterview(PROBLEMS, ctl.state, competency ?? summary.needsWork[0] ?? null) ?? PROBLEMS[0];
  const drafts = [...ctl.state.drafts].sort((a, b) => b.updatedAt - a.updatedAt);
  const [query, setQuery] = useState(''); const [filters, setFilters] = useState<Filters>(EMPTY); const [sort, setSort] = useState<Sort>(competency ? 'skill' : 'recommended'); const [filtersOpen, setFiltersOpen] = useState(false);
  const results = useRef<HTMLDivElement>(null);
  const statusOf = (problem: InterviewDefinition): Status => ctl.state.records.some(record => record.definitionId === problem.id) ? 'done' : ctl.state.drafts.some(draft => draft.definitionId === problem.id) ? 'draft' : 'new';
  const matches = (problem: InterviewDefinition, ignore?: keyof Filters) => (ignore === 'levels' || !filters.levels.length || filters.levels.includes(problem.difficulty))
    && (ignore === 'categories' || !filters.categories.length || filters.categories.some(category => problem.categories.includes(category)))
    && (ignore === 'statuses' || !filters.statuses.length || filters.statuses.includes(statusOf(problem)))
    && (ignore === 'durations' || !filters.durations.length || filters.durations.includes(durationOf(problem)))
    && (!query.trim() || `${problem.title} ${problem.summary} ${problem.topics.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const sorted = PROBLEMS.filter(problem => matches(problem)).map((problem, order) => ({ problem, order })).sort((a, b) =>
    sort === 'easiest' ? LEVELS.indexOf(a.problem.difficulty) - LEVELS.indexOf(b.problem.difficulty) || a.order - b.order
    : sort === 'shortest' ? a.problem.minutes - b.problem.minutes || a.order - b.order
    : sort === 'skill' && competency ? relevance(b.problem, competency) - relevance(a.problem, competency) || a.order - b.order
    : Number(statusOf(b.problem) === 'draft') - Number(statusOf(a.problem) === 'draft') || a.order - b.order).map(entry => entry.problem);
  const countFor = <K extends keyof Filters>(facet: K, values: readonly Filters[K][number][], test: (problem: InterviewDefinition, value: Filters[K][number]) => boolean) =>
    Object.fromEntries(values.map(value => [value, PROBLEMS.filter(problem => matches(problem, facet) && test(problem, value)).length])) as Record<Filters[K][number], number>;
  const toggle = <K extends keyof Filters>(facet: K, value: Filters[K][number]) => setFilters(current => ({ ...current, [facet]: (current[facet] as string[]).includes(value) ? (current[facet] as string[]).filter(entry => entry !== value) : [...current[facet], value] }));
  const active = filters.levels.length + filters.categories.length + filters.statuses.length + filters.durations.length + (query.trim() ? 1 : 0);
  const clear = () => { setFilters(EMPTY); setQuery(''); };
  const categories = Object.keys(CATEGORY_LABELS) as Category[];
  const statuses: Status[] = ['new', 'draft', 'done']; const durations: Duration[] = ['short', 'medium', 'long'];
  const showCategory = (category: Category) => { setFilters({ ...EMPTY, categories: [category] }); results.current?.scrollIntoView({ block: 'start' }); };
  const sorts: Array<[Sort, string]> = [['recommended', 'Recommended'], ['easiest', 'Easiest first'], ['shortest', 'Shortest first'], ...(competency ? [['skill', 'Best for this skill'] as [Sort, string]] : [])];

  return <>
    <CatalogHero id="fz-iv-title" crumbs={[{ label: 'Flowzen' }, { label: 'Interview' }]} title="System design interview problems."
      intro="Work through a real interview structure: clarify requirements, estimate, design the API and data model, build the architecture on the canvas, defend it under follow-up questions, and get a transparent, rule-based evaluation with evidence. Everything runs in your browser; no AI service is involved."
      more={['Practice mode gives hints on request and reference considerations after you answer; mock mode adds a timer and hides references until you finish.', 'Scores come from explicit rules: structural checks of your design, isolated simulation runs, arithmetic tolerances and keyword checks, each labelled in the report.', 'Weak areas link to lessons, component guides, low-level designs and Playground experiments.']}
      topics={categories.map(category => ({ label: CATEGORY_LABELS[category], onClick: () => showCategory(category) }))}
      aside={<aside className="fz-hero__card" aria-label="Start an interview">
        <span className="fz-hero__next">{summary.completed ? 'Suggested next' : 'Start here'}</span><b className="fz-hero__nexttitle">{firstPick.title}</b><span className="fz-hero__nextmeta">{DIFFICULTY_LABELS[firstPick.difficulty]} · about {firstPick.minutes} min</span>
        <div className="fz-iv-hero-actions"><button className="fz-cta" onClick={() => start(firstPick.id, 'practice')}><Play size={14} aria-hidden />Practice</button><button className="fz-cta is-secondary" onClick={() => start(firstPick.id, 'mock', nearestDuration(firstPick.minutes))}><Timer size={14} aria-hidden />Mock ({nearestDuration(firstPick.minutes)} min)</button></div>
      </aside>} />
    {drafts.length > 0 && <section className="fz-catalog__strip" aria-labelledby="iv-continue"><h2 id="iv-continue">Continue</h2>
      <ul className="fz-practice">{drafts.map(draft => { const definition = problemById(draft.definitionId); return <li key={draft.id}>
        <div><b>{definition?.title ?? draft.definitionId}</b><span>{draft.mode === 'mock' ? `Mock · ${draft.durationMin} min` : 'Practice'} · {STAGE_LABELS[draft.stage]} · {formatDuration(draft.timing.totalMs)} spent · saved {when(draft.updatedAt)}</span></div>
        <button className="fz-btn fz-btn--small fz-btn--primary" onClick={() => onView({ type: 'session', id: draft.id })}>Continue <ArrowRight size={12} /></button></li>; })}</ul></section>}

    <div ref={results}><CatalogBody sidebar={<FilterSidebar open={filtersOpen} active={active} onClear={clear} query={query} onQuery={setQuery} placeholder="Search interview problems">
      <Facet title="Level" values={LEVELS} labels={value => DIFFICULTY_LABELS[value]} counts={countFor('levels', LEVELS, (problem, value) => problem.difficulty === value)} selected={filters.levels} onToggle={value => toggle('levels', value)} />
      <Facet title="Status" values={statuses} labels={value => STATUS_LABELS[value]} counts={countFor('statuses', statuses, (problem, value) => statusOf(problem) === value)} selected={filters.statuses} onToggle={value => toggle('statuses', value)} />
      <Facet title="Average time to complete" values={durations} labels={value => DURATION_LABELS[value]} counts={countFor('durations', durations, (problem, value) => durationOf(problem) === value)} selected={filters.durations} onToggle={value => toggle('durations', value)} />
      <Facet title="Category" values={categories} labels={value => CATEGORY_LABELS[value]} counts={countFor('categories', categories, (problem, value) => problem.categories.includes(value))} selected={filters.categories} onToggle={value => toggle('categories', value)} />
    </FilterSidebar>}>
      {competency && <div className="fz-alert is-ok fz-iv-skillnote"><span><b>Practising: {COMPETENCY_LABELS[competency]}</b>Problems are ordered by how many of their deep dives and follow-ups assess it. Learn it first:<ResourceLinks resources={COMPETENCY_RESOURCES[competency]} onResource={onResource} /></span></div>}
      <ResultsBar count={sorted.length} active={active} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen(open => !open)} sort={sort} sorts={sorts} onSort={setSort} sortLabel="Sort interview problems" />
      {sorted.length ? <div className="fz-card-grid">{sorted.map(problem => {
        const status = statusOf(problem); const best = summary.best.find(entry => entry.definitionId === problem.id); const draft = drafts.find(entry => entry.definitionId === problem.id);
        return <CatalogCard key={problem.id} tone={TONES[problem.difficulty]} className={`is-${STATUS_CLASS[status]}`} kind={problemKind(problem)} number={PROBLEMS.indexOf(problem) + 1}
          type="Interview" status={<span className={`fz-cstatus is-${STATUS_CLASS[status]}`}>{status === 'done' ? <CircleCheck size={12} aria-hidden /> : <CircleDot size={12} aria-hidden />}{STATUS_LABELS[status]}</span>}
          title={problem.title} description={problem.summary}
          meta={[{ icon: Check, text: DIFFICULTY_LABELS[problem.difficulty] }, { icon: Clock, text: `About ${problem.minutes} minutes` }, { icon: Check, text: `${problem.deepDives.length} deep dives · ${problem.followUps.length + problem.sharedFollowUps.length} possible follow-ups` }, ...(best ? [{ icon: Trophy, text: `Best score ${best.percent}%` }] : [])]}
          topics={problem.topics.slice(0, 4)}
          cta={{ label: draft ? 'Continue' : status === 'done' ? 'Practise again' : 'Start interview', secondary: status === 'done', ariaLabel: `Open ${problem.title}`, onClick: () => draft ? onView({ type: 'session', id: draft.id }) : onView({ type: 'problem', id: problem.id }) }} />;
      })}</div> : <div className="fz-catalog__empty"><b>No problems match.</b><button className="fz-btn" onClick={clear}>Clear filters</button></div>}

      <section className="fz-catalog__section" aria-labelledby="iv-progress"><h2 id="iv-progress">Your preparation</h2>
        {summary.completed === 0 ? <div className="fz-iv-empty"><MessagesSquare size={22} aria-hidden /><div><b>No completed interviews yet</b><p>Scores, competency trends and recurring mistakes appear after your first completed interview. Nothing is estimated before then. A good first step is a practice interview on {firstPick.title}, with hints available.</p></div></div> : <>
          <div className="fz-kpis fz-iv-kpis"><div className="fz-kpi"><span>Interviews completed</span><b>{summary.completed}</b></div><div className="fz-kpi"><span>Average score</span><b>{summary.averagePercent}%</b></div><div className="fz-kpi"><span>Problems practised</span><b>{summary.practiced.length}</b></div></div>
          <h3>Scores by competency</h3>
          <ul className="fz-iv-bars">{summary.competencies.map(entry => <li key={entry.id}><span>{entry.label}</span><span className="fz-bar"><span style={{ width: `${entry.average === null ? 0 : entry.average / 4 * 100}%` }} /></span><ScorePill score={entry.average} />
            <small>{entry.sessions ? `${entry.sessions} session${entry.sessions === 1 ? '' : 's'}${entry.trend.length > 1 ? ` · trend ${entry.trend.map(value => value.toFixed(1)).join(' → ')}` : ''}` : 'not assessed yet'}</small></li>)}</ul>
          <div className="fz-dashboard__cols">
            <section><h3>Recent interviews</h3><ul className="fz-explist">{summary.recent.map(record => <li key={record.id}><button className="fz-link" onClick={() => onView({ type: 'report', id: record.id })}>{record.title}</button><span>{evaluationOf(ctl.state, record).overall.percent}% · {record.session.mode} · {when(record.completedAt)}</span></li>)}</ul></section>
            <section><h3>Recurring mistakes</h3>{summary.recurringMistakes.length ? <ul className="fz-prose__list">{summary.recurringMistakes.map(entry => <li key={entry.label}>{entry.label} <em>({entry.count}×)</em></li>)}</ul> : <p className="fz-empty-note">No mistake has repeated across interviews yet.</p>}</section>
          </div>
          <div className="fz-dashboard__cols">
            <section><h3>Topics practised</h3><p className="fz-prose__p">{summary.practiced.join(', ')}</p></section>
            <section><h3>Needs improvement</h3>{summary.needsWork.length ? <ul className="fz-prose__list">{summary.needsWork.map(id => <li key={id}>{COMPETENCY_LABELS[id]}</li>)}</ul> : <p className="fz-empty-note">No competency averages below 2.5 / 4.</p>}</section>
          </div>
          {recs.length > 0 && <><h3>Recommended practice</h3><ul className="fz-iv-recs">{recs.map(rec => <li key={rec.competency}><b>{rec.label}</b><ResourceLinks resources={rec.resources} onResource={onResource} />{rec.interview && <p className="fz-brief__note">Interview: <button className="fz-link" onClick={() => onView({ type: 'problem', id: rec.interview!.id })}>{rec.interview.title}</button></p>}</li>)}</ul></>}
        </>}
      </section>
      <PracticeSection ctl={ctl} practice={practice} onView={onView} />
      <section className="fz-catalog__section" aria-labelledby="iv-skill"><h2 id="iv-skill">Practise a specific skill</h2>
        <p className="fz-brief__note">Pick a competency to order problems by how much they exercise it, with resources to learn it.</p>
        <div className="fz-iv-skills">{(Object.keys(COMPETENCY_LABELS) as CompetencyId[]).map(id => <button key={id} className={`fz-chip${competency === id ? ' is-on' : ''}`} aria-pressed={competency === id} onClick={() => onView({ type: 'library', competency: id })}><Target size={11} aria-hidden />{COMPETENCY_LABELS[id]}</button>)}</div>
      </section>
      <RelatedResources id="iv-related" items={[
        { icon: History, type: 'History', title: 'Review past interviews', text: summary.completed ? `${summary.completed} completed: reports, references and trends.` : 'Completed interviews appear here.', onClick: () => onView({ type: 'history' }) },
        { icon: BookOpen, type: 'Learn', title: 'System design track', text: 'Lessons, experiments and exercises behind every competency assessed here.', onClick: () => onResource({ type: 'lesson', id: 'approach' }) },
        { icon: FlaskConical, type: 'Playground', title: 'Guided experiments', text: 'Measure caching, scaling, queues and failures before defending them in an interview.', onClick: () => onResource({ type: 'experiment', id: 'cache-vs-database' }) },
      ]} />
    </CatalogBody></div>
  </>;
}

function ProblemDetail({ definition, ctl, start, onBack, onResource, onView }: { definition: InterviewDefinition; ctl: InterviewController; start: (id: string, mode: 'practice' | 'mock', durationMin?: number) => void; onBack: () => void; onResource: (resource: Resource) => void; onView: (view: InterviewView) => void }) {
  const [duration, setDuration] = useState<number>(nearestDuration(definition.minutes));
  const budgets = planFor(definition, duration);
  const records = ctl.state.records.filter(record => record.definitionId === definition.id).reverse();
  const drafts = ctl.state.drafts.filter(draft => draft.definitionId === definition.id);
  return <article className="fz-iv-detail" aria-labelledby="fz-iv-problem-title">
    <DetailHero id="fz-iv-problem-title" crumbs={[{ label: 'Flowzen', onClick: onBack }, { label: 'Interview', onClick: onBack }, { label: definition.title }]}
      eyebrow={`${DIFFICULTY_LABELS[definition.difficulty]} · ${definition.categories.map(id => CATEGORY_LABELS[id]).join(', ')} · about ${definition.minutes} min`} title={definition.title} summary={definition.statement} />
    <p className="fz-brief__note">Topics: {definition.topics.join(', ')}. The problem statement is all you get at the start; requirements, scale and constraints come from the questions you ask.</p>
    {drafts.length > 0 && <div className="fz-alert is-warn"><span><b>You have an unfinished session for this problem</b><button className="fz-link" onClick={() => onView({ type: 'session', id: drafts[0].id })}>Continue it</button> or start a new one below (the old draft is kept).</span></div>}
    <div className="fz-iv-modes">
      <section className="fz-iv-card"><h2>Practice</h2><ul className="fz-prose__list"><li>No countdown; time is still recorded.</li><li>Hints on request; learning resources linked.</li><li>Reference considerations after you record an answer.</li><li>Revise answers freely. Hints and references used are recorded in the report.</li></ul>
        <button className="fz-btn fz-btn--primary" onClick={() => start(definition.id, 'practice')}><Play size={13} />Start practice</button></section>
      <section className="fz-iv-card"><h2>Mock interview</h2><ul className="fz-prose__list"><li>Visible timer, time per stage and a plan for each stage, with optional pacing warnings.</li><li>No hints; references and suggested fixes only after you finish.</li><li>Finish early at any time. When time runs out nothing is locked or lost: finish and review, or keep working as overtime.</li><li>Work and the timer are saved continuously; a reload pauses the timer and resumes where you were.</li></ul>
        <fieldset className="fz-iv-duration"><legend>Duration</legend>{MOCK_DURATIONS.map(value => <label key={value} className="fz-check"><input type="radio" name="iv-duration" value={value} checked={duration === value} onChange={() => setDuration(value)} />{value} minutes</label>)}</fieldset>
        <table className="fz-table fz-iv-plan"><caption>Plan for {duration} minutes{definition.stageAllocation ? ' (set for this problem)' : ''}</caption><tbody>{stagesOf(definition).map(stage => <tr key={stage}><th scope="row">{STAGE_LABELS[stage]}</th><td>{budgets[stage]} min</td></tr>)}</tbody></table>
        <button className="fz-btn fz-btn--primary" onClick={() => start(definition.id, 'mock', duration)}><Timer size={13} />Start mock interview</button></section>
    </div>
    <h2 className="fz-iv-h2">Prepare</h2>
    <ResourceLinks resources={[...definition.lessons.map(id => ({ type: 'lesson' as const, id })), ...definition.lld.map(kind => ({ type: 'lld' as const, kind }))]} onResource={onResource} />
    {records.length > 0 && <><h2 className="fz-iv-h2">Your previous attempts</h2><ul className="fz-explist">{records.map(record => <li key={record.id}><button className="fz-link" onClick={() => onView({ type: 'report', id: record.id })}>{when(record.completedAt)} · {record.session.mode}</button><span>{evaluationOf(ctl.state, record).overall.percent}%</span></li>)}</ul></>}
  </article>;
}

function HistoryView({ ctl, onView }: { ctl: InterviewController; onView: (view: InterviewView) => void }) {
  const summary = stats(ctl.state); const records = [...ctl.state.records].reverse();
  const back = () => onView({ type: 'dashboard' });
  return <article className="fz-iv-detail" aria-labelledby="fz-iv-history-title">
    <DetailHero id="fz-iv-history-title" crumbs={[{ label: 'Flowzen', onClick: back }, { label: 'Interview', onClick: back }, { label: 'History' }]} title="Interview history" summary="Every completed interview is a read-only record with its answers, architecture snapshot and evaluation." />
    {!records.length ? <p className="fz-empty-note">No completed interviews yet.</p> : <>
      {summary.best.length > 0 && <><h2 className="fz-iv-h2">Best results</h2><ul className="fz-explist">{summary.best.map(entry => <li key={entry.definitionId}><button className="fz-link" onClick={() => onView({ type: 'report', id: entry.recordId })}>{entry.title}</button><span>{entry.percent}%</span></li>)}</ul></>}
      <h2 className="fz-iv-h2">All interviews</h2>
      <table className="fz-table fz-iv-table"><thead><tr><th scope="col">Problem</th><th scope="col">Mode</th><th scope="col">Completed</th><th scope="col">Time</th><th scope="col">Help used</th><th scope="col">Score</th><th scope="col"><span className="fz-visually-hidden">Playback</span></th></tr></thead>
        <tbody>{records.map(record => <tr key={record.id}><th scope="row"><button className="fz-link" onClick={() => onView({ type: 'report', id: record.id })}>{record.title}</button></th><td>{record.session.mode}{record.finishedEarly ? ' (early)' : ''}</td><td>{when(record.completedAt)}</td><td>{formatDuration(record.session.timing.totalMs)}</td><td>{record.session.hintsUsed.length} hints · {record.session.referencesViewed.length} refs</td><td>{evaluationOf(ctl.state, record).overall.percent}%{ctl.state.corrections[record.id]?.length ? ' (corrected)' : ''}</td><td><button className="fz-link" aria-label={`Play back ${record.title}, ${when(record.completedAt)}`} onClick={() => onView({ type: 'playback', id: record.id })}><PlayCircle size={12} aria-hidden /> Playback</button></td></tr>)}</tbody></table>
    </>}
  </article>;
}

/** Targeted practice: drills per skill, with recommendations drawn only from completed interviews and drill results. */
function PracticeSection({ ctl, practice, onView }: { ctl: InterviewController; practice: PracticeController; onView: (view: InterviewView) => void }) {
  const recs = useMemo(() => recommendDrills(ctl.state, practice.state), [ctl.state, practice.state]);
  const best = (drillId: string) => { const scores = practice.state.attempts.filter(entry => entry.drillId === drillId).map(entry => entry.result.percent); return scores.length ? Math.max(...scores) : null; };
  return <section className="fz-catalog__section" aria-labelledby="iv-practice"><h2 id="iv-practice">Targeted practice</h2>
    <p className="fz-brief__note">Short drills for one skill at a time, graded by explicit rules (arithmetic, documented option verdicts, simulator measurements, keyword checks). They are kept separately and never change interview results.</p>
    {recs.length > 0 ? <ul className="fz-iv-recs">{recs.map(rec => <li key={rec.skill}><b>{SKILL_LABELS[rec.skill]}</b><span className="fz-brief__note">{rec.reason}</span><button className="fz-btn fz-btn--small" onClick={() => onView({ type: 'drill', id: rec.drill.id })}>{rec.drill.title}<ArrowRight size={12} /></button></li>)}</ul>
      : <p className="fz-empty-note">Recommendations appear once a completed interview or a drill shows a weak area. Nothing is assumed before then.</p>}
    <div className="fz-iv-drills">{SKILLS.map(skill => <section key={skill} className="fz-iv-card"><h3>{SKILL_LABELS[skill]}</h3>
      <ul className="fz-explist">{DRILLS.filter(drill => drill.skill === skill).map(drill => <li key={drill.id}><button className="fz-link" onClick={() => onView({ type: 'drill', id: drill.id })}>{drill.title}</button><span>{best(drill.id) === null ? `${drill.minutes} min` : `best ${best(drill.id)}%`}</span></li>)}</ul></section>)}</div>
  </section>;
}
