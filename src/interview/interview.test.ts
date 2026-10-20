import { describe, expect, it } from 'vitest';
import { STORAGE_KEY as CHALLENGE_KEY } from '../challenges/progress';
import { COMPETENCY_RESOURCES, recommendations, stats } from './analytics';
import { benchmarkInput, scenarioApplies } from './benchmark';
import { activeFollowUps, evaluate, parseNumber, reviewEstimates, scoreText, totals, withCorrections } from './evaluate';
import { PROBLEMS, problemById, resourceProblem, validateDefinition } from './index';
import { SOLUTIONS } from './solutions.fixture';
import { createSession, update, type InterviewSession } from './session';
import { answerFollowUp, askClarification, clock, goToStage, markAsked, revealHint, stageHasContent, submitFollowUp, tick, viewReference } from './workflow';
import { INTERVIEW_STORAGE_KEY, addCorrection, discardDraft, emptyInterviews, loadInterviews, putDraft, saveInterviews } from './store';
import { completeSession } from './record';
import { covering, runBenchmark, snapshot, strongSession } from './testkit';
import { STAGES } from './types';

const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };
const url = problemById('url-shortener')!;
const empty = () => createSession(url, { id: 's1', at: 100, mode: 'practice' });

describe('interview definitions', () => {
  it('has at least 12 problems across all difficulties and categories, each valid against the schema', () => {
    expect(PROBLEMS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PROBLEMS.map(problem => problem.id)).size).toBe(PROBLEMS.length);
    expect(new Set(PROBLEMS.map(problem => problem.difficulty))).toEqual(new Set(['beginner', 'intermediate', 'advanced', 'expert']));
    for (const category of ['api', 'caching', 'storage', 'messaging', 'scalability', 'reliability', 'distributed', 'observability', 'complete']) expect(PROBLEMS.some(problem => problem.categories.includes(category as never)), category).toBe(true);
    for (const problem of PROBLEMS) expect(validateDefinition(problem)).toEqual([]);
  });
  it('catches invalid definitions', () => {
    const broken = { ...url, id: 'Bad Id', sharedFollowUps: ['nope'], lessons: ['nowhere'], estimates: [{ ...url.estimates[3], formula: { product: ['ghost'] } }] };
    const errors = validateDefinition(broken);
    expect(errors.some(error => /kebab/.test(error))).toBe(true);
    expect(errors.some(error => /unknown shared follow-up nope/.test(error))).toBe(true);
    expect(errors.some(error => /unknown lesson nowhere/.test(error))).toBe(true);
    expect(errors.some(error => /unknown quantity ghost/.test(error))).toBe(true);
    expect(resourceProblem({ type: 'experiment', id: 'x' })).toMatch(/unknown experiment/);
  });
});

