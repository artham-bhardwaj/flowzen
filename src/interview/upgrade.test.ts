import { describe, expect, it } from 'vitest';
import { STORAGE_KEY as CHALLENGE_KEY } from '../challenges/progress';
import { labInput, measure } from '../lab/measure';
import { simulate } from '../simulation/engine';
import { MAX_ROOT_FOLLOW_UPS, describeTrigger, followUpPool, nextQuestions, planFollowUps } from './adaptive';
import { compareChange } from './changes';
import { DRILLS, PRACTICE_STORAGE_KEY, bottleneckSnapshot, drillById, gradeDrill, loadPractice, recommendDrills, recordAttempt, savePractice, type BottleneckMeasurement } from './drills';
import { evaluate } from './evaluate';
import { PROBLEMS, problemById, validateDefinition } from './index';
import { assessDecisions } from './reasoning';
import { buildRecord, completeSession } from './record';
import { referenceFor, referenceVersion } from './references';
import { createSession, migrateSession, planFor, update, type InterviewSession, type SessionV1 } from './session';
import { MAX_CHECKPOINTS, answerChange, answerFollowUp, checkpointById, clock, explain, goToStage, introduceChange, markAsked, pacing, recordChangeRun, restoreCheckpoint, reviseChange, saveCheckpoint, submitChange, submitFollowUp, tick } from './workflow';
import { SOLUTIONS } from './solutions.fixture';
import { INTERVIEW_STORAGE_KEY, addRecord, emptyInterviews, loadInterviews, purgeUnreadable, putDraft, saveInterviews } from './store';
import { covering, runBenchmark, snapshot, strongSession, type Graph } from './testkit';
import { MOCK_DURATIONS, stagesOf, type InterviewDefinition } from './types';
import { reviewWhiteboard } from './whiteboard';

const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };
const url = problemById('url-shortener')!;
const base = (mode: 'practice' | 'mock' = 'practice', durationMin?: number) => createSession(url, { id: 's', at: 100, mode, durationMin });
const withDesign = (graph: Graph, session = base()) => update(session, { architecture: snapshot(graph) }, 2);
const ids = (session: InterviewSession, definition: InterviewDefinition = url) => planFollowUps(definition, session).active.map(item => item.followUp.id);
const answer = (session: InterviewSession, id: string, text: string, at = 5) => submitFollowUp(answerFollowUp(markAsked(session, [{ id, reason: 'test' }], at), id, text, at), id, at);
const CACHED = SOLUTIONS['url-shortener'][0];
const REPLICAS = SOLUTIONS['url-shortener'][2];
const filler = 'This answer explains the design choice in enough words to count as a real answer here';

