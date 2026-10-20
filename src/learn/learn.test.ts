import { describe, expect, it } from 'vitest';
import { byKind, catalog } from '../app/catalog';
import { place, type FlowEdge, type FlowNode } from '../app/model';
import { challenges, challengeById } from '../challenges/definitions';
import { emptyProgress } from '../challenges/progress';
import { measure } from '../lab/measure';
import { LLD_COVERAGE } from '../lld/coverage';
import { simulate } from '../simulation/engine';
import { swapComponent, swappableAlternatives } from './alternatives';
import { ALL_KINDS, GUIDES, componentKnowledge } from './components';
import { LESSONS, MODULES, lessonById } from './curriculum';
import { buildInput, evaluateBuild, gradeClassify, gradeNumeric, gradeQuestion, gradeQuiz, parseAnswer, taskArchitecture } from './evaluate';
import { EXPERIMENTS, experimentById, experimentInput, makeExperimentRecord, variantBenchmark, variantLabels } from './experiments';
import {
  EXPERIMENT_HISTORY, LEARN_STORAGE_KEY, emptyLearn, experimentCompleted, lessonStatus, lessonsForChallenge, lessonsForCriterion, loadLearn, moduleProgress, nextLesson,
  recommendedChallenges, recordExperiment, recordQuiz, recordTask, requirements, saveLearn, visitSection,
} from './progress';
import { READING_SECTIONS, isLesson, type BuildTask, type Lesson } from './types';

const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };
const runVariant = (id: string) => {
  const template = experimentById(id)!;
  return template.variants.map(variant => { const input = experimentInput(template, variant); return { variantId: variant.id, measurements: measure(simulate(input), input, variantLabels(variant)) }; });
};
const buildTasks = LESSONS.flatMap(lesson => (lesson.exercise?.tasks ?? []).filter((task): task is BuildTask => task.type === 'build').map(task => ({ lesson, task })));
const runBuild = (task: BuildTask, nodes: BuildTask['starter'], edges: Array<[string, string]>) => {
  const architecture = taskArchitecture(nodes, edges, kind => byKind[kind].defaults);
  const input = buildInput(task, architecture);
  return evaluateBuild(task, architecture, measure(simulate(input), input, {}));
};
/** Completes every requirement of a lesson in a state. */
function complete(state: ReturnType<typeof emptyLearn>, lesson: Lesson, at = 1) {
  let next = state;
  for (const section of READING_SECTIONS) next = visitSection(next, lesson.id, section, at);
  next = recordQuiz(next, lesson.id, gradeQuiz(lesson.quiz, Object.fromEntries(lesson.quiz.map(q => [q.id, q.correct]))), {}, at);
  for (const task of lesson.exercise?.tasks ?? []) next = recordTask(next, lesson.id, task.id, at);
  if (lesson.experiment) next = recordExperiment(next, makeExperimentRecord(experimentById(lesson.experiment)!, runVariant(lesson.experiment), at));
  return next;
}