describe('sessions, stages, help and timing', () => {
  it('creates practice and mock sessions from the same definition', () => {
    const practice = empty(); const mock = createSession(url, { id: 's2', at: 1, mode: 'mock', durationMin: 30 });
    expect(practice).toMatchObject({ mode: 'practice', durationMin: null, stage: 'requirements', definitionVersion: url.version });
    expect(mock).toMatchObject({ mode: 'mock', durationMin: 30 });
    expect(createSession(url, { id: 's3', at: 1, mode: 'mock', durationMin: 1 }).durationMin).toBe(10);
  });
  it('marks a stage complete only when it has content, and allows revisiting', () => {
    let session = goToStage(empty(), 'estimation', 2);
    expect(session.completedStages).toEqual([]);
    session = update(session, { estimates: { writesPerDay: '3m' } }, 3);
    session = goToStage(session, 'requirements', 4);
    expect(session.completedStages).toEqual(['estimation']);
    expect(stageHasContent(session, 'requirements')).toBe(false);
    for (const stage of STAGES) expect(goToStage(session, stage, 5).stage).toBe(stage);
  });
  it('reveals hints only in practice and records each one; references need an answer first', () => {
    const practice = revealHint(revealHint(empty(), 'design', 0, 5), 'design', 0, 6);
    expect(practice.hintsUsed).toHaveLength(1);
    const mock = createSession(url, { id: 'm', at: 1, mode: 'mock' });
    expect(revealHint(mock, 'design', 0, 5).hintsUsed).toHaveLength(0);
    expect(viewReference(empty(), 'requirements', 3).referencesViewed).toEqual(['requirements']);
    expect(askClarification(askClarification(empty(), 'volume', 2), 'volume', 3).clarificationsAsked).toEqual(['volume']);
  });
  it('accrues time per stage and reports overtime without locking anything', () => {
    let session = createSession(url, { id: 'm', at: 1, mode: 'mock', durationMin: 10 });
    session = tick(session, 30_000); session = goToStage(session, 'design', 2); session = tick(session, 60_000);
    expect(session.timing).toEqual({ totalMs: 90_000, stageMs: { requirements: 30_000, design: 60_000 } });
    expect(clock(session)).toMatchObject({ limitMs: 600_000, remainingMs: 510_000, overtime: false, stageBudgetMs: session.plan!.stageMs.design });
    session = tick(session, 600_000);
    expect(clock(session)).toMatchObject({ remainingMs: 0, overtime: true, stageOver: true });
    session = update(session, { designNotes: 'still editable after time is up' }, 9);
    expect(session.designNotes).toMatch(/still editable/);
    expect(clock(empty()).limitMs).toBeNull();
  });
  it('starts a new editable session from a previous one, copying answers but not evidence or help usage', () => {
    const architecture = snapshot(SOLUTIONS['url-shortener'][0]);
    const previous = { ...strongSession(url, architecture), hintsUsed: [{ stage: 'design' as const, index: 0, at: 1 }] };
    const next = createSession(url, { id: 'n', at: 50, mode: 'practice', from: { recordId: 'r1', session: previous } });
    expect(next.origin).toEqual({ recordId: 'r1' });
    expect(next.architecture).toEqual(previous.architecture); expect(next.architecture).not.toBe(previous.architecture);
    expect(next.benchmark).toBeNull(); expect(next.hintsUsed).toEqual([]); expect(next.timing.totalMs).toBe(0);
  });
});

describe('follow-up branching', () => {
  it('asks only root questions that apply before an architecture exists', () => {
    const ids = activeFollowUps(url, empty()).map(item => item.followUp.id);
    expect(ids).toContain('traffic-10x'); expect(ids).toContain('viral-link');
    expect(ids).not.toContain('cache-what'); expect(ids).not.toContain('no-cache'); expect(ids).not.toContain('alias-race');
  });
  it('branches on the architecture: caching questions with a cache, "why no cache" without one', () => {
    const withCache = update(empty(), { architecture: snapshot(SOLUTIONS['url-shortener'][0]) }, 2);
    const withoutCache = update(empty(), { architecture: snapshot({ nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server'], ['d', 'database']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd']] }) }, 2);
    expect(activeFollowUps(url, withCache).map(item => item.followUp.id)).toContain('cache-what');
    expect(activeFollowUps(url, withCache).map(item => item.followUp.id)).not.toContain('no-cache');
    expect(activeFollowUps(url, withoutCache).map(item => item.followUp.id)).toContain('no-cache');
    expect(activeFollowUps(url, withoutCache).map(item => item.followUp.id)).not.toContain('cache-what');
  });
  it('branches on answers: a chained question appears after its parent is answered', () => {
    let session = update(empty(), { architecture: snapshot(SOLUTIONS['url-shortener'][0]) }, 2);
    expect(activeFollowUps(url, session).map(item => item.followUp.id)).not.toContain('cache-miss');
    session = answerFollowUp(session, 'cache-what', covering(url.sharedFollowUps.length ? [{ id: 'k', label: 'k', any: ['key'] }] : []), 3);
    // Typing is not enough: a branch opens only once the answer is submitted.
    expect(activeFollowUps(url, session).map(item => item.followUp.id)).not.toContain('cache-miss');
    session = submitFollowUp(session, 'cache-what', 4);
    const chain = activeFollowUps(url, session);
    expect(chain.map(item => item.followUp.id)).toContain('cache-miss');
    expect(chain.find(item => item.followUp.id === 'cache-miss')!.depth).toBe(1);
  });
  it('branches on the requirements text', () => {
    const session = update(empty(), { requirements: { ...empty().requirements, functional: 'Users can pick a custom alias' } }, 2);
    expect(activeFollowUps(url, session).map(item => item.followUp.id)).toContain('alias-race');
  });
  it('keeps asked questions in the record even if their trigger stops applying', () => {
    let session = update(empty(), { architecture: snapshot(SOLUTIONS['url-shortener'][0]) }, 2);
    session = markAsked(session, [{ id: 'cache-what', reason: 'Your design includes a cache.' }], 3);
    session = update(session, { architecture: snapshot({ nodes: [['u', 'client'], ['a', 'server']], edges: [['u', 'a']] }) }, 4);
    const kept = activeFollowUps(url, session).find(item => item.followUp.id === 'cache-what');
    expect(kept).toMatchObject({ applies: false });
  });
  it('runs failure scenarios only where they apply', () => {
    const architecture = snapshot(SOLUTIONS['url-shortener'][0]);
    expect(scenarioApplies(architecture, { kind: 'outage', kinds: ['cache', 'distributedCache'], startMs: 1, endMs: 2 })).toBe(true);
    expect(scenarioApplies(architecture, { kind: 'outage', kinds: ['queue'], startMs: 1, endMs: 2 })).toBe(false);
    const input = benchmarkInput(url, architecture, { kind: 'traffic', multiplier: 10 });
    expect(input.offeredRps).toBe(20_000);
    expect(benchmarkInput(url, architecture, { kind: 'outage', kinds: ['nosql', 'database'], startMs: 1500, endMs: 3500 }).faults?.length).toBe(1);
  });
});