describe('adaptive follow-up engine', () => {
  it('branches on concepts missing from the submitted answer', () => {
    let session = answer(withDesign(CACHED), 'cache-what', covering(followUpPool(url).find(entry => entry.id === 'cache-what')!.concepts));
    session = answer(session, 'cache-miss', `Cache-aside: on a miss the service will load from the database and populate the cache. ${filler}.`);
    const plan = planFollowUps(url, session);
    const probe = plan.active.find(item => item.followUp.id === 'cache-stampede');
    expect(probe?.rule).toMatch(/without covering protection against stampedes/);
    expect(probe?.parent).toBe('cache-miss');
    // The same answer, now covering stampedes, opens no probe.
    const covered = answer(withDesign(CACHED), 'cache-what', covering(followUpPool(url).find(entry => entry.id === 'cache-what')!.concepts));
    expect(ids(answer(covered, 'cache-miss', `Cache-aside with single flight to coalesce a stampede. ${filler}.`))).not.toContain('cache-stampede');
  });
  it('branches on the parent score: a deeper question only after a solid answer', () => {
    const weak = answer(withDesign(CACHED), 'traffic-10x', `We would add more servers. ${filler}.`);
    expect(ids(weak)).not.toContain('partitioning');
    const strong = answer(withDesign(CACHED), 'traffic-10x', covering(followUpPool(url).find(entry => entry.id === 'traffic-10x')!.concepts));
    expect(ids(strong)).toContain('partitioning');
  });
  it('waits for submission: typing an answer does not branch', () => {
    const typed = answerFollowUp(markAsked(withDesign(CACHED), [{ id: 'traffic-10x', reason: 'x' }], 3), 'traffic-10x', covering(followUpPool(url).find(entry => entry.id === 'traffic-10x')!.concepts), 4);
    expect(ids(typed)).not.toContain('partitioning');
    expect(ids(submitFollowUp(typed, 'traffic-10x', 5))).toContain('partitioning');
  });
  it('probes omissions in earlier stages, once those stages have answers', () => {
    expect(ids(base())).not.toContain('estimate-peak');
    const averages = update(base(), { estimates: { writesPerDay: '3.3 million' }, estimateNotes: 'Average of 38 writes per second.' }, 2);
    expect(planFollowUps(url, averages).active.find(item => item.followUp.id === 'estimate-peak')?.rule).toMatch(/never mention “peak”/);
    expect(ids(update(averages, { estimateNotes: 'Peak is 3x the average.' }, 3))).not.toContain('estimate-peak');
    const api = update(base(), { endpoints: [{ id: 'e', method: 'POST', path: '/v1/links', request: 'url', response: 'code', errors: '400', notes: '', auth: true, idempotent: false, paginated: false }] }, 2);
    expect(ids(api)).toContain('api-abuse');
    expect(ids(update(api, { endpoints: [{ ...api.endpoints[0], notes: 'rate limit per API key, 429 when exceeded' }] }, 3))).not.toContain('api-abuse');
  });
  it('follows the read-replica chain and does not repeat a topic already discussed', () => {
    let session = withDesign(REPLICAS);
    expect(ids(session)).toContain('replica-reads');
    session = answer(session, 'replica-reads', covering(followUpPool(url).find(entry => entry.id === 'replica-reads')!.concepts));
    expect(ids(session)).toContain('replica-lag');
    // "Database unavailable" was already asked, so the replica-failover question (same topic) is held back.
    session = answer(session, 'db-down', covering(followUpPool(url).find(entry => entry.id === 'db-down')!.concepts));
    session = answer(session, 'replica-lag', covering(followUpPool(url).find(entry => entry.id === 'replica-lag')!.concepts));
    const plan = planFollowUps(url, session);
    expect(plan.active.map(item => item.followUp.id)).not.toContain('replica-failover');
    expect(plan.suppressed.find(item => item.followUp.id === 'replica-failover')?.why).toMatch(/Database unavailable/);
  });
  it('does not ask what the user already covered elsewhere, but still opens its branches', () => {
    const cacheWhat = followUpPool(url).find(entry => entry.id === 'cache-what')!;
    const session = update(withDesign(CACHED), { deepDives: { cache: covering(cacheWhat.concepts) } }, 3);
    const plan = planFollowUps(url, session);
    expect(plan.active.map(item => item.followUp.id)).not.toContain('cache-what');
    expect(plan.suppressed.find(item => item.followUp.id === 'cache-what')?.why).toMatch(/deep-dive answer “Caching redirects” already covers/);
    // Words scattered across unrelated notes do not add up to coverage.
    const scattered = update(withDesign(CACHED), { decisions: { d: 'Every access is a lookup by key.' }, designNotes: 'Popular links are hot; the working set fits in memory.' }, 3);
    expect(ids(scattered)).toContain('cache-what');
    expect(plan.active.find(item => item.followUp.id === 'cache-miss')?.rule).toMatch(/already covered/);
  });
  it('ignores components that carry no traffic and caps the opening questions', () => {
    const detached = withDesign({ nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server'], ['d', 'database'], ['k', 'cache']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd']] });
    expect(ids(detached)).not.toContain('cache-what');
    expect(ids(detached)).toContain('no-cache');
    const plan = planFollowUps(url, withDesign(CACHED));
    expect(plan.active.filter(item => item.depth === 0).length).toBeLessThanOrEqual(MAX_ROOT_FOLLOW_UPS);
    expect(plan.suppressed.some(item => /at most 5 opening questions/.test(item.why))).toBe(true);
    expect(JSON.stringify(planFollowUps(url, withDesign(CACHED)))).toBe(JSON.stringify(plan));
  });
  it('explains where an answer can lead, and records the reason a question was asked', () => {
    const leads = nextQuestions(url, 'cache-miss');
    expect(leads.map(entry => entry.followUp.id).sort()).toEqual(['cache-invalidation', 'cache-stampede']);
    expect(leads.find(entry => entry.followUp.id === 'cache-stampede')!.condition).toMatch(/leaves out protection against stampedes/);
    expect(describeTrigger({ all: [{ reached: 'api' }, { omits: { stage: 'api', any: ['rate limit'] } }] }, [])).toMatch(/reaches api design and the api design answers leave out “rate limit”/);
    const asked = markAsked(base(), [{ id: 'traffic-10x', reason: 'Every design is asked how it grows. (Rule: asked in every interview.)' }], 7);
    expect(asked.followUps['traffic-10x']).toMatchObject({ askedAt: 7, reason: expect.stringMatching(/Rule/), stage: 'requirements' });
    expect(asked.events.at(-1)).toMatchObject({ type: 'followup-asked', ref: 'traffic-10x' });
  });
  it('rejects definitions with broken branches', () => {
    const broken: InterviewDefinition = { ...url, followUps: [...url.followUps, { ...url.followUps[0], id: 'bad-branch', trigger: { after: 'cache-miss', ifMissing: ['nope'] } }, { ...url.followUps[0], id: 'hidden-branch', trigger: { any: [{ after: 'cache-miss' }] } }] };
    const errors = validateDefinition(broken).join('\n');
    expect(errors).toMatch(/unknown concept nope/); expect(errors).toMatch(/hides a branch inside "any"/);
  });
});

