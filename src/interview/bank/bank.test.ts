import { describe, expect, it } from 'vitest';
import { INTERVIEW_STORAGE_KEY, emptyInterviews, putDraft, saveInterviews } from '../store';
import { activeFollowUps } from '../adaptive';
import { evaluate } from '../evaluate';
import { PROBLEMS, problemById, validateDefinition } from '../index';
import { CURATED } from '../problems';
import { completeSession } from '../record';
import { createSession, planFor } from '../session';
import { SOLUTIONS } from '../solutions.fixture';
import { runBenchmark, snapshot, strongSession } from '../testkit';
import { BRIEFS } from './briefs';
import { BANK, bankQuestion, evidenceOf, placementIds } from './catalog';
import { COMPANIES, REPORTS, SOURCES, sourceById } from './evidence';
import { EMPTY_FILTERS, facetCounts, filterBank, matchesQuery, sortBank, type BankContext } from './query';
import { SHAPES, SHAPE_IDS } from './shapes';
import { BANK_STORAGE_KEY, emptyPrefs, loadPrefs, savePrefs, toggleBookmark, toggleStudied } from './store';
import { GROUPS } from './types';

const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };
const noProgress: BankContext = { status: () => 'new', bookmarked: () => false };
const ids = (list: Array<{ id: string }>) => list.map(entry => entry.id);

describe('question bank catalog', () => {
  it('has 50–100 unique questions, one per interview definition, covering every category and difficulty', () => {
    expect(BANK.length).toBeGreaterThanOrEqual(50); expect(BANK.length).toBeLessThanOrEqual(100);
    expect(BANK.length).toBe(PROBLEMS.length);
    expect(new Set(ids(BANK)).size).toBe(BANK.length);
    const titles = BANK.map(question => question.title.toLowerCase().replace(/\(.*\)/, '').trim());
    expect(new Set(titles).size, 'duplicate titles').toBe(titles.length);
    expect(new Set(placementIds())).toEqual(new Set(ids(PROBLEMS)));
    for (const group of GROUPS) expect(BANK.some(question => question.group === group), group).toBe(true);
    expect(new Set(BANK.map(question => question.difficulty))).toEqual(new Set(['beginner', 'intermediate', 'advanced', 'expert']));
    expect(BRIEFS.length + CURATED.length).toBe(BANK.length);
  });
  it('includes the requested well-known problems', () => {
    for (const query of ['url shortener', 'pastebin', 'rate limiter', 'news feed', 'chat', 'notification', 'comment', 'likes', 'dropbox', 'google drive', 's3', 'youtube', 'netflix', 'image hosting', 'video processing', 'product catalog', 'shopping cart', 'checkout', 'inventory', 'api gateway', 'distributed cache', 'search engine', 'web crawler', 'message queue', 'job scheduler', 'key-value', 'distributed lock', 'uber', 'collaborative editor', 'leaderboard', 'metrics', 'logging', 'recommendation', 'ad click'])
      expect(BANK.some(question => matchesQuery(question, query)), query).toBe(true);
  });
  it('generates a valid interview definition from every brief', () => {
    for (const problem of PROBLEMS) expect(validateDefinition(problem), problem.id).toEqual([]);
    for (const brief of BRIEFS) {
      const definition = problemById(brief.id)!;
      expect(definition.benchmark).toEqual(SHAPES[brief.shape].benchmark);
      expect(definition.reference.whyItWorks?.length).toBeGreaterThan(0);
      expect(definition.deepDives.length).toBeGreaterThanOrEqual(2);
      expect(definition.followUps.length).toBeGreaterThanOrEqual(1);
      expect(definition.estimates.filter(entry => entry.role === 'derived').every(entry => entry.reference > 0)).toBe(true);
    }
  });
});