describe('deterministic evaluation', () => {
  it('scores free text by required concepts, caps contradictions and short answers, and flags uncertainty', () => {
    const concepts = [{ id: 'a', label: 'retries', any: ['retry'] }, { id: 'b', label: 'dead letters', any: ['dead-letter', 'dlq'] }];
    expect(scoreText('', concepts).score).toBe(0);
    expect(scoreText('We retry failed messages a few times and then park them in a dead-letter queue for inspection.', concepts).score).toBe(4);
    expect(scoreText('retry dlq', concepts).score).toBe(1);
    const contradicted = scoreText('The broker guarantees exactly once delivery so we retry and use a dlq when needed always.', concepts, [{ id: 'x', label: 'exactly once', any: ['exactly once delivery'], explanation: 'No.' }]);
    expect(contradicted.score).toBe(1); expect(contradicted.evidence.some(entry => /Contradiction/.test(entry.text))).toBe(true);
    const long = scoreText(Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ') + ' retry', concepts);
    expect(long.uncertain).toBe(true);
  });
  it('checks estimates against documented tolerances and the user’s own assumptions', () => {
    expect(parseNumber('3.3 million')).toBe(3_300_000); expect(parseNumber('2k')).toBe(2000); expect(parseNumber('1,200')).toBe(1200); expect(parseNumber('abc')).toBeNull();
    const rows = (estimates: Record<string, string>) => Object.fromEntries(reviewEstimates(url, update(empty(), { estimates }, 2)).map(row => [row.quantity.id, row.status]));
    // A different but valid assumption: everything derived consistently from it is accepted.
    expect(rows({ writesPerDay: '5m', readRatio: '100', recordBytes: '500', writeRps: '58', readRps: '5800', storageGb: '4560' })).toEqual({ writesPerDay: 'ok', readRatio: 'ok', recordBytes: 'ok', writeRps: 'ok', readRps: 'ok', storageGb: 'ok' });
    // Arithmetic that does not follow from the user's own inputs is flagged as inconsistent.
    expect(rows({ writesPerDay: '3.3m', writeRps: '380' }).writeRps).toBe('inconsistent');
    // An assumption 100× too small makes derived values consistent but off by an order of magnitude.
    expect(rows({ writesPerDay: '33000', writeRps: '0.38' })).toMatchObject({ writesPerDay: 'outside-range', writeRps: 'off-magnitude' });
    expect(rows({}).readRps).toBe('missing');
  });
  it('gives a strong session a high score with evidence for every criterion', () => {
    const evaluation = evaluate(url, strongSession(url, snapshot(SOLUTIONS['url-shortener'][0])));
    expect(evaluation.overall.percent).toBeGreaterThanOrEqual(85);
    expect(evaluation.criteria.find(criterion => criterion.id === 'arch-benchmark')).toMatchObject({ score: 4, basis: 'measured' });
    expect(evaluation.criteria.every(criterion => criterion.evidence.length > 0)).toBe(true);
    expect(evaluation.missedRequirements).toEqual([]);
    expect(evaluation.architecture.roles.filter(review => review.role.required).every(review => review.status === 'explained')).toBe(true);
  });
  it.each(SOLUTIONS['url-shortener'].map((graph, i) => [i, graph] as const))('accepts documented alternative architecture %i', (_i, graph) => {
    const run = runBenchmark(url, snapshot(graph));
    expect(run.complete).toBe(true); expect(run.p95!).toBeLessThanOrEqual(url.benchmark.targets.p95Ms); expect(run.successPct).toBeGreaterThanOrEqual(url.benchmark.targets.minSuccessPct);
    const evaluation = evaluate(url, strongSession(url, snapshot(graph)));
    expect(evaluation.criteria.find(criterion => criterion.id === 'arch-roles')!.score).toBeGreaterThanOrEqual(3);
  });
  it('gives no credit for merely adding components', () => {
    const architecture = snapshot(SOLUTIONS['url-shortener'][0]);
    const session = update(empty(), { architecture }, 2); // components but no decision notes, no benchmark
    const roles = evaluate(url, session).architecture.roles;
    expect(roles.filter(review => review.status !== 'missing').every(review => review.score <= 2)).toBe(true);
    // A cache that is not connected to anything carries no traffic and gets 1 point.
    const dangling = snapshot({ nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server'], ['d', 'database'], ['k', 'cache']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd']] });
    const review = evaluate(url, update(empty(), { architecture: dangling, decisions: { k: covering([...url.roles[3].explain]) } }, 2)).architecture.roles.find(entry => entry.role.id === 'read-path')!;
    expect(review).toMatchObject({ status: 'unused', score: 1 });
  });
  it('fails the measured benchmark without read offloading, and does not use stale measurements', () => {
    const plain = snapshot({ nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['b', 'server', { instances: '16' }], ['d', 'database']], edges: [['u', 'lb'], ['lb', 'a'], ['lb', 'b'], ['a', 'd'], ['b', 'd']] });
    const session = strongSession(url, plain);
    const evaluation = evaluate(url, session);
    expect(evaluation.criteria.find(criterion => criterion.id === 'arch-benchmark')!.score).toBeLessThanOrEqual(2);
    expect(evaluation.criteria.find(criterion => criterion.id === 'arch-roles')!.critical).toContain('Read offloading (cache, CDN or replicas)');
    const changed = update(session, { architecture: snapshot(SOLUTIONS['url-shortener'][0]) }, 9);
    const stale = evaluate(url, changed);
    expect(stale.architecture.benchmark.status).toBe('stale');
    expect(stale.criteria.find(criterion => criterion.id === 'arch-benchmark')!.score).toBeNull();
  });
  it('scores an empty session at zero without fabricating evidence, and is deterministic', () => {
    const evaluation = evaluate(url, empty());
    expect(evaluation.overall.percent).toBeLessThan(10);
    expect(evaluation.criteria.find(criterion => criterion.id === 'arch-benchmark')!.score).toBeNull();
    expect(evaluation.missedRequirements.filter(entry => entry.critical).length).toBeGreaterThan(0);
    const strong = strongSession(url, snapshot(SOLUTIONS['url-shortener'][0]));
    expect(JSON.stringify(evaluate(url, strong))).toBe(JSON.stringify(evaluate(url, strong)));
  });
  it('penalises unjustified unnecessary components', () => {
    const graph = SOLUTIONS['url-shortener'][0];
    const architecture = snapshot({ nodes: [...graph.nodes, ['search', 'searchEngine']], edges: [...graph.edges] });
    const session = { ...strongSession(url, architecture, { benchmark: false }) }; session.decisions = { ...session.decisions, search: '' };
    const tradeoffs = evaluate(url, session).criteria.find(criterion => criterion.id === 'tradeoffs')!;
    expect(tradeoffs.score).toBe(3);
    expect(tradeoffs.evidence.some(entry => /Unjustified complexity/.test(entry.text))).toBe(true);
  });
  it('records corrections separately and recomputes a labelled view', () => {
    const evaluation = evaluate(url, empty());
    const corrected = withCorrections(evaluation, [{ criterionId: 'req-functional', at: 1, score: 4, uncertain: false, note: 'I wrote these in the scope box.' }, { criterionId: 'api-operations', at: 2, score: null, uncertain: true, note: 'unsure' }]);
    expect(corrected.corrected).toEqual(['req-functional']);
    expect(corrected.criteria.find(criterion => criterion.id === 'req-functional')!.score).toBe(4);
    expect(corrected.criteria.find(criterion => criterion.id === 'api-operations')!.uncertain).toBe(true);
    expect(evaluation.criteria.find(criterion => criterion.id === 'req-functional')!.score).not.toBe(4);
    expect(totals(corrected.criteria).overall.percent).toBeGreaterThan(evaluation.overall.percent);
  });
});