describe('whiteboard review', () => {
  it('labels every finding as a structural fact, a measurement or an unverified risk', () => {
    const session = strongSession(url, snapshot(CACHED));
    const review = reviewWhiteboard(url, session, assessDecisions(url, session));
    expect(new Set(review.findings.map(finding => finding.evidence))).toEqual(new Set(['fact', 'measured', 'risk']));
    expect(review.findings.filter(finding => finding.area === 'requirements').every(finding => finding.evidence === 'fact')).toBe(true);
    expect(review.findings.find(finding => finding.id === 'busiest')?.evidence).toBe('measured');
    expect(review.findings.filter(finding => finding.area === 'consistency').every(finding => finding.evidence === 'risk')).toBe(true);
    expect(review.path[0]).toMatch(/Client/);
    expect(review.notModelled.join(' ')).toMatch(/staleness/);
  });
  it('gives no credit for presence: a component outside the request path is a problem, not coverage', () => {
    const beside = withDesign({ nodes: [['u', 'client'], ['lb', 'loadBalancer'], ['a', 'server'], ['d', 'nosql'], ['k', 'distributedCache']], edges: [['u', 'lb'], ['lb', 'a'], ['a', 'd'], ['a', 'k']] });
    const review = reviewWhiteboard(url, beside);
    const readPath = review.findings.find(finding => finding.id === 'req-read-path')!;
    expect(readPath.tone).toBe('bad'); expect(readPath.detail).toMatch(/carries no traffic/);
    expect(review.findings.some(finding => finding.area === 'flow' && /carries no traffic/.test(finding.title))).toBe(true);
  });
  it('never presents a measurement it does not have', () => {
    const session = withDesign({ nodes: [['u', 'client'], ['a', 'server', { instances: '1' }], ['d', 'database']], edges: [['u', 'a'], ['a', 'd']] });
    const review = reviewWhiteboard(url, session);
    expect(review.findings.some(finding => finding.evidence === 'measured')).toBe(false);
    expect(review.findings.find(finding => finding.id === 'spof-a')).toMatchObject({ evidence: 'risk', tone: 'bad' });
    // A run on an earlier version of the design is not used either.
    const stale = update(session, { benchmark: runBenchmark(url, snapshot(CACHED)) }, 3);
    expect(reviewWhiteboard(url, stale).findings.some(finding => finding.evidence === 'measured')).toBe(false);
    expect(reviewWhiteboard(url, stale).findings.find(finding => finding.id === 'bench-missing')!.title).toMatch(/earlier version/);
  });
  it('attaches actions and learning links to problems', () => {
    const review = reviewWhiteboard(url, withDesign({ nodes: [['u', 'client'], ['a', 'server', { instances: '1' }], ['d', 'database']], edges: [['u', 'a'], ['a', 'd']] }));
    for (const finding of review.findings.filter(entry => entry.tone === 'bad')) expect(finding.action ?? finding.resources.length).toBeTruthy();
  });
});

