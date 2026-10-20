import { DIFFICULTIES, DIFFICULTY_POINTS, challenges as allChallenges, type Challenge } from './definitions';
import { deepFreeze, type Grade } from './grading';
import type { AttemptRecord } from './attempts';

export type AttemptSummary = {
  /** 1-based attempt number within the challenge (absent on attempts saved before numbering existed). */
  number?: number;
  at: number; passed: boolean; criteriaPassed: number; criteriaTotal: number;
  criteria: Array<{ id: string; status: string; measured: number | null }>;
  p50: number | null; p95: number | null; p99: number | null; successThroughput: number | null; errorRate: number | null;
};
export type ChallengeProgress = {
  attempts: number; solved: boolean; solvedAt?: number; best?: AttemptSummary; last?: AttemptSummary; previous?: AttemptSummary;
  /**
   * Submitted attempts, oldest first, capped at HISTORY_SIZE. Entries are frozen and never edited.
   * `record` holds the full, versioned attempt record (architecture snapshot, benchmark, criteria, grade);
   * it is absent for attempts saved before records existed and must be read with `parseAttemptRecord`.
   */
  history?: HistoryEntry[];
};
export type HistoryEntry = AttemptSummary & { record?: unknown };
export const HISTORY_SIZE = 20;
export type DraftNode = { id: string; kind: string; label: string; config: Record<string, string>; position: { x: number; y: number } };
export type Draft = { nodes: DraftNode[]; edges: Array<{ source: string; target: string }> };
export type Progress = { version: 1; challenges: Record<string, ChallengeProgress>; drafts: Record<string, Draft> };
export type ChallengeStatus = 'solved' | 'attempted' | 'new' | 'locked';

export const STORAGE_KEY = 'flowzen-challenges-v1';
export const emptyProgress = (): Progress => ({ version: 1, challenges: {}, drafts: {} });
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Reads saved progress; anything unreadable or of another version starts fresh rather than failing. */
export function loadProgress(storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): Progress {
  try {
    const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || parsed.version !== 1 || typeof parsed.challenges !== 'object' || typeof parsed.drafts !== 'object') return emptyProgress();
    // Recorded attempts are read-only once loaded; drafts stay editable.
    return { version: 1, challenges: deepFreeze(parsed.challenges ?? {}), drafts: parsed.drafts ?? {} };
  } catch { return emptyProgress(); }
}
export function saveProgress(progress: Progress, storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(progress)); return true; } catch { return false; }
}

export function summarize(grade: Grade, at: number, number?: number): AttemptSummary {
  const mandatory = grade.criteria.filter(entry => entry.mandatory);
  return deepFreeze({
    ...(number !== undefined ? { number } : {}), at, passed: grade.passed, criteriaPassed: mandatory.filter(entry => entry.status === 'pass').length, criteriaTotal: mandatory.length,
    criteria: grade.criteria.map(entry => ({ id: entry.id, status: entry.status, measured: entry.measured })),
    p50: grade.summary?.p50 ?? null, p95: grade.summary?.p95 ?? null, p99: grade.summary?.p99 ?? null,
    successThroughput: grade.summary?.successThroughput ?? null, errorRate: grade.summary?.errorRate ?? null,
  });
}
/** Passing beats failing; then more criteria met; then lower p95. */
const better = (a: AttemptSummary, b: AttemptSummary | undefined) => !b || (a.passed !== b.passed ? a.passed : a.criteriaPassed !== b.criteriaPassed ? a.criteriaPassed > b.criteriaPassed : (a.p95 ?? Infinity) < (b.p95 ?? Infinity));

/**
 * Records a graded submission. A failed attempt never marks a challenge solved, and a solve is never revoked.
 * `makeRecord` builds the full attempt record for the attempt number assigned here.
 */
export function recordAttempt(progress: Progress, grade: Grade, at: number, makeRecord?: (number: number) => AttemptRecord): Progress {
  const current = progress.challenges[grade.challengeId] ?? { attempts: 0, solved: false };
  const number = current.attempts + 1;
  const attempt = summarize(grade, at, number);
  const entry: HistoryEntry = makeRecord ? { ...attempt, record: makeRecord(number) } : attempt;
  const next: ChallengeProgress = {
    attempts: current.attempts + 1, solved: current.solved || grade.passed, solvedAt: current.solvedAt ?? (grade.passed ? at : undefined),
    best: better(attempt, current.best) ? attempt : current.best, last: attempt, previous: current.last,
    history: [...(current.history ?? []), entry].slice(-HISTORY_SIZE),
  };
  return { ...progress, challenges: { ...progress.challenges, [grade.challengeId]: deepFreeze(next) } };
}
export const saveDraft = (progress: Progress, challengeId: string, draft: Draft): Progress => ({ ...progress, drafts: { ...progress.drafts, [challengeId]: draft } });
export const clearDraft = (progress: Progress, challengeId: string): Progress => { const drafts = { ...progress.drafts }; delete drafts[challengeId]; return { ...progress, drafts }; };

/** Easy challenges are open; each later tier opens once any challenge in the tier before it is solved. */
export function isUnlocked(progress: Progress, challenge: Challenge, list: Challenge[] = allChallenges) {
  const tier = DIFFICULTIES.indexOf(challenge.difficulty);
  if (tier <= 0) return true;
  return list.some(other => DIFFICULTIES.indexOf(other.difficulty) === tier - 1 && progress.challenges[other.id]?.solved);
}
export function statusOf(progress: Progress, challenge: Challenge, list: Challenge[] = allChallenges): ChallengeStatus {
  const entry = progress.challenges[challenge.id];
  if (entry?.solved) return 'solved';
  if (!isUnlocked(progress, challenge, list)) return 'locked';
  return entry?.attempts ? 'attempted' : 'new';
}
/** Points are awarded once per solved challenge, by difficulty. */
export const pointsFor = (progress: Progress, list: Challenge[] = allChallenges) => list.reduce((sum, challenge) => sum + (progress.challenges[challenge.id]?.solved ? DIFFICULTY_POINTS[challenge.difficulty] : 0), 0);