describe('history, immutability and isolation', () => {
  it('stores drafts, completes them into immutable records and keeps the architecture snapshot', () => {
    const storage = memory();
    const session = strongSession(url, snapshot(SOLUTIONS['url-shortener'][0]));
    let state = putDraft(emptyInterviews(), session);
    const done = completeSession(state, url, session, { recordId: 'r1', at: 500, finishedEarly: false });
    state = done.state;
    expect(state.drafts).toEqual([]);
    expect(Object.isFrozen(done.record) && Object.isFrozen(done.record.session.architecture!.nodes[0]) && Object.isFrozen(done.record.evaluation.criteria[0])).toBe(true);
    expect(done.record).toMatchObject({ definitionId: 'url-shortener', definitionVersion: 2, evaluatorVersion: 2, referenceVersion: 2, session: { mode: 'practice' } });
    expect(() => { (done.record.session as InterviewSession).designNotes = 'changed'; }).toThrow();
    saveInterviews(state, storage);
    expect([...storage.data.keys()]).toEqual([INTERVIEW_STORAGE_KEY]);
    expect(storage.data.has(CHALLENGE_KEY)).toBe(false);
    const loaded = loadInterviews(storage);
    expect(loaded.dropped).toEqual([]);
    expect(JSON.stringify(loaded.state.records[0])).toBe(JSON.stringify(done.record));
  });
  it('keeps corrections outside the record and drops damaged entries individually', () => {
    const storage = memory();
    const session = strongSession(url, snapshot(SOLUTIONS['url-shortener'][0]), { benchmark: false });
    let { state } = completeSession(emptyInterviews(), url, session, { recordId: 'r1', at: 5, finishedEarly: true });
    const recordJson = JSON.stringify(state.records[0]);
    state = addCorrection(state, 'r1', { criterionId: 'tradeoffs', at: 6, score: 2, uncertain: false, note: 'too generous' });
    expect(JSON.stringify(state.records[0])).toBe(recordJson);
    expect(addCorrection(state, 'missing', { criterionId: 'x', at: 1, score: 1, uncertain: false, note: '' })).toBe(state);
    state = putDraft(state, createSession(url, { id: 'd1', at: 1, mode: 'mock' }));
    saveInterviews(state, storage);
    const raw = JSON.parse(storage.data.get(INTERVIEW_STORAGE_KEY)!);
    raw.records.push({ schema: 'flowzen.interview-record', version: 7 }); raw.drafts.push({ schema: 'nope' });
    storage.setItem(INTERVIEW_STORAGE_KEY, JSON.stringify(raw));
    const loaded = loadInterviews(storage);
    expect(loaded.state.records).toHaveLength(1); expect(loaded.state.drafts).toHaveLength(1);
    expect(loaded.dropped).toHaveLength(2);
    expect(loaded.state.corrections.r1).toHaveLength(1);
    expect(discardDraft(loaded.state, 'd1').drafts).toEqual([]);
    storage.setItem(INTERVIEW_STORAGE_KEY, '{oops'); expect(loadInterviews(storage).dropped[0]).toMatch(/could not be read/);
  });
});