describe('timed mock interviews', () => {
  it('plans 30, 45 and 60 minutes per problem, adding up exactly, with each problem’s own allocation', () => {
    for (const problem of PROBLEMS) for (const minutes of MOCK_DURATIONS) {
      const plan = planFor(problem, minutes);
      expect(Object.values(plan).reduce((a, b) => a + b, 0)).toBe(minutes);
      expect(Object.keys(plan)).toEqual(stagesOf(problem));
    }
    expect(PROBLEMS.every(problem => problem.stageAllocation && stagesOf(problem).every(stage => problem.stageAllocation![stage]! > 0))).toBe(true);
    expect(Object.keys(planFor(url, 45))).toContain('changes');
    expect(Object.keys(planFor(problemById('rate-limiter')!, 45))).not.toContain('changes');
    const plan = planFor(url, 60); expect(Math.max(...Object.values(plan))).toBe(plan.design);
    expect(base('mock', 30).plan!.stageMs.design).toBe(planFor(url, 30).design * 60_000);
    expect(base().plan).toBeNull();
  });
  it('records expiry once, keeps everything editable, and reports pacing', () => {
    let session = base('mock', 30);
    expect(pacing(session, stagesOf(url))).toMatchObject({ tone: 'ok' });
    session = tick(session, session.plan!.stageMs.requirements! + 60_000, 'requirements', 10);
    expect(pacing(session, stagesOf(url))).toMatchObject({ tone: 'warn', message: expect.stringMatching(/This stage has taken/) });
    session = goToStage(session, 'estimation', 11);
    session = tick(session, 20 * 60_000, 'estimation', 12);
    expect(pacing(session, stagesOf(url))!.message).toMatch(/This stage|Behind schedule/);
    session = tick(session, 10 * 60_000, 'estimation', 13);
    expect(session.expired).toEqual({ at: 13, stage: 'estimation' });
    expect(session.events.filter(event => event.type === 'expired')).toHaveLength(1);
    session = tick(session, 60_000, 'estimation', 14);
    expect(session.expired!.at).toBe(13);
    expect(clock(session)).toMatchObject({ overtime: true, remainingMs: 0 });
    expect(pacing(session, stagesOf(url))).toMatchObject({ tone: 'bad', message: expect.stringMatching(/Time is up/) });
    expect(update(session, { designNotes: 'still editable' }, 15).designNotes).toBe('still editable');
    expect(pacing(update(session, { pacing: false }, 16), stagesOf(url))).toBeNull();
    expect(pacing(base(), stagesOf(url))).toBeNull();
  });
  it('recovers after a reload: timing, plan and expiry survive storage, and version 1 drafts migrate without loss', () => {
    const storage = memory();
    const session = tick(base('mock', 45), 61_000, 'requirements', 3);
    saveInterviews(putDraft(emptyInterviews(), session), storage);
    const loaded = loadInterviews(storage).state.drafts[0];
    expect(loaded).toEqual(session);
    const { version: _version, plan: _plan, pacing: _pacing, expired: _expired, explanations: _explanations, checkpoints: _checkpoints, changes: _changes, events: _events, ...rest } = withDesign(CACHED);
    const v1: SessionV1 = { ...rest, version: 1, followUps: { 'traffic-10x': { askedAt: 1, answer: 'Scale out.', answeredAt: 2 } } };
    const migrated = migrateSession(v1);
    expect(migrated).toMatchObject({ version: 2, architecture: v1.architecture, requirements: v1.requirements, checkpoints: [], changes: {}, events: [], plan: null });
    expect(migrated.followUps['traffic-10x']).toEqual({ askedAt: 1, answer: 'Scale out.', answeredAt: 2, submittedAt: 2 });
    storage.setItem(INTERVIEW_STORAGE_KEY, JSON.stringify({ version: 1, drafts: [v1], records: [], corrections: {} }));
    expect(loadInterviews(storage)).toMatchObject({ dropped: [], state: { drafts: [{ version: 2, id: 's' }] } });
  });
});

