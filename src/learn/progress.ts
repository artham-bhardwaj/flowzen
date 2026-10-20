import { deepFreeze } from '../challenges/grading';
import { challengeById, challenges as allChallenges, type Challenge, type Criterion } from '../challenges/definitions';
import type { Progress as ChallengeProgress } from '../challenges/progress';
import { LESSONS, MODULES, lessonById } from './curriculum';
import { experimentById, type ExperimentRecord } from './experiments';
import type { QuizAnswers, QuizResult } from './evaluate';
import { READING_SECTIONS, isLesson, type Lesson, type Module, type SectionId } from './types';

/**
 * Learning progress, stored locally under its own key (`flowzen-learn-v1`), separate from challenge progress
 * and the Playground. Lessons can be revisited and checks retaken without losing earlier results: the best
 * check result is kept, and the last few runs of each experiment are kept as immutable records.
 */
export const LEARN_STORAGE_KEY = 'flowzen-learn-v1';
export const EXPERIMENT_HISTORY = 5;

export type QuizRecord = { at: number; score: number; total: number; percent: number; passed: boolean; answers: QuizAnswers };
export type LessonProgress = {
  visited: SectionId[]; startedAt: number;
  /** Set once every reading section (concept, why, alternatives, design) has been opened. */
  readAt?: number;
  quiz?: { attempts: number; best: QuizRecord; last: QuizRecord };
  /** Practical tasks passed, by task id. */
  tasks?: Record<string, { completedAt: number }>;
};
export type LearnState = {
  version: 1;
  lessons: Record<string, LessonProgress>;
  /** Recent complete runs per experiment template, oldest first. */
  experiments: Record<string, ExperimentRecord[]>;
  lastLessonId: string | null;
};
export const emptyLearn = (): LearnState => ({ version: 1, lessons: {}, experiments: {}, lastLessonId: null });

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = () => typeof localStorage === 'undefined' ? undefined : localStorage;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const SECTIONS = new Set<SectionId>(['concept', 'why', 'alternatives', 'design', 'experiment', 'check', 'exercise']);

function quizRecordOk(value: unknown): value is QuizRecord {
  return isObject(value) && isNumber(value.at) && isNumber(value.score) && isNumber(value.total) && isNumber(value.percent) && typeof value.passed === 'boolean' && isObject(value.answers);
}
function lessonProblem(value: unknown): string | null {
  if (!isObject(value) || !Array.isArray(value.visited) || !isNumber(value.startedAt)) return 'malformed';
  if (!value.visited.every(section => SECTIONS.has(section as SectionId))) return 'unknown section';
  if (value.readAt !== undefined && !isNumber(value.readAt)) return 'malformed read time';
  if (value.quiz !== undefined && !(isObject(value.quiz) && isNumber(value.quiz.attempts) && quizRecordOk(value.quiz.best) && quizRecordOk(value.quiz.last))) return 'malformed check result';
  if (value.tasks !== undefined && !(isObject(value.tasks) && Object.values(value.tasks).every(task => isObject(task) && isNumber(task.completedAt)))) return 'malformed tasks';
  return null;
}
function experimentProblem(value: unknown): string | null {
  if (!isObject(value) || value.schema !== 'flowzen.learn-experiment') return 'unknown format';
  if (value.version !== 1) return `unsupported version ${String(value.version)}`;
  if (typeof value.experimentId !== 'string' || !isNumber(value.at) || !Array.isArray(value.variants) || !isObject(value.conclusion)) return 'malformed';
  return null;
}