describe('analytics and recommendations', () => {
  it('shows nothing fabricated with no history', () => {
    const empty = stats(emptyInterviews());
    expect(empty).toMatchObject({ completed: 0, averagePercent: null, recent: [], recurringMistakes: [], needsWork: [] });
    expect(empty.competencies.every(entry => entry.average === null && entry.trend.length === 0)).toBe(true);
  });
  it('computes averages, trends, recurring mistakes and weak competencies from records', () => {
    const weak = createSession(url, { id: 'w1', at: 1, mode: 'practice' });
    let state = completeSession(emptyInterviews(), url, weak, { recordId: 'a', at: 1, finishedEarly: true }).state;
    state = completeSession(state, url, { ...weak, id: 'w2' }, { recordId: 'b', at: 2, finishedEarly: true }).state;
    const result = stats(state);
    expect(result.completed).toBe(2);
    expect(result.recurringMistakes.length).toBeGreaterThan(0);
    expect(result.recurringMistakes[0].count).toBe(2);
    expect(result.needsWork).toContain('clarification');
    expect(result.competencies.find(entry => entry.id === 'clarification')!.trend).toHaveLength(2);
    const recs = recommendations(state.records[0].evaluation, null, PROBLEMS, state, 'url-shortener');
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) { expect(rec.resources.length).toBeGreaterThan(0); for (const resource of rec.resources) expect(resourceProblem(resource)).toBeNull(); }
    expect(recs[0].interview?.id).not.toBe('url-shortener');
  });
  it('maps every competency to valid learning resources', () => {
    for (const list of Object.values(COMPETENCY_RESOURCES)) for (const resource of list) expect(resourceProblem(resource)).toBeNull();
  });
});