describe('requirement changes and checkpoints', () => {
  const change = (id: string) => url.changes!.find(entry => entry.id === id)!;
  it('keeps the original design when a change is introduced and compares it with the revision', () => {
    let session = withDesign(CACHED);
    session = introduceChange(session, 'campaign-5x', change('campaign-5x').title, 10);
    const baseline = checkpointById(session, session.changes['campaign-5x'].baselineId)!;
    expect(baseline.kind).toBe('change-before');
    expect(baseline.architecture).toEqual(session.architecture);
    const original = structuredClone(baseline.architecture);
    // Revise: more cache capacity. The baseline checkpoint is untouched.
    const revised = { ...session.architecture!, nodes: session.architecture!.nodes.map(node => node.id === 'k' ? { ...node, config: { ...node.config, nodes: '8' } } : node) };
    session = update(session, { architecture: revised }, 11);
    session = reviseChange(session, 'campaign-5x', change('campaign-5x').title, 12);
    expect(checkpointById(session, session.changes['campaign-5x'].baselineId)!.architecture).toEqual(original);
    let comparison = compareChange(url, session, change('campaign-5x'));
    expect(comparison.diff!.components.map(entry => entry.label)).toEqual([expect.stringMatching(/Distributed Cache k/)]);
    expect(comparison.comparable).toBe(false); expect(comparison.notComparable).toMatch(/Run the change on both/);
    session = recordChangeRun(session, 'campaign-5x', 'original', runBenchmark(url, original, change('campaign-5x').scenario), 13);
    session = recordChangeRun(session, 'campaign-5x', 'revised', runBenchmark(url, revised, change('campaign-5x').scenario), 14);
    comparison = compareChange(url, session, change('campaign-5x'));
    expect(comparison.comparable).toBe(true);
    expect(comparison.original!.architectureKey).not.toBe(comparison.revised!.architectureKey);
    expect(typeof comparison.meets.original).toBe('boolean');
    // Saving the revision again clears the revised run (it belonged to the previous revision), never the original.
    session = reviseChange(session, 'campaign-5x', change('campaign-5x').title, 15);
    expect(session.changes['campaign-5x'].runs.revised).toBeUndefined(); expect(session.changes['campaign-5x'].runs.original).toBeDefined();
  });
  it('labels changes the simulator cannot model as hypothetical and scores the reasoning only, marked for review', () => {
    let session = introduceChange(withDesign(CACHED), 'editable-links', change('editable-links').title, 10);
    session = submitChange(answerChange(session, 'editable-links', covering(change('editable-links').considerations), 11), 'editable-links', 12);
    expect(compareChange(url, session, change('editable-links'))).toMatchObject({ mode: 'hypothetical', comparable: false });
    const criterion = evaluate(url, session).criteria.find(entry => entry.id === 'change-editable-links')!;
    expect(criterion.score).toBe(4); expect(criterion.manualReview).toMatch(/cannot model/);
  });
  it('caps a response whose measured revision still misses the changed targets', () => {
    const graph: Graph = { nodes: [['u', 'client'], ['a', 'server', { instances: '2' }], ['d', 'database']], edges: [['u', 'a'], ['a', 'd']] };
    let session = introduceChange(withDesign(graph), 'latency-20ms', change('latency-20ms').title, 10);
    session = reviseChange(session, 'latency-20ms', change('latency-20ms').title, 11);
    const architecture = snapshot(graph);
    session = recordChangeRun(recordChangeRun(session, 'latency-20ms', 'original', runBenchmark(url, architecture), 12), 'latency-20ms', 'revised', runBenchmark(url, architecture), 13);
    session = answerChange(session, 'latency-20ms', covering(change('latency-20ms').considerations), 14);
    const criterion = evaluate(url, session).criteria.find(entry => entry.id === 'change-latency-20ms')!;
    expect(compareChange(url, session, change('latency-20ms')).meets.revised).toBe(false);
    expect(criterion.score).toBe(2);
    expect(criterion.evidence.some(entry => entry.basis === 'measured' && /revised p95/.test(entry.text))).toBe(true);
  });
  it('never loses a design: restoring saves the current one first; automatic checkpoints skip unchanged designs', () => {
    let session = goToStage(withDesign(CACHED, goToStage(base(), 'design', 1)), 'deepdive', 3);
    expect(session.checkpoints).toHaveLength(1);
    session = goToStage(goToStage(session, 'design', 4), 'review', 5);
    expect(session.checkpoints).toHaveLength(1);
    const first = session.checkpoints[0];
    session = update(session, { architecture: snapshot(REPLICAS) }, 6);
    session = restoreCheckpoint(session, first.id, 7);
    expect(session.architecture).toEqual(first.architecture);
    expect(session.checkpoints.at(-1)).toMatchObject({ kind: 'restore', architecture: snapshot(REPLICAS) });
    for (let i = 0; i < MAX_CHECKPOINTS + 5; i++) session = saveCheckpoint(update(session, { designNotes: String(i) }, 8 + i), { at: 8 + i, label: `m${i}`, kind: 'manual' });
    expect(session.checkpoints).toHaveLength(MAX_CHECKPOINTS);
    expect(introduceChange(session, 'campaign-5x', 'x', 99).checkpoints).toHaveLength(MAX_CHECKPOINTS + 1);
  });
});

