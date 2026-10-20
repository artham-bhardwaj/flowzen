import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, CircleCheck, CircleDot, Clock, FlaskConical, Lock, MessagesSquare, Trophy } from 'lucide-react';
import { DIFFICULTIES, DIFFICULTY_LABELS, DIFFICULTY_POINTS, challenges, type Challenge } from '../challenges/definitions';
import { DURATION_LABELS, EMPTY_FILTERS, LEVEL_LABELS, STATUS_LABELS, facetCounts, filterCatalog, nextUp, sortCatalog, type CatalogFilters, type CatalogSort } from '../challenges/catalog';
import { pointsFor, statusOf, type ChallengeStatus, type Progress } from '../challenges/progress';
import { CatalogBody, CatalogCard, CatalogHero, Facet, FilterSidebar, RelatedResources, ResultsBar, SiteFooter, type FooterTarget } from './catalog/Shell';

const fmt = (value: number, digits = 0) => value.toLocaleString(undefined, { maximumFractionDigits: digits });
const SORTS: Array<[CatalogSort, string]> = [['recommended', 'Recommended'], ['shortest', 'Shortest first'], ['difficulty', 'Easiest first'], ['points', 'Most points']];

function StatusBadge({ status }: { status: ChallengeStatus }) {
  const Icon = status === 'solved' ? CircleCheck : status === 'locked' ? Lock : CircleDot;
  return <span className={`fz-cstatus is-${status}`}><Icon size={12} aria-hidden />{STATUS_LABELS[status]}</span>;
}

function ChallengeCard({ challenge, progress, onOpen }: { challenge: Challenge; progress: Progress; onOpen: (id: string) => void }) {
  const status = statusOf(progress, challenge); const entry = progress.challenges[challenge.id]; const locked = status === 'locked';
  const previousTier = DIFFICULTY_LABELS[DIFFICULTIES[DIFFICULTIES.indexOf(challenge.difficulty) - 1] ?? 'easy'];
  return <CatalogCard tone={`level-${challenge.difficulty}`} className={`is-${status}`} kind={challenge.relatedDesigns[0] ?? 'server'} number={challenge.number}
    type="Challenge" status={<StatusBadge status={status} />} title={challenge.title} description={challenge.summary}
    meta={[{ icon: Check, text: LEVEL_LABELS[challenge.difficulty] }, { icon: Clock, text: `About ${challenge.estimatedMinutes} minutes` },
      { icon: Check, text: `Graded on ${challenge.criteria.filter(criterion => criterion.mandatory).length} measured criteria` }, { icon: Trophy, text: `${DIFFICULTY_POINTS[challenge.difficulty]} points` }]}
    topics={challenge.topics}
    note={<>{locked && <small className="fz-ccard__lock">Solve any {previousTier} challenge to unlock.</small>}
      {entry?.best && <small className="fz-ccard__best">{entry.attempts} {entry.attempts === 1 ? 'attempt' : 'attempts'} · best: {entry.best.passed ? 'passed' : `${entry.best.criteriaPassed}/${entry.best.criteriaTotal} criteria`}{entry.best.p95 !== null ? ` · p95 ${fmt(entry.best.p95, 1)} ms` : ''}</small>}</>}
    cta={{ label: locked ? 'Locked' : status === 'solved' ? 'Practice again' : status === 'attempted' ? 'Continue' : 'Start challenge', disabled: locked, secondary: status === 'solved',
      ariaLabel: `${status === 'solved' ? 'Practice' : status === 'attempted' ? 'Continue' : 'Start'} ${challenge.title}`, onClick: () => onOpen(challenge.id) }} />;
}

type Props = { progress: Progress; onOpen: (id: string) => void; onClose: () => void; onOpenLab: () => void; onOpenLearn: () => void; onOpenInterview?: () => void; onFooter?: (target: FooterTarget) => void };

