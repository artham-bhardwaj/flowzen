import { deepFreeze } from '../challenges/grading';
import { validateArchitectureSnapshot } from '../challenges/attempts';
import type { Correction, Evaluation } from './evaluate';
import { migrateSession, type InterviewSession, type SessionV1 } from './session';
import type { Benchmark, RequirementChange } from './types';

/**
 * Local interview history (`flowzen-interviews-v1` holds state version 2), separate from challenges, the lab,
 * learning progress and targeted practice (drills.ts, its own key).
 *
 * Drafts are editable and autosaved. Completing a draft evaluates it and stores an immutable, deep-frozen record
 * holding the definition version, the answers, every architecture checkpoint, the follow-up history with the reasons
 * questions were asked, the session timeline, time per stage, help used, the rubric (evaluator) version, the
 * reference version, the benchmark settings and every measured run, and the evaluation with its evidence.
 * Corrections are appended separately and never edit a record.
 *
 * Loading is per entry: a version 1 draft or record is migrated in memory (new fields get empty defaults; nothing is
 * reinterpreted). An entry that is damaged, or was written by a newer version of Flowzen, is kept verbatim in
 * `unreadable` and saved back unchanged, so it is never silently destroyed; the user can choose to remove it.
 */
export const INTERVIEW_STORAGE_KEY = 'flowzen-interviews-v1';
export const STATE_VERSION = 2;
export const MAX_RECORDS = 100;

export type InterviewRecord = {
  schema: 'flowzen.interview-record';
  /** 1: made before the upgrade (no checkpoints, changes or reasoning rubric); 2: current. */
  version: 1 | 2;
  id: string; completedAt: number;
  definitionId: string; definitionVersion: number; title: string;
  /** The rubric version used to grade it. */
  evaluatorVersion: number;
  /** The reference solution version it is compared with (version 2 records). */
  referenceVersion?: number;
  /** How the session ended: submitted normally, or finished early in a mock interview. */
  finishedEarly: boolean;
  session: InterviewSession;
  evaluation: Evaluation;
  /** The benchmark settings the measurements were taken with (version 2 records). */
  benchmark?: Benchmark;
  /** The requirement changes as defined when the interview was taken (version 2 records). */
  changes?: RequirementChange[];
};
export type InterviewState = {
  version: 2; drafts: InterviewSession[]; records: InterviewRecord[]; corrections: Record<string, Correction[]>;
  /** Entries that could not be read, kept verbatim with the reason. */
  unreadable: Array<{ kind: 'draft' | 'record'; reason: string; raw: unknown }>;
};
export const emptyInterviews = (): InterviewState => ({ version: 2, drafts: [], records: [], corrections: {}, unreadable: [] });

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = () => typeof localStorage === 'undefined' ? undefined : localStorage;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function sessionProblem(value: unknown): string | null {
  if (!isObject(value) || value.schema !== 'flowzen.interview-session') return 'unknown format';
  if (value.version !== 1 && value.version !== 2) return `made by a newer version of Flowzen (session version ${String(value.version)})`;
  if (typeof value.id !== 'string' || typeof value.definitionId !== 'string' || !isNumber(value.definitionVersion) || !isNumber(value.createdAt)) return 'missing identity';
  if (value.mode !== 'practice' && value.mode !== 'mock') return 'unknown mode';
  if (!isObject(value.requirements) || !isObject(value.estimates) || !Array.isArray(value.endpoints) || !Array.isArray(value.entities) || !isObject(value.followUps) || !isObject(value.review) || !isObject(value.timing)) return 'missing answers';
  if (value.architecture !== null && validateArchitectureSnapshot(value.architecture)) return `architecture: ${validateArchitectureSnapshot(value.architecture)}`;
  if (value.version === 2) {
    if (!Array.isArray(value.checkpoints) || !isObject(value.changes) || !Array.isArray(value.events) || !isObject(value.explanations)) return 'missing version 2 fields';
    for (const checkpoint of value.checkpoints) { if (!isObject(checkpoint) || typeof checkpoint.id !== 'string') return 'damaged checkpoint'; const problem = validateArchitectureSnapshot(checkpoint.architecture); if (problem) return `checkpoint architecture: ${problem}`; }
  }
  return null;
}
export function recordProblem(value: unknown): string | null {
  if (!isObject(value) || value.schema !== 'flowzen.interview-record') return 'unknown format';
  if (value.version !== 1 && value.version !== 2) return `made by a newer version of Flowzen (record version ${String(value.version)})`;
  if (typeof value.id !== 'string' || !isNumber(value.completedAt) || typeof value.definitionId !== 'string') return 'missing identity';
  const session = sessionProblem(value.session); if (session) return `session: ${session}`;
  if (!isObject(value.evaluation) || !Array.isArray(value.evaluation.criteria) || !isObject(value.evaluation.overall)) return 'missing evaluation';
  return null;
}