describe('curriculum structure and navigation', () => {
  it('has the ten modules in order, with Module 1 fully written', () => {
    expect(MODULES.map(module => module.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const foundations = MODULES[0];
    expect(foundations.lessons.length).toBe(9);
    expect(foundations.lessons.every(isLesson)).toBe(true);
  });
  it('uses unique lesson ids across written and planned lessons, and each written lesson belongs to its module', () => {
    const ids = MODULES.flatMap(module => module.lessons.map(lesson => lesson.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const module of MODULES) for (const lesson of module.lessons.filter(isLesson)) expect(lesson.moduleId).toBe(module.id);
    expect(lessonById('approach')?.title).toMatch(/approach/);
    expect(lessonById('does-not-exist')).toBeUndefined();
  });
  it('every written lesson has every standard section filled in', () => {
    for (const lesson of LESSONS) {
      const { concept, whyWhen, alternatives, design } = lesson;
      expect(concept.definition.length, lesson.id).toBeGreaterThan(40);
      for (const part of [concept.problem, concept.whyItOccurs, concept.howItWorks, concept.terms, concept.diagrams, concept.advantages, concept.limitations]) expect(part.length, lesson.id).toBeGreaterThan(0);
      for (const part of [whyWhen.usefulWhen, whyWhen.unnecessaryWhen, whyWhen.makesWorse, whyWhen.complexity, whyWhen.failureModes, whyWhen.evidence]) expect(part.length, lesson.id).toBeGreaterThan(0);
      expect(alternatives.table.rows.length, lesson.id).toBeGreaterThan(1);
      for (const row of alternatives.table.rows) expect(row.length, `${lesson.id} table row`).toBe(alternatives.table.columns.length);
      expect(alternatives.options.length, lesson.id).toBeGreaterThan(1);
      for (const part of [design.upstream, design.downstream, design.flow, design.configuration, design.bottlenecks, design.failure]) expect(part.length, lesson.id).toBeGreaterThan(0);
      expect(lesson.quiz.length, lesson.id).toBeGreaterThanOrEqual(3);
      expect(lesson.experiment || lesson.noExperimentReason, `${lesson.id} explains a missing experiment`).toBeTruthy();
      expect(lesson.exercise?.tasks.length ?? 0, `${lesson.id} has a practical exercise`).toBeGreaterThan(0);
    }
  });
  it('diagrams reference their own nodes', () => {
    for (const lesson of LESSONS) for (const diagram of [...lesson.concept.diagrams, lesson.design.diagram]) {
      const ids = new Set(diagram.nodes.map(node => node.id));
      expect(ids.size, diagram.id).toBe(diagram.nodes.length);
      for (const edge of diagram.edges) expect(ids.has(edge.from) && ids.has(edge.to), `${diagram.id} ${edge.from}->${edge.to}`).toBe(true);
    }
  });
  it('quiz questions test judgment, not only definitions, and their keys are valid', () => {
    for (const lesson of LESSONS) {
      expect(lesson.quiz.some(question => ['why', 'when', 'trade-off', 'failure'].includes(question.skill)), lesson.id).toBe(true);
      expect(new Set(lesson.quiz.map(question => question.id)).size).toBe(lesson.quiz.length);
      for (const question of lesson.quiz) {
        const options = new Set(question.options.map(option => option.id));
        expect(question.correct.length).toBeGreaterThan(0);
        expect(question.correct.every(id => options.has(id)), `${lesson.id}/${question.id}`).toBe(true);
        if (question.mode === 'single') expect(question.correct.length, `${lesson.id}/${question.id}`).toBe(1);
        expect(question.explanation.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('knowledge-check and task evaluation', () => {
  const lesson = lessonById('bottlenecks')!;
  it('requires exactly the correct options', () => {
    const multi = lesson.quiz.find(question => question.mode === 'multi')!;
    expect(gradeQuestion(multi, multi.correct).correct).toBe(true);
    expect(gradeQuestion(multi, multi.correct.slice(1)).correct).toBe(false);
    expect(gradeQuestion(multi, [...multi.correct, 'servers']).wrong).toEqual(['servers']);
    expect(gradeQuestion(multi, []).answered).toBe(false);
    expect(gradeQuestion(multi, ['not-an-option']).answered).toBe(false);
  });
  it('scores a quiz and applies the pass threshold', () => {
    const all = Object.fromEntries(lesson.quiz.map(question => [question.id, question.correct]));
    expect(gradeQuiz(lesson.quiz, all)).toMatchObject({ score: 4, total: 4, percent: 100, passed: true });
    const one = { [lesson.quiz[0].id]: lesson.quiz[0].correct };
    expect(gradeQuiz(lesson.quiz, one)).toMatchObject({ score: 1, percent: 25, passed: false });
  });
  it('parses numbers with separators and units, and applies tolerance', () => {
    expect(parseAnswer('1,200 req/s')).toBe(1200); expect(parseAnswer(' 43.2 ')).toBe(43.2); expect(parseAnswer('99.84%')).toBe(99.84); expect(parseAnswer('abc')).toBeNull();
    const task = lessonById('performance-metrics')!.exercise!.tasks.find(entry => entry.id === 'downtime')!;
    if (task.type !== 'numeric') throw new Error('expected numeric');
    expect(gradeNumeric(task, '43.2').correct).toBe(true); expect(gradeNumeric(task, '43').correct).toBe(true); expect(gradeNumeric(task, '40').correct).toBe(false);
  });
  it('numeric answers are consistent with their working', () => {
    for (const lessonEntry of LESSONS) for (const task of lessonEntry.exercise?.tasks ?? []) if (task.type === 'numeric') {
      expect(task.working.length, task.id).toBeGreaterThan(0);
      expect(gradeNumeric(task, String(task.answer)).correct, task.id).toBe(true);
    }
  });
  it('classification requires every item in the right category', () => {
    const task = lessonById('requirements')!.exercise!.tasks[0];
    if (task.type !== 'classify') throw new Error('expected classify');
    const right = Object.fromEntries(task.items.map(item => [item.id, item.category]));
    expect(gradeClassify(task, right).correct).toBe(true);
    expect(gradeClassify(task, { ...right, buy: 'Non-functional' }).correct).toBe(false);
    for (const item of task.items) expect(task.categories).toContain(item.category);
  });
  it.each(buildTasks.map(({ lesson: owner, task }) => [`${owner.id}/${task.id}`, task] as const))('build task %s: the solution passes and the starter fails', (_name, task) => {
    const solved = runBuild(task, task.solution.nodes, task.solution.edges);
    expect(solved.checks.filter(check => !check.met)).toEqual([]);
    expect(solved.passed).toBe(true);
    expect(runBuild(task, task.starter, task.starterEdges).passed).toBe(false);
  });
  it('build tasks force their overrides, so lowering work does not pass', () => {
    const task = lessonById('capacity-estimation')!.exercise!.tasks.find((entry): entry is BuildTask => entry.type === 'build')!;
    const cheat = task.starter.map(node => node.kind === 'server' ? { ...node, config: { instances: '40', processingLatencyMs: '1' } } : node);
    const input = buildInput(task, taskArchitecture(cheat, task.starterEdges, kind => byKind[kind].defaults));
    expect(input.nodes.find(node => node.kind === 'server')!.config!.processingLatencyMs).toBe('25');
    expect(input.offeredRps).toBe(1200); expect(input.seed).toBe(42);
  });
});

describe('controlled experiments', () => {
  it('every variant of a template shares the seed, duration and drain; only declared workload overrides differ', () => {
    for (const template of EXPERIMENTS) {
      const benchmarks = template.variants.map(variant => variantBenchmark(template, variant));
      for (const benchmark of benchmarks) expect([benchmark.seed, benchmark.durationMs, benchmark.drainMs]).toEqual([template.benchmark.seed, template.benchmark.durationMs, template.benchmark.drainMs]);
      const differsInWorkload = template.variants.some(variant => variant.rps !== undefined || variant.faults !== undefined);
      if (differsInWorkload) expect(template.variable.toLowerCase(), template.id).toMatch(/traffic|outage|fails/);
      expect(template.theory.length).toBeGreaterThan(0); expect(template.limitations.length, template.id).toBeGreaterThan(0);
      expect(new Set(template.variants.map(variant => variant.id)).size).toBe(template.variants.length);
    }
  });
  it.each(EXPERIMENTS.map(template => [template.id] as const))('%s supports its hypothesis with measured results, deterministically', id => {
    const template = experimentById(id)!;
    const first = runVariant(id); const second = runVariant(id);
    expect(first.every(result => result.measurements.complete)).toBe(true);
    const conclusion = template.analyze(first);
    expect(conclusion.status, conclusion.summary).toBe('supports');
    expect(conclusion.evidence.length).toBeGreaterThan(0);
    expect(JSON.stringify(template.analyze(second))).toBe(JSON.stringify(conclusion));
  });
  it('is inconclusive rather than guessing when a variant is missing or incomplete', () => {
    const template = experimentById('cache-vs-database')!;
    const results = runVariant(template.id);
    expect(template.analyze(results.slice(1)).status).toBe('inconclusive');
    const incomplete = results.map((result, i) => i === 0 ? { ...result, measurements: { ...result.measurements, complete: false } } : result);
    expect(template.analyze(incomplete).status).toBe('inconclusive');
  });
  it('records store metric values only and are frozen', () => {
    const template = experimentById('vertical-vs-horizontal')!;
    const record = makeExperimentRecord(template, runVariant(template.id), 5);
    expect(record.variants.map(variant => variant.id)).toEqual(template.variants.map(variant => variant.id));
    expect(Object.keys(record.variants[0].values)).toEqual(template.metrics.map(metric => metric.id));
    expect(Object.isFrozen(record) && Object.isFrozen(record.variants[0])).toBe(true);
    expect(JSON.stringify(record).length).toBeLessThan(5000);
  });
  it('every lesson experiment exists and lists the lesson', () => {
    for (const lesson of LESSONS) if (lesson.experiment) expect(experimentById(lesson.experiment)?.lessons, lesson.id).toContain(lesson.id);
  });
});

describe('component knowledge', () => {
  it('has a guide for every catalog component and nothing else', () => {
    expect(Object.keys(GUIDES).sort()).toEqual(catalog.map(item => item.kind).sort());
    expect(ALL_KINDS.length).toBe(catalog.length);
  });
  it('is consistent with the catalog, LLD coverage and the curriculum', () => {
    const lessonIds = new Set(MODULES.flatMap(module => module.lessons.map(lesson => lesson.id)));
    for (const kind of ALL_KINDS) {
      const knowledge = componentKnowledge(kind); const guide = GUIDES[kind];
      expect(knowledge.item).toBe(byKind[kind]);
      expect(knowledge.lld === null).toBe(!(kind in LLD_COVERAGE));
      for (const concept of guide.concepts) expect(lessonIds.has(concept), `${kind} → ${concept}`).toBe(true);
      for (const alternative of guide.alternatives) if (alternative.kind) { expect(alternative.kind in byKind).toBe(true); expect(alternative.kind).not.toBe(kind); }
      expect(guide.why.length).toBeGreaterThan(20);
      // Every non-simulated component says so in its simulator limitations.
      if (!byKind[kind].simulated) expect(guide.simulator.limitations.join(' ')).toMatch(/Not simulated/);
      expect(guide.simulator.models.length + guide.simulator.limitations.length).toBeGreaterThan(0);
    }
  });
  it('lessons reference real components, LLD designs and challenges', () => {
    for (const lesson of LESSONS) {
      for (const kind of lesson.components) expect(kind in byKind, `${lesson.id} → ${kind}`).toBe(true);
      for (const kind of lesson.lld) expect(kind in LLD_COVERAGE, `${lesson.id} LLD → ${kind}`).toBe(true);
      for (const id of lesson.challenges) expect(challengeById(id), `${lesson.id} → ${id}`).toBeDefined();
      for (const option of lesson.alternatives.options) if (option.kind) expect(option.kind in byKind).toBe(true);
      for (const diagram of [...lesson.concept.diagrams, lesson.design.diagram]) for (const node of diagram.nodes) if (node.kind) expect(node.kind in byKind).toBe(true);
    }
  });
  it('lists written lessons that reference a component', () => {
    const cache = componentKnowledge('cache');
    expect(cache.lessons[0]).toMatchObject({ id: 'why-caching', written: true });
    expect(cache.lessons.some(entry => !entry.written)).toBe(true);
  });
});

describe('trying alternatives', () => {
  const nodes = (): FlowNode[] => [place('c', 'client', 'Users', 0, 0), place('api', 'server', 'API', 1, 0), { ...place('k', 'cache', 'Cache', 2, 0), selected: true }, place('db', 'database', 'Orders DB', 3, 0)];
  const edges: FlowEdge[] = [['c', 'api'], ['api', 'k'], ['k', 'db']].map(([source, target]) => ({ id: `${source}-${target}`, source, target, type: 'flow' }));
  it('offers only alternatives that are real components', () => {
    expect(swappableAlternatives('cache').map(entry => entry.kind)).toEqual(['distributedCache', 'cdn', 'readReplica']);
    expect(swappableAlternatives('client')).toEqual([]);
  });
  it('replaces one component, keeps its id and connections, and leaves the input untouched', () => {
    const before = nodes(); const snapshot = JSON.stringify(before);
    const next = swapComponent(before, edges, 'k', 'distributedCache')!;
    expect(next.nodes.find(node => node.id === 'k')!.data).toMatchObject({ kind: 'distributedCache', label: 'Distributed Cache', config: byKind.distributedCache.defaults });
    expect(next.edges.map(edge => edge.id)).toEqual(edges.map(edge => edge.id));
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(swapComponent(before, edges, 'api', 'containerService')!.nodes.find(node => node.id === 'api')!.data.label).toBe('API');
  });
  it('refuses unlisted alternatives and given systems', () => {
    expect(swapComponent(nodes(), edges, 'k', 'worker')).toBeNull();
    expect(swapComponent(nodes().map(node => node.id === 'k' ? { ...node, data: { ...node.data, fixture: true } } : node), edges, 'k', 'distributedCache')).toBeNull();
  });
});

describe('learning progress', () => {
  const lesson = lessonById('horizontal-vertical')!;
  it('marks a lesson read only after every reading section is opened', () => {
    let state = emptyLearn();
    for (const section of READING_SECTIONS.slice(0, 3)) state = visitSection(state, lesson.id, section, 10);
    expect(state.lessons[lesson.id].readAt).toBeUndefined();
    expect(lessonStatus(state, lesson)).toBe('in-progress');
    state = visitSection(state, lesson.id, 'design', 20);
    expect(state.lessons[lesson.id].readAt).toBe(20);
  });
  it('requires read, check, experiment and exercise, but never a challenge', () => {
    const reqs = requirements(emptyLearn(), lesson);
    expect(reqs.map(req => req.id)).toEqual(['read', 'check', 'experiment', 'exercise']);
    expect(requirements(emptyLearn(), lessonById('requirements')!).map(req => req.id)).toEqual(['read', 'check', 'exercise']);
    const done = complete(emptyLearn(), lesson);
    expect(lessonStatus(done, lesson)).toBe('completed');
    expect(experimentCompleted(done, 'vertical-vs-horizontal')).toBe(true);
  });
  it('keeps the best check result across retakes and counts attempts', () => {
    const quiz = lesson.quiz; const all = Object.fromEntries(quiz.map(q => [q.id, q.correct]));
    let state = recordQuiz(emptyLearn(), lesson.id, gradeQuiz(quiz, all), all, 1);
    state = recordQuiz(state, lesson.id, gradeQuiz(quiz, {}), {}, 2);
    expect(state.lessons[lesson.id].quiz).toMatchObject({ attempts: 2, best: { percent: 100, passed: true }, last: { percent: 0, passed: false } });
  });
  it('keeps the newest experiment runs and never edits old records', () => {
    const template = experimentById('vertical-vs-horizontal')!; const results = runVariant(template.id);
    let state = emptyLearn(); const first = makeExperimentRecord(template, results, 1);
    state = recordExperiment(state, first);
    for (let i = 2; i <= EXPERIMENT_HISTORY + 2; i++) state = recordExperiment(state, makeExperimentRecord(template, results, i));
    expect(state.experiments[template.id].length).toBe(EXPERIMENT_HISTORY);
    expect(state.experiments[template.id][0].at).toBe(3);
    expect(first.at).toBe(1);
  });
  it('persists across reloads, independently of challenge progress, and drops damaged records individually', () => {
    const storage = memory();
    const state = complete(emptyLearn(), lessonById('approach')!);
    expect(saveLearn(state, storage)).toBe(true);
    expect([...storage.data.keys()]).toEqual([LEARN_STORAGE_KEY]);
    const loaded = loadLearn(storage);
    expect(loaded.dropped).toEqual([]);
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(state));
    const raw = JSON.parse(storage.data.get(LEARN_STORAGE_KEY)!);
    raw.lessons.broken = { visited: ['nonsense'], startedAt: 1 };
    raw.experiments.x = [{ schema: 'other' }];
    storage.setItem(LEARN_STORAGE_KEY, JSON.stringify(raw));
    const partial = loadLearn(storage);
    expect(partial.state.lessons.approach).toBeDefined(); expect(partial.state.lessons.broken).toBeUndefined();
    expect(partial.dropped.length).toBe(2);
    storage.setItem(LEARN_STORAGE_KEY, '{not json'); expect(loadLearn(storage).state).toEqual(emptyLearn());
    storage.setItem(LEARN_STORAGE_KEY, JSON.stringify({ version: 9 })); expect(loadLearn(storage).dropped[0]).toMatch(/unsupported version/);
  });
  it('recommends the next lesson in order, resuming an unfinished one', () => {
    expect(nextLesson(emptyLearn())?.id).toBe('approach');
    const first = complete(emptyLearn(), lessonById('approach')!);
    expect(nextLesson(first)?.id).toBe('requirements');
    const resumed = visitSection(first, 'sync-async', 'concept', 5);
    expect(nextLesson(resumed)?.id).toBe('sync-async');
    expect(moduleProgress(first, MODULES[0])).toMatchObject({ written: 9, completed: 1 });
    expect(moduleProgress(first, MODULES[1]).status).toBe('planned');
  });
  it('recommends challenges after their lessons and links failed criteria to lessons', () => {
    const progress = emptyProgress();
    const before = recommendedChallenges(emptyLearn(), progress);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every(entry => !entry.ready)).toBe(true);
    const learnt = complete(emptyLearn(), lessonById('why-caching')!);
    expect(recommendedChallenges(learnt, progress).find(entry => entry.challenge.id === 'cache-it-right')).toMatchObject({ ready: true });
    const solved = { ...progress, challenges: { 'cache-it-right': { attempts: 1, solved: true } } };
    expect(recommendedChallenges(learnt, solved).some(entry => entry.challenge.id === 'cache-it-right')).toBe(false);
    for (const challenge of challenges) for (const criterion of challenge.criteria) for (const linked of lessonsForCriterion(challenge, criterion)) expect(LESSONS).toContain(linked);
    const cache = challengeById('cache-it-right')!;
    expect(lessonsForCriterion(cache, cache.criteria.find(criterion => criterion.id === 'db-load')!)[0].id).toBe('why-caching');
    expect(lessonsForChallenge('slow-api').map(entry => entry.id)).toContain('performance-metrics');
  });
});
