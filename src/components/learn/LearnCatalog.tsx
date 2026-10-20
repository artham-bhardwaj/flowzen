import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, CircleCheck, CircleDashed, CircleDot, Clock, FlaskConical, ListChecks, MessagesSquare, Trophy } from 'lucide-react';
import type { Kind } from '../../app/catalog';
import type { Progress as ChallengeProgress } from '../../challenges/progress';
import { DIFFICULTY_LABELS } from '../../challenges/definitions';
import { MODULES, SUPPORT_LABELS, moduleById } from '../../learn/curriculum';
import { EXPERIMENTS, UNSUPPORTED_EXPERIMENTS } from '../../learn/experiments';
import { lessonStatus, moduleProgress, nextLesson, recommendedChallenges, trackProgress } from '../../learn/progress';
import type { LearnController } from '../../learn/useLearn';
import { isLesson, type Lesson, type Module, type PlannedLesson, type SimulatorSupport } from '../../learn/types';
import { CatalogBody, CatalogCard, CatalogHero, Facet, FilterSidebar, RelatedResources, ResultsBar, SiteFooter, type FooterTarget } from '../catalog/Shell';
import type { LearnView } from './LearnPage';

type Status = 'not-started' | 'in-progress' | 'completed' | 'planned';
type Sort = 'curriculum' | 'shortest' | 'progress';
const STATUS_LABELS: Record<Status, string> = { 'not-started': 'Not started', 'in-progress': 'In progress', completed: 'Completed', planned: 'Planned' };
const STATUS_CLASS: Record<Status, string> = { 'not-started': 'new', 'in-progress': 'attempted', completed: 'solved', planned: 'locked' };
const STATUS_ICONS = { 'not-started': CircleDot, 'in-progress': CircleDot, completed: CircleCheck, planned: CircleDashed } as const;
const TONES: Record<SimulatorSupport, string> = { simulated: 'level-easy', partial: 'level-medium', theory: 'level-expert' };
const SORTS: Array<[Sort, string]> = [['curriculum', 'Curriculum order'], ['progress', 'In progress first'], ['shortest', 'Shortest first']];
/** A representative component per module, for card art when a lesson names none. */
const MODULE_KINDS: Record<string, Kind> = {
  foundations: 'server', networking: 'loadBalancer', application: 'containerService', caching: 'cache', data: 'database',
  messaging: 'queue', reliability: 'circuitBreaker', distributed: 'distributedCache', operations: 'metricsCollector', 'case-studies': 'client',
};

type Entry = { lesson: Lesson | PlannedLesson; module: Module; order: number; status: Status };
type Filters = { modules: string[]; statuses: Status[]; support: SimulatorSupport[] };
const EMPTY: Filters = { modules: [], statuses: [], support: [] };

type Props = {
  learn: LearnController; onView: (view: LearnView) => void; challengeProgress: ChallengeProgress;
  onOpenExperiment: (id: string) => void; onOpenChallenge: (id: string) => void; onOpenChallenges: () => void; onOpenPlayground: () => void; onOpenInterviews: () => void;
  onFooter: (target: FooterTarget) => void;
};