describe('every problem', () => {
  it.each(PROBLEMS.map(problem => [problem.id] as const))('%s: reference solutions meet the benchmark, score highly, and an empty session scores near zero', id => {
    const definition = problemById(id)!;
    const solutions = SOLUTIONS[id];
    expect(solutions?.length, `${id} needs at least one tested solution`).toBeGreaterThan(0);
    for (const graph of solutions) {
      const architecture = snapshot(graph);
      const run = runBenchmark(definition, architecture);
      expect(run.complete, `${id} run complete`).toBe(true);
      expect(run.p95 ?? Infinity, `${id} p95`).toBeLessThanOrEqual(definition.benchmark.targets.p95Ms);
      expect(run.successPct, `${id} success`).toBeGreaterThanOrEqual(definition.benchmark.targets.minSuccessPct);
      const evaluation = evaluate(definition, strongSession(definition, architecture));
      expect(evaluation.criteria.find(criterion => criterion.id === 'arch-roles')!.score, `${id} roles`).toBe(4);
      expect(evaluation.overall.percent, `${id} overall`).toBeGreaterThanOrEqual(85);
    }
    expect(evaluate(definition, createSession(definition, { id: 'e', at: 1, mode: 'practice' })).overall.percent).toBeLessThan(15);
  });
});

describe('benchmarks discriminate between designs', () => {
  const fails = (id: string, graph: Parameters<typeof snapshot>[0]) => {
    const definition = problemById(id)!; const run = runBenchmark(definition, snapshot(graph));
    return !run.complete || (run.p95 ?? Infinity) > definition.benchmark.targets.p95Ms || run.successPct < definition.benchmark.targets.minSuccessPct;
  };
  it('a naive design without the key decision fails the measured targets', () => {
    // Catalog without read offloading: the database is overloaded.
    expect(fails('product-catalog', { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '24' }], ['d', 'database']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd']] })).toBe(true);
    // Rate limiter missing: excess traffic queues at the database and p95 explodes.
    expect(fails('rate-limiter', { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '24' }], ['d', 'database']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd']] })).toBe(true);
    // Rate limiter set at its default 500/s, far below the backend's capacity: too few requests succeed.
    expect(fails('rate-limiter', { nodes: [['u', 'client'], ['rl', 'rateLimiter'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['d', 'database']], edges: [['u', 'rl'], ['rl', 'lb'], ['lb', 'a'], ['a', 'd']] })).toBe(true);
    // Autocomplete straight from the search engine: too slow and saturated.
    expect(fails('autocomplete', { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server', { instances: '16' }], ['s', 'searchEngine']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 's']] })).toBe(true);
    // Ride booking with a default 6-partition stream: appends saturate.
    expect(fails('ride-booking', { nodes: [['dr', 'client'], ['ls', 'server', { instances: '16' }], ['st', 'eventStream'], ['w', 'worker', { concurrency: '40' }], ['geo', 'nosql'], ['r', 'client'], ['lb', 'loadBalancer'], ['rs', 'server', { instances: '16' }], ['db', 'database']], edges: [['dr', 'ls'], ['ls', 'st'], ['st', 'w'], ['w', 'geo'], ['r', 'lb'], ['lb', 'rs'], ['rs', 'db']] })).toBe(true);
    // Checkout on default 3-instance servers: under-provisioned for 1,500/s.
    expect(fails('checkout', { nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server'], ['d', 'database'], ['q', 'queue'], ['w', 'worker']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd'], ['d', 'q'], ['q', 'w']] })).toBe(true);
  });
});