describe('records, playback and reference versions', () => {
  const complete = () => {
    let session = strongSession(url, snapshot(CACHED));
    session = saveCheckpoint(session, { at: 4, label: 'Before replicas', kind: 'manual' });
    session = update(session, { architecture: snapshot(REPLICAS) }, 5);
    return completeSession(putDraft(emptyInterviews(), session), url, session, { recordId: 'r1', at: 9, finishedEarly: false });
  };
  it('freezes the completed session with its checkpoints, history, settings and versions', () => {
    const { record, state } = complete();
    expect(record).toMatchObject({ version: 2, evaluatorVersion: 2, definitionVersion: 2, referenceVersion: 2, benchmark: url.benchmark });
    expect(record.changes!.map(entry => entry.id)).toEqual(url.changes!.map(entry => entry.id));
    expect(record.session.checkpoints.length).toBeGreaterThan(1);
    expect(Object.isFrozen(record.session.checkpoints[0].architecture.nodes[0])).toBe(true);
    expect(Object.isFrozen(record.session.events)).toBe(true);
    expect(() => { (record.session.checkpoints as unknown as unknown[]).push({}); }).toThrow();
    expect(record.evaluation.whiteboard!.findings.length).toBeGreaterThan(0);
    expect(addRecord(state, { ...record })).toBe(state);
  });
  it('loads a historical checkpoint as a new draft without touching the record or other drafts', () => {
    const { record, state } = complete();
    const before = JSON.stringify(record);
    const other = createSession(url, { id: 'other', at: 1, mode: 'practice' });
    const checkpoint = record.session.checkpoints.find(entry => entry.label === 'Before replicas')!;
    const draft = createSession(url, { id: 'new', at: 20, mode: 'practice', from: { recordId: record.id, session: record.session, checkpointId: checkpoint.id } });
    expect(draft.architecture).toEqual(checkpoint.architecture);
    expect(draft.architecture).not.toEqual(record.session.architecture);
    expect(draft).toMatchObject({ origin: { recordId: 'r1', checkpointId: checkpoint.id }, checkpoints: [], changes: {}, benchmark: null, hintsUsed: [] });
    const next = putDraft(putDraft(state, other), draft);
    expect(next.drafts.map(entry => entry.id)).toEqual(['other', 'new']);
    expect(JSON.stringify(next.records[0])).toBe(before);
  });
  it('versions reference solutions with their definitions', () => {
    expect(referenceVersion(url)).toBe(2);
    expect(referenceFor(url, 2)).toMatchObject({ version: 2, exact: true });
    const v1 = referenceFor(url, 1);
    expect(v1).toMatchObject({ version: 1, exact: true }); expect(v1.reference.whyItWorks).toBeUndefined();
    expect(referenceFor(url, 7)).toMatchObject({ version: 2, exact: false });
    expect(url.reference.whyItWorks!.length).toBeGreaterThan(2); expect(url.reference.lld!.length).toBeGreaterThan(2); expect(url.reference.preferAlternatives!.length).toBeGreaterThan(2);
    expect(validateDefinition({ ...url, referenceHistory: [{ ...url.reference, version: 2 }] }).join()).toMatch(/reference versions must be unique/);
    expect(validateDefinition({ ...url, reference: { ...url.reference, version: 3 } }).join()).toMatch(/cannot be newer/);
  });
  it('keeps unreadable and future-version entries verbatim instead of discarding them', () => {
    const storage = memory(); const { record } = complete();
    const future = { ...record, id: 'future', version: 9 };
    const damaged = { schema: 'flowzen.interview-session', version: 2, id: 'broken' };
    storage.setItem(INTERVIEW_STORAGE_KEY, JSON.stringify({ version: 2, drafts: [damaged], records: [record, future], corrections: {}, unreadable: [] }));
    const loaded = loadInterviews(storage);
    expect(loaded.state.records.map(entry => entry.id)).toEqual(['r1']);
    expect(loaded.state.unreadable.map(entry => entry.reason)).toEqual(['missing identity', expect.stringMatching(/newer version of Flowzen/)]);
    saveInterviews(loaded.state, storage);
    const again = JSON.parse(storage.getItem(INTERVIEW_STORAGE_KEY)!);
    expect(again.unreadable.map((entry: { raw: unknown }) => entry.raw)).toEqual([damaged, JSON.parse(JSON.stringify(future))]);
    expect(purgeUnreadable(loaded.state)).toMatchObject({ unreadable: [], records: loaded.state.records });
    // A version 1 record keeps its stored evaluation; only the session gains empty version 2 fields.
    const { version: _v, plan: _p, pacing: _pc, expired: _e, explanations: _x, checkpoints: _c, changes: _ch, events: _ev, ...rest } = record.session;
    const old = { ...record, id: 'old', version: 1, evaluatorVersion: 1, session: { ...rest, version: 1 } };
    storage.setItem(INTERVIEW_STORAGE_KEY, JSON.stringify({ version: 1, drafts: [], records: [old], corrections: {} }));
    const migrated = loadInterviews(storage).state.records[0];
    expect(migrated.evaluation).toEqual(JSON.parse(JSON.stringify(record.evaluation)));
    expect(migrated.session).toMatchObject({ version: 2, checkpoints: [], events: [] });
  });
});