/** Loads learning progress. Damaged or unknown records are dropped individually and listed; the rest load. */
export function loadLearn(storage: StorageLike | undefined = defaultStorage()): { state: LearnState; dropped: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(storage?.getItem(LEARN_STORAGE_KEY) ?? 'null'); } catch { return { state: emptyLearn(), dropped: ['The saved learning progress could not be read.'] }; }
  if (raw === null) return { state: emptyLearn(), dropped: [] };
  if (!isObject(raw) || raw.version !== 1) return { state: emptyLearn(), dropped: ['The saved learning progress has an unsupported version.'] };
  const state = emptyLearn(); const dropped: string[] = [];
  if (isObject(raw.lessons)) for (const [id, entry] of Object.entries(raw.lessons)) {
    const problem = lessonProblem(entry);
    if (problem) dropped.push(`lesson “${id}”: ${problem}`); else state.lessons[id] = deepFreeze(entry as LessonProgress);
  }
  if (isObject(raw.experiments)) for (const [id, list] of Object.entries(raw.experiments)) {
    if (!Array.isArray(list)) { dropped.push(`experiment “${id}”: malformed`); continue; }
    const kept = list.filter(record => { const problem = experimentProblem(record); if (problem) dropped.push(`a run of experiment “${id}”: ${problem}`); return !problem; });
    if (kept.length) state.experiments[id] = kept.map(record => deepFreeze(record as ExperimentRecord));
  }
  state.lastLessonId = typeof raw.lastLessonId === 'string' ? raw.lastLessonId : null;
  return { state, dropped };
}
export function saveLearn(state: LearnState, storage: StorageLike | undefined = defaultStorage()): boolean {
  try { storage?.setItem(LEARN_STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

// ── Transitions (each returns a new state; stored records are frozen) ──────────
const lessonEntry = (state: LearnState, id: string, at: number): LessonProgress => state.lessons[id] ?? { visited: [], startedAt: at };
const withLesson = (state: LearnState, id: string, entry: LessonProgress): LearnState => ({ ...state, lessons: { ...state.lessons, [id]: deepFreeze(entry) }, lastLessonId: id });

export function visitSection(state: LearnState, lessonId: string, section: SectionId, at: number): LearnState {
  const entry = lessonEntry(state, lessonId, at);
  if (entry.visited.includes(section) && state.lastLessonId === lessonId) return state;
  const visited = entry.visited.includes(section) ? entry.visited : [...entry.visited, section];
  const read = READING_SECTIONS.every(id => visited.includes(id));
  return withLesson(state, lessonId, { ...entry, visited, ...(read && !entry.readAt ? { readAt: at } : {}) });
}
export function recordQuiz(state: LearnState, lessonId: string, result: QuizResult, answers: QuizAnswers, at: number): LearnState {
  const entry = lessonEntry(state, lessonId, at);
  const record: QuizRecord = { at, score: result.score, total: result.total, percent: result.percent, passed: result.passed, answers: structuredClone(answers) };
  const best = !entry.quiz || record.percent > entry.quiz.best.percent ? record : entry.quiz.best;
  return withLesson(state, lessonId, { ...entry, quiz: { attempts: (entry.quiz?.attempts ?? 0) + 1, best, last: record } });
}
/** Marks a practical task passed. Passing again keeps the first completion time. */
export function recordTask(state: LearnState, lessonId: string, taskId: string, at: number): LearnState {
  const entry = lessonEntry(state, lessonId, at);
  if (entry.tasks?.[taskId]) return state;
  return withLesson(state, lessonId, { ...entry, tasks: { ...entry.tasks, [taskId]: { completedAt: at } } });
}
/** Keeps the newest EXPERIMENT_HISTORY runs of each experiment; earlier records are dropped whole, never edited. */
export function recordExperiment(state: LearnState, record: ExperimentRecord): LearnState {
  const list = [...(state.experiments[record.experimentId] ?? []), deepFreeze(record)].slice(-EXPERIMENT_HISTORY);
  return { ...state, experiments: { ...state.experiments, [record.experimentId]: list } };
}

// ── Derived progress ────────────────────────────────────────────────────────────
export type Requirement = { id: 'read' | 'check' | 'experiment' | 'exercise'; label: string; done: boolean };
/** A run counts as an experiment completed when every controlled variant was measured completely. */
export const experimentCompleted = (state: LearnState, experimentId: string) => {
  const template = experimentById(experimentId);
  return (state.experiments[experimentId] ?? []).some(record => template?.variants.every(variant => record.variants.find(entry => entry.id === variant.id)?.complete) ?? false);
};
/** The lesson's completion criteria. A challenge submission is never one of them. */
export function requirements(state: LearnState, lesson: Lesson): Requirement[] {
  const entry = state.lessons[lesson.id];
  const tasks = lesson.exercise?.tasks ?? [];
  return [
    { id: 'read', label: 'Read the lesson', done: Boolean(entry?.readAt) },
    { id: 'check', label: 'Pass the knowledge check', done: Boolean(entry?.quiz?.best.passed) },
    ...(lesson.experiment ? [{ id: 'experiment' as const, label: 'Run the experiment', done: experimentCompleted(state, lesson.experiment) }] : []),
    ...(tasks.length ? [{ id: 'exercise' as const, label: 'Complete the practical exercise', done: tasks.every(task => entry?.tasks?.[task.id]) }] : []),
  ];
}
export type LessonStatus = 'not-started' | 'in-progress' | 'completed';
export function lessonStatus(state: LearnState, lesson: Lesson): LessonStatus {
  const reqs = requirements(state, lesson);
  if (reqs.every(req => req.done)) return 'completed';
  return state.lessons[lesson.id] || reqs.some(req => req.done) ? 'in-progress' : 'not-started';
}
export function moduleProgress(state: LearnState, module: Module) {
  const written = module.lessons.filter(isLesson);
  const completed = written.filter(lesson => lessonStatus(state, lesson) === 'completed').length;
  const started = written.filter(lesson => lessonStatus(state, lesson) !== 'not-started').length;
  return { written: written.length, planned: module.lessons.length - written.length, completed, started, status: (!written.length ? 'planned' : completed === written.length ? 'completed' : started ? 'in-progress' : 'not-started') as LessonStatus | 'planned' };
}
export function trackProgress(state: LearnState) {
  const completed = LESSONS.filter(lesson => lessonStatus(state, lesson) === 'completed').length;
  const checks = LESSONS.filter(lesson => state.lessons[lesson.id]?.quiz).map(lesson => ({ lesson, quiz: state.lessons[lesson.id].quiz! }));
  const experiments = [...new Set(LESSONS.flatMap(lesson => lesson.experiment ? [lesson.experiment] : []))];
  return { completed, total: LESSONS.length, checks, experimentsDone: experiments.filter(id => experimentCompleted(state, id)).length, experimentsTotal: experiments.length };
}
/** The lesson the user was last working on if unfinished, otherwise the first unfinished lesson in order. */
export function nextLesson(state: LearnState): Lesson | null {
  const last = state.lastLessonId ? lessonById(state.lastLessonId) : undefined;
  if (last && lessonStatus(state, last) !== 'completed') return last;
  return LESSONS.find(lesson => lessonStatus(state, lesson) !== 'completed') ?? null;
}

// ── Challenge links ─────────────────────────────────────────────────────────────
/** Written lessons whose ideas a challenge tests. */
export const lessonsForChallenge = (challengeId: string): Lesson[] => LESSONS.filter(lesson => lesson.challenges.includes(challengeId));
/** Lessons that explain what a criterion measures, preferring lessons linked to the challenge. */
const BY_METRIC: Record<Criterion['metric']['kind'], string[]> = {
  latency: ['performance-metrics', 'bottlenecks'], successThroughput: ['performance-metrics', 'bottlenecks'], errorRate: ['performance-metrics', 'bottlenecks'],
  deadComponents: ['approach'], fixturesIntact: [], computeSlots: ['capacity-estimation', 'horizontal-vertical'],
  loadShare: ['why-caching', 'bottlenecks'], maxQueue: ['sync-async', 'bottlenecks'], utilization: ['bottlenecks', 'why-caching'],
  failureShareAt: ['bottlenecks'], processedBy: ['sync-async'], unsupported: [],
};
export function lessonsForCriterion(challenge: Challenge, criterion: Pick<Criterion, 'metric'>): Lesson[] {
  const linked = new Set(lessonsForChallenge(challenge.id).map(lesson => lesson.id));
  const ids = BY_METRIC[criterion.metric.kind] ?? [];
  const ordered = [...ids.filter(id => linked.has(id)), ...ids.filter(id => !linked.has(id))];
  return ordered.map(id => lessonById(id)).filter((lesson): lesson is Lesson => Boolean(lesson)).slice(0, 2);
}
export type ChallengeRecommendation = { challenge: Challenge; after: Lesson[]; ready: boolean };
/**
 * Optional practice: unsolved challenges linked to lessons. A challenge is "ready" once every written lesson that
 * prepares for it is complete. Recommendations never gate anything; challenges stay open to everyone.
 */
export function recommendedChallenges(state: LearnState, progress: ChallengeProgress, list: Challenge[] = allChallenges): ChallengeRecommendation[] {
  return list.flatMap(challenge => {
    const after = lessonsForChallenge(challenge.id);
    if (!after.length || progress.challenges[challenge.id]?.solved) return [];
    return [{ challenge, after, ready: after.every(lesson => lessonStatus(state, lesson) === 'completed') }];
  }).sort((a, b) => Number(b.ready) - Number(a.ready) || a.challenge.number - b.challenge.number);
}
export const challengeTitle = (id: string) => challengeById(id)?.title ?? id;
export { MODULES };
