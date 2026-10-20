import { deepFreeze } from '../challenges/grading';
import { EVALUATOR_VERSION, evaluate } from './evaluate';
import { referenceVersion } from './references';
import type { InterviewSession } from './session';
import { addRecord, type InterviewRecord, type InterviewState } from './store';
import type { InterviewDefinition } from './types';

/**
 * Evaluates a draft and builds its immutable record: the definition and reference versions, a copy of the answers,
 * checkpoints, follow-up history and timeline, the benchmark settings and requirement changes as defined at the time,
 * the evaluator (rubric) version and the evaluation with its evidence. Kept apart from the store so the evaluator
 * loads only with the Interview pages.
 */
export function buildRecord(definition: InterviewDefinition, session: InterviewSession, params: { recordId: string; at: number; finishedEarly: boolean }): InterviewRecord {
  const snapshot = structuredClone(session);
  return deepFreeze({
    schema: 'flowzen.interview-record' as const, version: 2 as const, id: params.recordId, completedAt: params.at,
    definitionId: definition.id, definitionVersion: definition.version, title: definition.title, evaluatorVersion: EVALUATOR_VERSION,
    referenceVersion: referenceVersion(definition), finishedEarly: params.finishedEarly, session: snapshot,
    evaluation: structuredClone(evaluate(definition, snapshot)),
    benchmark: structuredClone(definition.benchmark), changes: structuredClone(definition.changes ?? []),
  });
}
/** Evaluates and stores a draft in one step (the draft is removed). */
export function completeSession(state: InterviewState, definition: InterviewDefinition, session: InterviewSession, params: { recordId: string; at: number; finishedEarly: boolean }): { state: InterviewState; record: InterviewRecord } {
  const record = buildRecord(definition, session, params);
  return { state: addRecord(state, record), record };
}