describe('evaluation transparency', () => {
  it('explains every criterion with labelled evidence, and marks judgement calls for review', () => {
    const evaluation = evaluate(url, strongSession(url, snapshot(CACHED)));
    for (const criterion of evaluation.criteria) { expect(criterion.evidence.length).toBeGreaterThan(0); expect(['structural', 'measured', 'arithmetic', 'keyword']).toContain(criterion.basis); }
    expect(evaluation.criteria.find(entry => entry.id === 'decision-reasoning')!.manualReview).toMatch(/cannot tell whether the reasoning is correct/);
    expect(evaluation.version).toBe(2);
  });
  it('checks cited numbers against the user’s own estimates and measurements', () => {
    let session = update(withDesign(CACHED), { estimates: { writesPerDay: '3.3 million' }, benchmark: runBenchmark(url, snapshot(CACHED)) }, 3);
    const dim = (s: InterviewSession) => assessDecisions(url, s).find(entry => entry.nodeId === 'k')!.dimensions.find(entry => entry.id === 'evidence')!;
    session = explain(session, 'k', { evidence: 'With 3.2 million new links per day most redirects repeat.' }, 4);
    expect(dim(session)).toMatchObject({ met: true, basis: 'arithmetic', note: expect.stringMatching(/your estimate/) });
    session = explain(session, 'k', { evidence: `p95 should be ${session.benchmark!.p95} ms with the cache.` }, 5);
    expect(dim(session).note).toMatch(/measured p95/);
    session = explain(session, 'k', { evidence: 'I assume roughly 3 percent of links are custom aliases.' }, 6);
    expect(dim(session)).toMatchObject({ met: true, basis: 'keyword', note: expect.stringMatching(/unverified/) });
    session = explain(session, 'k', { evidence: 'It is faster.' }, 7);
    expect(dim(session).met).toBe(false);
  });
  it('gives no reasoning credit for an empty explanation, and full credit only when every part is present', () => {
    const empty = assessDecisions(url, withDesign(CACHED));
    expect(empty.every(entry => entry.score <= 1)).toBe(true);
    const strong = assessDecisions(url, strongSession(url, snapshot(CACHED)));
    expect(strong.every(entry => entry.score === 4)).toBe(true);
    expect(strong[0].dimensions.map(dim => dim.id)).toEqual(['problem', 'approach', 'alternatives', 'tradeoffs', 'failure', 'evidence']);
  });
});