/** The challenge catalog: hero, filter sidebar, sortable card grid, related resources and footer. */
export function ChallengesPage({ progress, onOpen, onClose, onOpenLab, onOpenLearn, onOpenInterview, onFooter }: Props) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<CatalogSort>('recommended');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const results = useMemo(() => sortCatalog(filterCatalog(challenges, progress, filters, query), progress, sort, challenges), [filters, progress, query, sort]);
  const counts = useMemo(() => facetCounts(challenges, progress, filters, query), [filters, progress, query]);
  const toggle = <K extends keyof CatalogFilters>(facet: K, value: CatalogFilters[K][number]) =>
    setFilters(current => ({ ...current, [facet]: (current[facet] as string[]).includes(value) ? (current[facet] as string[]).filter(entry => entry !== value) : [...current[facet], value] }));
  const active = filters.levels.length + filters.statuses.length + filters.topics.length + filters.durations.length + (query.trim() ? 1 : 0);
  const clear = () => { setFilters(EMPTY_FILTERS); setQuery(''); };
  const solved = challenges.filter(challenge => progress.challenges[challenge.id]?.solved).length;
  const total = challenges.reduce((sum, challenge) => sum + DIFFICULTY_POINTS[challenge.difficulty], 0);
  const next = nextUp(challenges, progress);

  return <div className="fz-page fz-catalog">
    <CatalogHero id="fz-challenges-title" crumbs={[{ label: 'Flowzen', onClick: onClose }, { label: 'Challenges' }]} title="System design challenges."
      intro="Build an architecture that meets measured requirements. Every submission runs the same deterministic benchmark through the simulator and is graded on what actually happened: latency, throughput, errors and capacity."
      more={['Each challenge fixes its traffic, seed and given systems, so results are reproducible and the toolbar cannot change the benchmark.', 'Practice runs are free. Submissions are graded, recorded with an architecture snapshot, and can be reviewed and compared later.', 'Levels unlock in order: solve any challenge at one level to open the next. Points are awarded once per challenge.']}
      topics={counts.topicList.slice(0, 8).map(topic => ({ label: topic, onClick: () => setFilters({ ...EMPTY_FILTERS, topics: [topic] }) }))}
      aside={<aside className="fz-hero__card" aria-label="Your progress">
        <div className="fz-hero__stats"><span><b>{solved}</b>/{challenges.length} solved</span><span><Trophy size={14} aria-hidden /><b>{fmt(pointsFor(progress))}</b>/{fmt(total)} pts</span></div>
        <span className="fz-hero__bar" aria-hidden><span style={{ width: `${solved / challenges.length * 100}%` }} /></span>
        {next ? <><span className="fz-hero__next">Next up</span><b className="fz-hero__nexttitle">{next.title}</b><span className="fz-hero__nextmeta">{LEVEL_LABELS[next.difficulty]} · about {next.estimatedMinutes} min</span>
          <button className="fz-cta" onClick={() => onOpen(next.id)}>{progress.challenges[next.id]?.attempts ? 'Continue' : 'Start'} <ArrowRight size={14} aria-hidden /></button></>
          : <span className="fz-hero__next">Every open challenge is solved. Practice any of them again.</span>}
      </aside>} />

    <CatalogBody sidebar={<FilterSidebar open={filtersOpen} active={active} onClear={clear} query={query} onQuery={setQuery} placeholder="Search challenges">
      <Facet title="Level" values={DIFFICULTIES} labels={value => LEVEL_LABELS[value]} counts={counts.levels} selected={filters.levels} onToggle={value => toggle('levels', value)} />
      <Facet title="Status" values={['new', 'attempted', 'solved', 'locked'] as const} labels={value => STATUS_LABELS[value]} counts={counts.statuses} selected={filters.statuses} onToggle={value => toggle('statuses', value)} />
      <Facet title="Average time to complete" values={['short', 'medium', 'long'] as const} labels={value => DURATION_LABELS[value]} counts={counts.durations} selected={filters.durations} onToggle={value => toggle('durations', value)} />
      <Facet title="Topic" values={counts.topicList} labels={value => value} counts={counts.topics} selected={filters.topics} onToggle={value => toggle('topics', value)} />
    </FilterSidebar>}>
      <ResultsBar count={results.length} active={active} filtersOpen={filtersOpen} onToggleFilters={() => setFiltersOpen(open => !open)} sort={sort} sorts={SORTS} onSort={setSort} sortLabel="Sort challenges" />
      {results.length ? <div className="fz-card-grid">{results.map(challenge => <ChallengeCard key={challenge.id} challenge={challenge} progress={progress} onOpen={onOpen} />)}</div>
        : <div className="fz-catalog__empty"><b>No challenges match these filters.</b><button className="fz-btn" onClick={clear}>Clear filters</button></div>}
      <RelatedResources id="fz-related-title" items={[
        { icon: BookOpen, type: 'Learn', title: 'System design track', text: 'Lessons with experiments and exercises that prepare you for these challenges. Each brief lists the concepts it tests.', onClick: onOpenLearn },
        { icon: FlaskConical, type: 'Playground', title: 'Scaling Laboratory', text: 'Increase traffic, find bottlenecks and compare designs against a baseline, with guided experiments.', onClick: onOpenLab },
        ...(onOpenInterview ? [{ icon: MessagesSquare, type: 'Interview', title: 'Interview preparation', text: 'Practise complete system design interviews with a rule-based evaluation.', onClick: onOpenInterview }] : []),
      ]} />
    </CatalogBody>
    {onFooter && <SiteFooter onNavigate={onFooter} />}
  </div>;
}