/** Loads history. Each draft and record is checked on its own; unusable ones are kept aside and listed, never repaired. */
export function loadInterviews(storage: StorageLike | undefined = defaultStorage()): { state: InterviewState; dropped: string[] } {
  let raw: unknown;
  try { raw = JSON.parse(storage?.getItem(INTERVIEW_STORAGE_KEY) ?? 'null'); } catch { return { state: emptyInterviews(), dropped: ['The saved interview history could not be read.'] }; }
  if (raw === null) return { state: emptyInterviews(), dropped: [] };
  if (!isObject(raw) || (raw.version !== 1 && raw.version !== 2)) return { state: { ...emptyInterviews(), unreadable: [{ kind: 'record', reason: 'the whole history was written by a newer version of Flowzen', raw }] }, dropped: ['The saved interview history was written by a newer version of Flowzen. It is kept unchanged and not shown.'] };
  const state = emptyInterviews(); const dropped: string[] = [];
  if (Array.isArray(raw.unreadable)) state.unreadable.push(...raw.unreadable.filter(isObject).map(entry => entry as InterviewState['unreadable'][number]));
  for (const draft of Array.isArray(raw.drafts) ? raw.drafts : []) {
    const problem = sessionProblem(draft);
    if (problem) { dropped.push(`an unfinished session: ${problem}`); state.unreadable.push({ kind: 'draft', reason: problem, raw: draft }); }
    else state.drafts.push(migrateSession(draft as InterviewSession | SessionV1));
  }
  for (const record of Array.isArray(raw.records) ? raw.records : []) {
    const problem = recordProblem(record);
    if (problem) { dropped.push(`a completed interview: ${problem}`); state.unreadable.push({ kind: 'record', reason: problem, raw: record }); continue; }
    const entry = record as InterviewRecord;
    state.records.push(deepFreeze({ ...entry, session: migrateSession(entry.session as InterviewSession | SessionV1) }));
  }
  if (isObject(raw.corrections)) for (const [id, list] of Object.entries(raw.corrections)) if (Array.isArray(list)) state.corrections[id] = list.filter((entry): entry is Correction => isObject(entry) && typeof entry.criterionId === 'string' && isNumber(entry.at));
  return { state, dropped };
}
export function saveInterviews(state: InterviewState, storage: StorageLike | undefined = defaultStorage()): boolean {
  try { storage?.setItem(INTERVIEW_STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

// ── Transitions (pure; records are never edited) ───────────────────────────────
export const putDraft = (state: InterviewState, session: InterviewSession): InterviewState => ({ ...state, drafts: [...state.drafts.filter(draft => draft.id !== session.id), session] });
export const discardDraft = (state: InterviewState, id: string): InterviewState => ({ ...state, drafts: state.drafts.filter(draft => draft.id !== id) });
/** Stores a completed record (built by `buildRecord` in record.ts) and removes its draft. Records are never replaced. */
export function addRecord(state: InterviewState, record: InterviewRecord): InterviewState {
  if (state.records.some(entry => entry.id === record.id)) return state;
  return { ...state, drafts: state.drafts.filter(draft => draft.id !== record.session.id), records: [...state.records, deepFreeze(record)].slice(-MAX_RECORDS) };
}
/** Appends a correction for a record's criterion; the record itself is untouched. */
export function addCorrection(state: InterviewState, recordId: string, correction: Correction): InterviewState {
  if (!state.records.some(record => record.id === recordId)) return state;
  return { ...state, corrections: { ...state.corrections, [recordId]: [...(state.corrections[recordId] ?? []), correction] } };
}
/** Removes unreadable entries, only when the user asks. */
export const purgeUnreadable = (state: InterviewState): InterviewState => ({ ...state, unreadable: [] });