/** The Learn overview, as a catalog: every lesson (written or planned) is a card that can be filtered and sorted. */
export function LearnCatalog({ learn, onView, challengeProgress, onOpenExperiment, onOpenChallenge, onOpenChallenges, onOpenPlayground, onOpenInterviews, onFooter }: Props) {
  const [query, setQuery] = useState(''); const [filters, setFilters] = useState<Filters>(EMPTY); const [sort, setSort] = useState<Sort>('curriculum'); const [filtersOpen, setFiltersOpen] = useState(false);
  const entries = useMemo<Entry[]>(() => MODULES.flatMap(module => module.lessons.map(lesson => ({ lesson, module, order: 0, status: (isLesson(lesson) ? lessonStatus(learn.state, lesson) : 'planned') as Status })))
    .map((entry, order) => ({ ...entry, order })), [learn.state]);
  const matches = (entry: Entry, ignore?: keyof Filters) => (ignore === 'modules' || !filters.modules.length || filters.modules.includes(entry.module.id))
    && (ignore === 'statuses' || !filters.statuses.length || filters.statuses.includes(entry.status))
    && (ignore === 'support' || !filters.support.length || filters.support.includes(entry.lesson.simulator))
    && (!query.trim() || `${entry.lesson.title} ${'summary' in entry.lesson ? entry.lesson.summary : ''} ${entry.module.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const statusRank: Record<Status, number> = { 'in-progress': 0, 'not-started': 1, completed: 2, planned: 3 };
  const results = entries.filter(entry => matches(entry)).sort((a, b) => sort === 'shortest' ? (isLesson(a.lesson) ? a.lesson.minutes : 999) - (isLesson(b.lesson) ? b.lesson.minutes : 999) || a.order - b.order
    : sort === 'progress' ? statusRank[a.status] - statusRank[b.status] || a.order - b.order : a.order - b.order);
  const count = <K extends keyof Filters>(facet: K, value: Filters[K][number]) => entries.filter(entry => matches(entry, facet) && (facet === 'modules' ? entry.module.id === value : facet === 'statuses' ? entry.status === value : entry.lesson.simulator === value)).length;
  const counts = <K extends keyof Filters>(facet: K, values: readonly Filters[K][number][]) => Object.fromEntries(values.map(value => [value, count(facet, value)])) as Record<Filters[K][number], number>;
  const toggle = <K extends keyof Filters>(facet: K, value: Filters[K][number]) => setFilters(current => ({ ...current, [facet]: (current[facet] as string[]).includes(value) ? (current[facet] as string[]).filter(entry => entry !== value) : [...current[facet], value] }));
  const active = filters.modules.length + filters.statuses.length + filters.support.length + (query.trim() ? 1 : 0);
  const clear = () => { setFilters(EMPTY); setQuery(''); };
  const track = trackProgress(learn.state); const next = nextLesson(learn.state); const nextStatus = next ? lessonStatus(learn.state, next) : null;
  const recommendations = recommendedChallenges(learn.state, challengeProgress).slice(0, 4);
  const moduleIds = MODULES.map(module => module.id); const statuses: Status[] = ['not-started', 'in-progress', 'completed', 'planned']; const supports: SimulatorSupport[] = ['simulated', 'partial', 'theory'];

  return <div className="fz-page fz-catalog fz-learn is-catalog">
    <CatalogHero id="fz-learn-title" crumbs={[{ label: 'Flowzen' }, { label: 'Learn' }]} title="System design courses."
      intro="Each lesson explains a concept and why it exists, compares the alternatives, shows it in an architecture, then sends you to the Playground to run a controlled experiment and observe the trade-offs. Challenges and interviews come afterwards, as optional practice."
      more={['Concept, why and when, alternatives and a design example: read them in order.', 'An experiment runs prepared variants with an identical workload and seed, and reports measured results separately from explanation.', 'A knowledge check tests judgment (why, when, trade-offs, failures); a practical exercise has you calculate or build.', 'Every lesson says what the simulator can and cannot demonstrate. Theory-only topics are labelled.']}
      topics={MODULES.map(module => ({ label: module.title, onClick: () => onView({ type: 'module', id: module.id }) }))}
      aside={<aside className="fz-hero__card" aria-label="Your learning progress">
        <div className="fz-hero__stats"><span><b>{track.completed}</b>/{track.total} lessons</span><span><FlaskConical size={14} aria-hidden /><b>{track.experimentsDone}</b>/{track.experimentsTotal} experiments</span></div>
        <span className="fz-hero__bar" aria-hidden><span style={{ width: `${track.completed / track.total * 100}%` }} /></span>
        {next ? <><span className="fz-hero__next">{nextStatus === 'in-progress' ? 'Continue' : 'Recommended next'}</span><b className="fz-hero__nexttitle">{next.title}</b><span className="fz-hero__nextmeta">Module {moduleById(next.moduleId)!.number} · about {next.minutes} min · {SUPPORT_LABELS[next.simulator].label}</span>
          <button className="fz-cta" onClick={() => onView({ type: 'lesson', id: next.id, section: 'concept' })}>{nextStatus === 'in-progress' ? 'Continue' : 'Start'} <ArrowRight size={14} aria-hidden /></button></>
          : <span className="fz-hero__next">Every written lesson is complete. Revisit any lesson or try the challenges.</span>}
      </aside>} />

    <CatalogBody sidebar={<FilterSidebar open={filtersOpen} active={active} onClear={clear} query={query} onQuery={setQuery} placeholder="Search lessons">
      <Facet title="Status" values={statuses} labels={value => STATUS_LABELS[value]} counts={counts('statuses', statuses)} selected={filters.statuses} onToggle={value => toggle('statuses', value)} />
      <Facet title="Simulator support" values={supports} labels={value => SUPPORT_LABELS[value].label} counts={counts('support', supports)} selected={filters.support} onToggle={value => toggle('support', value)} />
      <Facet title="Module" values={moduleIds} labels={value => `${moduleById(value)!.number}. ${moduleById(value)!.title}`} counts={counts('modules', moduleIds)} selected={filters.modules} onToggle={value => toggle('modules', value)} />
    </FilterSidebar>}>
      <ResultsBar count={results.length} active={active} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen(open => !open)} sort={sort} sorts={SORTS} onSort={setSort} sortLabel="Sort lessons" />
      {results.length ? <div className="fz-card-grid">{results.map(({ lesson, module, status }) => {
        const written = isLesson(lesson); const Icon = STATUS_ICONS[status];
        const kind = lesson.components?.[0] ?? MODULE_KINDS[module.id] ?? 'server';
        return <CatalogCard key={lesson.id} tone={TONES[lesson.simulator]} className={`is-${STATUS_CLASS[status]}${written ? '' : ' is-planned'}`} kind={kind} number={`${module.number}.${module.lessons.indexOf(lesson) + 1}`}
          type={written ? 'Lesson' : 'Planned lesson'} status={<span className={`fz-cstatus is-${STATUS_CLASS[status]}`}><Icon size={12} aria-hidden />{STATUS_LABELS[status]}</span>}
          title={lesson.title} description={written ? lesson.summary : `Part of ${module.title}. Listed so you can see where the track goes; not written yet.`}
          meta={[{ icon: BookOpen, text: `Module ${module.number} · ${module.title}` }, { icon: Clock, text: written ? `About ${lesson.minutes} minutes` : 'Not written yet' }, { icon: Check, text: SUPPORT_LABELS[lesson.simulator].label },
            ...(written ? [{ icon: ListChecks, text: `${lesson.quiz.length}-question check${lesson.experiment ? ' · experiment' : ''}${lesson.exercise ? ' · exercise' : ''}` }] : [])]}
          cta={{ label: !written ? 'Planned' : status === 'completed' ? 'Review lesson' : status === 'in-progress' ? 'Continue' : 'Start lesson', disabled: !written, secondary: status === 'completed',
            ariaLabel: `${written ? 'Open' : 'Planned:'} ${lesson.title}`, onClick: () => written && onView({ type: 'lesson', id: lesson.id, section: 'concept' }) }} />;
      })}</div> : <div className="fz-catalog__empty"><b>No lessons match these filters.</b><button className="fz-btn" onClick={clear}>Clear filters</button></div>}

      <section className="fz-catalog__section fz-dashboard" aria-labelledby="fz-modules-title"><h2 id="fz-modules-title">Modules</h2>
        <ol className="fz-modcards">{MODULES.map(module => { const progress = moduleProgress(learn.state, module); return <li key={module.id}>
          <button className={`fz-modcard is-${progress.status}`} onClick={() => onView({ type: 'module', id: module.id })}>
            <span className="fz-modcard__num">{module.number}</span><b>{module.title}</b><span>{module.summary}</span>
            <span className="fz-modcard__meta">{progress.written ? `${progress.completed} of ${progress.written} lessons completed${progress.planned ? ` · ${progress.planned} planned` : ''}` : `${module.lessons.length} lessons planned`}</span>
            {progress.written > 0 && <span className="fz-bar" aria-hidden><span style={{ width: `${progress.completed / progress.written * 100}%` }} /></span>}
          </button></li>; })}</ol>
        <div className="fz-dashboard__cols">
          <section aria-labelledby="fz-checks-title"><h2 id="fz-checks-title">Knowledge checks</h2>
            {track.checks.length ? <table className="fz-table"><thead><tr><th scope="col">Lesson</th><th scope="col">Best</th><th scope="col">Attempts</th></tr></thead>
              <tbody>{track.checks.map(({ lesson, quiz }) => <tr key={lesson.id}><th scope="row"><button className="fz-link" onClick={() => onView({ type: 'lesson', id: lesson.id, section: 'check' })}>{lesson.title}</button></th><td>{quiz.best.score}/{quiz.best.total}{quiz.best.passed ? ' ✓' : ''}</td><td>{quiz.attempts}</td></tr>)}</tbody></table>
              : <p className="fz-empty-note">No knowledge checks taken yet.</p>}
          </section>
          <section aria-labelledby="fz-exps-title"><h2 id="fz-exps-title">Experiments</h2>
            <ul className="fz-explist">{EXPERIMENTS.map(template => { const runs = learn.state.experiments[template.id] ?? []; const last = runs[runs.length - 1]; return <li key={template.id}>
              <button className="fz-link" onClick={() => onOpenExperiment(template.id)}>{template.title}</button>
              <span>{last ? `${runs.length} run${runs.length === 1 ? '' : 's'} · last ${last.conclusion.status === 'supports' ? 'supported' : last.conclusion.status === 'does-not-support' ? 'did not support' : 'inconclusive'}` : 'not run yet'}</span></li>; })}</ul>
            <details className="fz-labdetails"><summary>Not available as experiments</summary><ul className="fz-prose__list fz-limits">{UNSUPPORTED_EXPERIMENTS.map(entry => <li key={entry.title}><b>{entry.title}.</b> {entry.reason}</li>)}</ul></details>
          </section>
        </div>
        <h2>Optional practice</h2>
        <p className="fz-brief__note">Challenges test what the lessons teach. They are recommended after the related lessons, and never required.</p>
        <ul className="fz-practice">{recommendations.map(({ challenge, after, ready }) => <li key={challenge.id}>
          <div><b><Trophy size={13} aria-hidden /> {challenge.number}. {challenge.title}</b><span>{DIFFICULTY_LABELS[challenge.difficulty]} · {challenge.topics.join(', ')}</span>
            <span>{ready ? 'Ready: you completed ' : 'Prepared by: '}{after.map(lesson => lesson.title).join(', ')}</span></div>
          <button className={`fz-btn fz-btn--small${ready ? ' fz-btn--primary' : ''}`} onClick={() => onOpenChallenge(challenge.id)}>Open challenge</button>
        </li>)}</ul>
      </section>

      <RelatedResources id="fz-learn-related" items={[
        { icon: FlaskConical, type: 'Playground', title: 'Experiment freely', text: 'Build designs, run guided experiments, save variants and compare them against a baseline.', onClick: onOpenPlayground },
        { icon: BookOpen, type: 'Reference', title: 'Component guides', text: 'Why, when and when not to use each component, its alternatives and what the simulator models.', onClick: () => onView({ type: 'components' }) },
        { icon: MessagesSquare, type: 'Interview', title: 'Interview preparation', text: 'Practice or mock system design interviews with a rule-based evaluation that links weak areas back to these lessons.', onClick: onOpenInterviews },
        { icon: Trophy, type: 'Practice', title: 'All challenges', text: 'Graded, deterministic design problems with immutable attempt history.', onClick: onOpenChallenges },
      ]} />
    </CatalogBody>
    <SiteFooter onNavigate={onFooter} />
  </div>;
}