describe('targeted practice', () => {
  const measureTask = (graph: Parameters<typeof bottleneckSnapshot>[0]): BottleneckMeasurement => {
    const input = labInput(bottleneckSnapshot(graph), { rps: graph.rps, durationMs: 5000, drainMs: 1500, seed: 7, faults: [] });
    const components = measure(simulate(input), input, {}).components.filter(component => component.kind !== 'client');
    return { busiestId: components[0].id, utilization: Object.fromEntries(components.map(component => [component.id, component.utilization])) };
  };
  it('offers curated drills for all seven skills, with valid resources', () => {
    expect(new Set(DRILLS.map(drill => drill.skill)).size).toBe(7);
    expect(new Set(DRILLS.map(drill => drill.id)).size).toBe(DRILLS.length);
  });
  it('grades numbers, choices and text by explicit rules', () => {
    const photos = drillById('est-photos')!;
    const result = gradeDrill(photos, { 'n.uploads': '460', 'n.views': '40000', 'n.storage': '1200', w: 'Reads dominate: 50 views per upload, so a CDN serves photos, and storage grows by many TB in object storage.' });
    expect(result.tasks[0]).toMatchObject({ basis: 'arithmetic', score: 2 });
    expect(result.tasks[0].evidence.map(entry => entry.positive)).toEqual([true, false, false]);
    expect(result.tasks[1].score).toBe(4);
    const sessions = drillById('pick-sessions')!;
    expect(gradeDrill(sessions, { c: 'cache' }).tasks[0].score).toBe(4);
    expect(gradeDrill(sessions, { c: 'sql' }).tasks[0].score).toBe(2);
    expect(gradeDrill(sessions, { c: 'local' }).tasks[0]).toMatchObject({ score: 0, missed: [expect.stringMatching(/Best fit/)] });
  });
  it('checks bottleneck answers against a simulator measurement, not a stored answer', () => {
    for (const [id, expected] of [['bottleneck-store', 'db'], ['bottleneck-cache', 'app']] as const) {
      const drill = drillById(id)!; const task = drill.tasks[0]; if (task.type !== 'bottleneck') throw new Error('expected a bottleneck task');
      const measured = { [task.id]: measureTask(task.graph) };
      expect(measured[task.id].busiestId).toBe(expected);
      expect(gradeDrill(drill, { [task.id]: expected }, measured).tasks[0]).toMatchObject({ score: 4, basis: 'measured' });
      expect(gradeDrill(drill, { [task.id]: 'u' }, measured).tasks[0].score).toBe(0);
      expect(gradeDrill(drill, { [task.id]: expected }).tasks[0].score).toBe(0);
    }
  });
  it('stores attempts under their own key, apart from interviews and challenges', () => {
    const storage = memory();
    const interviews = putDraft(emptyInterviews(), base());
    saveInterviews(interviews, storage);
    const before = storage.getItem(INTERVIEW_STORAGE_KEY);
    const { state, attempt } = recordAttempt({ version: 1, attempts: [] }, drillById('to-sync-async')!, { t: 'A queue keeps latency low and isolates failure of the email provider with retries; duplicates need idempotent sending.' }, {}, { id: 'a1', at: 3 });
    savePractice(state, storage);
    expect(storage.getItem(INTERVIEW_STORAGE_KEY)).toBe(before);
    expect(storage.data.has(CHALLENGE_KEY)).toBe(false);
    expect([...storage.data.keys()].sort()).toEqual([INTERVIEW_STORAGE_KEY, PRACTICE_STORAGE_KEY].sort());
    expect(Object.isFrozen(attempt.result)).toBe(true);
    expect(loadPractice(storage).state.attempts).toHaveLength(1);
    storage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify({ version: 1, attempts: [attempt, { schema: 'nope' }] }));
    expect(loadPractice(storage)).toMatchObject({ dropped: 1, state: { attempts: [{ id: 'a1' }] } });
  });
  it('recommends drills only from evidence: weak interview competencies or low drill scores', () => {
    expect(recommendDrills(emptyInterviews(), { version: 1, attempts: [] })).toEqual([]);
    const weak = completeSession(emptyInterviews(), url, base(), { recordId: 'r', at: 3, finishedEarly: true }).state;
    const recs = recommendDrills(weak, { version: 1, attempts: [] });
    expect(recs.map(entry => entry.skill)).toContain('estimation');
    expect(recs.find(entry => entry.skill === 'estimation')!.reason).toMatch(/averages 0\.0\/4 across 1 completed interview/);
    const low = recordAttempt({ version: 1, attempts: [] }, drillById('fail-retry-storm')!, { t: 'retry' }, {}, { id: 'x', at: 1 }).state;
    expect(low.attempts[0].result.percent).toBeLessThan(70);
    expect(recommendDrills(emptyInterviews(), low)).toEqual([expect.objectContaining({ skill: 'failure', reason: `Your latest failure analysis drill scored ${low.attempts[0].result.percent}%.` })]);
    expect(buildRecord(url, base(), { recordId: 'q', at: 1, finishedEarly: false }).session.id).toBe('s');
  });
});