describe('interview evidence', () => {
  it('backs every company association with a checked source and quoted wording', () => {
    for (const [questionId, reports] of Object.entries(REPORTS)) {
      expect(bankQuestion(questionId), questionId).toBeDefined();
      for (const report of reports) {
        const source = sourceById(report.sourceId)!;
        expect(source, `${questionId} source`).toBeDefined();
        expect(source.url).toMatch(/^https:\/\//);
        expect(source.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.sourcing.length).toBeGreaterThan(20);
        expect(['low', 'medium']).toContain(report.confidence);
        expect(report.asked.trim().length).toBeGreaterThan(5);
        expect(COMPANIES.some(company => company.id === report.company)).toBe(true);
      }
    }
    for (const source of SOURCES) expect(Object.values(REPORTS).flat().some(report => report.sourceId === source.id), `${source.id} unused`).toBe(true);
  });
  it('labels questions without evidence as common practice and claims nothing for companies without sources', () => {
    const practice = BANK.filter(question => !question.reports.length);
    expect(practice.length).toBeGreaterThan(0);
    for (const question of practice) expect(evidenceOf(question)).toBe('practice');
    for (const question of BANK.filter(question => question.reports.length)) expect(evidenceOf(question)).toBe('sourced');
    for (const company of ['uber', 'linkedin', 'twitter', 'airbnb'] as const) expect(BANK.some(question => question.reports.some(report => report.company === company)), company).toBe(false);
    // "Modelled on" is product context, never an interview report.
    const uber = BANK.find(question => question.id === 'ride-booking')!;
    expect(uber.modelledOn).toMatch(/Uber/); expect(uber.reports).toEqual([]);
  });
});

describe('workload shapes and practice sessions', () => {
  // One benchmark run per shape: every question of a shape has an identical benchmark.
  const shapeRuns = new Map(SHAPE_IDS.map(id => { const shape = SHAPES[id]; const graph = SOLUTIONS[shape.base][0]; const architecture = snapshot(graph); return [id, { architecture, run: runBenchmark(problemById(shape.base)!, architecture) }]; }));
  it('reuses the exact simulated settings of a curated interview, whose reference design meets them', () => {
    for (const id of SHAPE_IDS) {
      const shape = SHAPES[id]; const base = problemById(shape.base)!;
      expect({ rps: shape.benchmark.rps, targets: shape.benchmark.targets, seed: shape.benchmark.seed, durationMs: shape.benchmark.durationMs }).toEqual({ rps: base.benchmark.rps, targets: base.benchmark.targets, seed: base.benchmark.seed, durationMs: base.benchmark.durationMs });
      const configs = (benchmark: typeof base.benchmark) => benchmark.overrides.flatMap(override => override.kinds.map(kind => `${kind}:${JSON.stringify(override.config)}`)).sort();
      expect(configs(shape.benchmark), id).toEqual(configs(base.benchmark));
      const { run } = shapeRuns.get(id)!;
      expect(run.complete && (run.p95 ?? Infinity) <= shape.benchmark.targets.p95Ms && run.successPct >= shape.benchmark.targets.minSuccessPct, `${id} reference meets the benchmark`).toBe(true);
    }
  });
  it('opens a functional, evaluated practice session for every generated question', () => {
    for (const brief of BRIEFS) {
      const definition = problemById(brief.id)!; const { architecture, run } = shapeRuns.get(brief.shape)!;
      const session = { ...strongSession(definition, architecture, { benchmark: false }), benchmark: run };
      const evaluation = evaluate(definition, session);
      expect(evaluation.criteria.find(criterion => criterion.id === 'arch-roles')!.score, `${brief.id} roles`).toBe(4);
      expect(evaluation.criteria.find(criterion => criterion.id === 'arch-benchmark')!.score, `${brief.id} benchmark`).toBe(4);
      expect(evaluation.overall.percent, `${brief.id} strong`).toBeGreaterThanOrEqual(85);
      expect(evaluate(definition, createSession(definition, { id: 'e', at: 1, mode: 'practice' })).overall.percent, `${brief.id} empty`).toBeLessThan(15);
      // Before anything is answered, the problem's own follow-up is among the opening questions (later it can be held back if a deep dive covers it).
      const fresh = { ...createSession(definition, { id: 'f', at: 1, mode: 'practice' }), architecture };
      expect(activeFollowUps(definition, fresh).some(item => item.followUp.id === definition.followUps[0].id), `${brief.id} asks its own follow-up`).toBe(true);
    }
  });
  it('opens practice and timed sessions for every catalog question', () => {
    for (const question of BANK) {
      const definition = problemById(question.definitionId)!;
      expect(createSession(definition, { id: 'p', at: 1, mode: 'practice' })).toMatchObject({ definitionId: question.id, mode: 'practice', plan: null });
      const mock = createSession(definition, { id: 'm', at: 1, mode: 'mock', durationMin: 45 });
      expect(Object.values(mock.plan!.stageMs).reduce((a, b) => a + (b ?? 0), 0)).toBe(45 * 60_000);
      expect(planFor(definition, 30)).toBeDefined();
    }
  });
});

describe('search, filters and sorting', () => {
  it('searches by title, alias and reporting company (all words must match)', () => {
    expect(ids(filterBank(BANK, { ...EMPTY_FILTERS, query: 'url short' }, noProgress, 'title'))).toEqual(['url-shortener']);
    expect(ids(filterBank(BANK, { ...EMPTY_FILTERS, query: 'Dropbox' }, noProgress, 'title'))).toEqual(['file-storage']);
    const stripe = ids(filterBank(BANK, { ...EMPTY_FILTERS, query: 'stripe' }, noProgress, 'title'));
    expect(stripe).toEqual(expect.arrayContaining(['payment-ledger', 'rate-limiter', 'distributed-cache', 'metrics-monitoring']));
    expect(ids(filterBank(BANK, { ...EMPTY_FILTERS, query: 'stripe ledger' }, noProgress, 'title'))).toEqual(['payment-ledger']);
    expect(filterBank(BANK, { ...EMPTY_FILTERS, query: 'zzzz nothing' }, noProgress, 'title')).toEqual([]);
  });
  it('filters by company, difficulty, category, evidence, progress and bookmarks, and combines them', () => {
    const meta = filterBank(BANK, { ...EMPTY_FILTERS, companies: ['meta'] }, noProgress, 'title');
    expect(meta.every(question => question.reports.some(report => report.company === 'meta'))).toBe(true);
    expect(ids(meta)).toEqual(expect.arrayContaining(['photo-sharing', 'news-feed', 'web-crawler']));
    expect(filterBank(BANK, { ...EMPTY_FILTERS, companies: ['uber'] }, noProgress, 'title')).toEqual([]);
    const expertStorage = filterBank(BANK, { ...EMPTY_FILTERS, difficulties: ['expert'], groups: ['storage'] }, noProgress, 'title');
    expect(ids(expertStorage)).toEqual(['object-storage']);
    expect(filterBank(BANK, { ...EMPTY_FILTERS, evidence: ['practice'] }, noProgress, 'title').every(question => !question.reports.length)).toBe(true);
    const context: BankContext = { status: question => question.id === 'chat' ? 'completed' : question.id === 'pastebin' ? 'in-progress' : 'new', bookmarked: question => question.id === 'cdn' };
    expect(ids(filterBank(BANK, { ...EMPTY_FILTERS, statuses: ['completed', 'in-progress'] }, context, 'title'))).toEqual(['chat', 'pastebin']);
    expect(ids(filterBank(BANK, { ...EMPTY_FILTERS, bookmarkedOnly: true }, context, 'title'))).toEqual(['cdn']);
  });
  it('counts each facet while applying the other filters', () => {
    const filters = { ...EMPTY_FILTERS, groups: ['commerce' as const], difficulties: ['beginner' as const] };
    const counts = facetCounts(BANK, filters, noProgress, 'difficulties', ['beginner', 'expert'] as const, (question, value) => question.difficulty === value);
    expect(counts.beginner).toBe(BANK.filter(question => question.group === 'commerce' && question.difficulty === 'beginner').length);
    expect(counts.expert).toBe(BANK.filter(question => question.group === 'commerce' && question.difficulty === 'expert').length);
  });
  it('sorts by editorial popularity, category, difficulty and title, stably', () => {
    const byProminence = sortBank(BANK, 'prominence');
    for (let i = 1; i < byProminence.length; i++) expect(byProminence[i].prominence).toBeGreaterThanOrEqual(byProminence[i - 1].prominence);
    const titles = sortBank(BANK, 'title').map(question => question.title.toLowerCase());
    expect(titles).toEqual([...titles].sort());
    const levels = ['beginner', 'intermediate', 'advanced', 'expert'];
    const byDifficulty = sortBank(BANK, 'difficulty');
    for (let i = 1; i < byDifficulty.length; i++) expect(levels.indexOf(byDifficulty[i].difficulty)).toBeGreaterThanOrEqual(levels.indexOf(byDifficulty[i - 1].difficulty));
    expect(sortBank(BANK, 'group')[0].group).toBe('fundamentals');
    expect(ids(sortBank(BANK, 'prominence'))).toEqual(ids(sortBank(BANK, 'prominence')));
  });
});

describe('bookmarks, studied marks and progress', () => {
  it('persists bookmarks and studied marks under their own key, apart from interview history', () => {
    const storage = memory();
    saveInterviews(emptyInterviews(), storage); const interviews = storage.getItem(INTERVIEW_STORAGE_KEY);
    let prefs = toggleBookmark(toggleBookmark(emptyPrefs(), 'cdn'), 'chat');
    prefs = toggleStudied(prefs, 'cdn', 42);
    savePrefs(prefs, storage);
    expect(loadPrefs(storage)).toEqual({ version: 1, bookmarks: ['cdn', 'chat'], studied: { cdn: 42 } });
    expect(toggleBookmark(prefs, 'cdn').bookmarks).toEqual(['chat']);
    expect(toggleStudied(prefs, 'cdn', 50).studied).toEqual({});
    expect(storage.getItem(INTERVIEW_STORAGE_KEY)).toBe(interviews);
    expect([...storage.data.keys()].sort()).toEqual([BANK_STORAGE_KEY, INTERVIEW_STORAGE_KEY].sort());
  });
  it('ignores damaged preference data instead of failing', () => {
    const storage = memory();
    storage.setItem(BANK_STORAGE_KEY, '{not json'); expect(loadPrefs(storage)).toEqual(emptyPrefs());
    storage.setItem(BANK_STORAGE_KEY, JSON.stringify({ version: 1, bookmarks: ['cdn', 7, 'cdn'], studied: { chat: 'x', cdn: 3 } }));
    expect(loadPrefs(storage)).toEqual({ version: 1, bookmarks: ['cdn'], studied: { cdn: 3 } });
    storage.setItem(BANK_STORAGE_KEY, JSON.stringify({ version: 9 })); expect(loadPrefs(storage)).toEqual(emptyPrefs());
  });
  it('derives completion from interview records, so saved sessions stay compatible', () => {
    const definition = problemById('pastebin')!;
    let state = putDraft(emptyInterviews(), createSession(definition, { id: 'd1', at: 1, mode: 'practice' }));
    const status = (question: { definitionId: string }) => state.records.some(record => record.definitionId === question.definitionId) ? 'completed' : state.drafts.some(draft => draft.definitionId === question.definitionId) ? 'in-progress' : 'new';
    expect(status(bankQuestion('pastebin')!)).toBe('in-progress');
    state = completeSession(state, definition, state.drafts[0], { recordId: 'r1', at: 2, finishedEarly: true }).state;
    expect(status(bankQuestion('pastebin')!)).toBe('completed');
    expect(status(bankQuestion('url-shortener')!)).toBe('new');
  });
});
