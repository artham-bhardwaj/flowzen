import type { ArchitectureSnapshot } from '../challenges/attempts';
import { STAGE_ALLOCATION, stagesOf, type HttpMethod, type InterviewDefinition, type StageId } from './types';

/**
 * An interview in progress: the session data model, creation, migration and plain updates. Drafts are editable and
 * autosaved; completing one produces an immutable record. Operations on a running session (stages, follow-ups,
 * checkpoints, requirement changes, timing) live in workflow.ts, which loads only with the Interview pages.
 */
export type Endpoint = { id: string; method: HttpMethod; path: string; request: string; response: string; auth: boolean; idempotent: boolean; paginated: boolean; errors: string; notes: string };
export type Entity = { id: string; name: string; fields: string; primaryKey: string; indexes: string; relationships: string; accessPatterns: string; consistency: string };
/** Measured evidence from an isolated benchmark or scenario run of the session's architecture. */
export type RunEvidence = {
  at: number; label: string;
  /** The architecture it was measured on; evidence for another architecture is not used. */
  architectureKey: string;
  complete: boolean; p95: number | null; successPct: number; errorRatePct: number; successThroughput: number;
  busiest: { label: string; utilization: number } | null;
  /** Requests (and jobs) processed per component id. */
  processed: Record<string, number>;
  failures: Array<{ label: string; kind: string; count: number }>;
};
export type FollowUpAnswer = {
  askedAt: number; answer: string; answeredAt?: number;
  /** When the user submitted the answer. Branching and practice references wait for submission. */
  submittedAt?: number;
  /** Why the question was asked, as shown when it was asked (kept for playback). */
  reason?: string; stage?: StageId;
};
export type Review = { architecture: string; decisions: string; bottlenecks: string; failures: string; limitations: string; tradeoffs: string };
/** The structured explanation of one design decision (one component). The short "why" note stays in `decisions`. */
export type DecisionExplanation = { problem: string; alternatives: string; tradeoffs: string; failure: string; evidence: string };
export const EMPTY_EXPLANATION: DecisionExplanation = { problem: '', alternatives: '', tradeoffs: '', failure: '', evidence: '' };
/** A saved copy of the architecture. Checkpoints are only ever added; restoring one first saves the current design. */
export type Checkpoint = {
  id: string; at: number; label: string;
  kind: 'manual' | 'auto' | 'change-before' | 'change-after' | 'restore';
  stage: StageId; architecture: ArchitectureSnapshot; decisions: Record<string, string>;
};
/** The user's response to one requirement change. */
export type ChangeResponse = {
  introducedAt: number;
  /** Checkpoint holding the architecture as it was when the change was introduced (the original design). */
  baselineId: string;
  /** Checkpoint holding the revised architecture, once saved. */
  revisionId?: string;
  answer: string; submittedAt?: number;
  /** Isolated runs of the change's scenario on the original and the revised architecture. */
  runs: { original?: RunEvidence; revised?: RunEvidence };
};
export type SessionEventType =
  | 'start' | 'stage' | 'clarification' | 'hint' | 'reference' | 'followup-asked' | 'followup-submitted' | 'checkpoint' | 'restore'
  | 'change-introduced' | 'change-revised' | 'change-submitted' | 'benchmark' | 'scenario' | 'expired';
/** One entry in the session timeline used for playback. `elapsedMs` is active interview time when it happened. */
export type SessionEvent = { at: number; elapsedMs: number; stage: StageId; type: SessionEventType; ref?: string; label: string };

export const SESSION_VERSION = 2;
export type InterviewSession = {
  schema: 'flowzen.interview-session'; version: 2;
  id: string; definitionId: string; definitionVersion: number;
  mode: 'practice' | 'mock';
  /** Mock interviews only: the configured total duration. */
  durationMin: number | null;
  /** Mock interviews only: the time plan per stage, fixed when the session starts. */
  plan: { durationMin: number; stageMs: Partial<Record<StageId, number>> } | null;
  /** Show pacing warnings (mock interviews; the user can turn them off). */
  pacing: boolean;
  /** Set once when a mock interview's time runs out. Nothing is locked; later work is recorded as overtime. */
  expired: { at: number; stage: StageId } | null;
  createdAt: number; updatedAt: number;
  /** Set when the session was started from a previous record (optionally from one of its checkpoints). */
  origin: { recordId: string; checkpointId?: string } | null;
  stage: StageId; completedStages: StageId[];
  timing: { totalMs: number; stageMs: Partial<Record<StageId, number>> };
  requirements: { functional: string; nonFunctional: string; scope: string; excluded: string };
  clarificationsAsked: string[];
  clarificationNotes: string;
  estimates: Record<string, string>;
  estimateNotes: string;
  endpoints: Endpoint[];
  entities: Entity[];
  architecture: ArchitectureSnapshot | null;
  /** Why each component was chosen, keyed by node id. */
  decisions: Record<string, string>;
  /** Structured explanations of major decisions, keyed by node id. */
  explanations: Record<string, DecisionExplanation>;
  designNotes: string;
  benchmark: RunEvidence | null;
  deepDives: Record<string, string>;
  followUps: Record<string, FollowUpAnswer>;
  scenarioRuns: Record<string, RunEvidence>;
  changes: Record<string, ChangeResponse>;
  checkpoints: Checkpoint[];
  review: Review;
  hintsUsed: Array<{ stage: StageId; index: number; at: number }>;
  /** Reference considerations viewed before submitting (stage ids or prompt ids). */
  referencesViewed: string[];
  events: SessionEvent[];
};

export const EMPTY_REVIEW: Review = { architecture: '', decisions: '', bottlenecks: '', failures: '', limitations: '', tradeoffs: '' };

/** The time plan per stage for a mock interview: the definition's shares, normalised over its stages, in whole minutes summing to the duration. */
export function planFor(definition: Pick<InterviewDefinition, 'changes' | 'stageAllocation'>, durationMin: number): Record<StageId, number> {
  const stages = stagesOf(definition);
  const shares = stages.map(stage => definition.stageAllocation?.[stage] ?? STAGE_ALLOCATION[stage]);
  const total = shares.reduce((a, b) => a + b, 0);
  const exact = shares.map(share => durationMin * share / total);
  const minutes = exact.map(Math.floor);
  // Largest remainder, so the plan always adds up to the chosen duration.
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  const missing = durationMin - minutes.reduce((a, b) => a + b, 0);
  for (let k = 0; k < missing; k++) minutes[order[k % order.length].i] += 1;
  return Object.fromEntries(stages.map((stage, i) => [stage, minutes[i]])) as Record<StageId, number>;
}

export function createSession(definition: InterviewDefinition, options: { id: string; at: number; mode: 'practice' | 'mock'; durationMin?: number; from?: { recordId: string; session: InterviewSession; checkpointId?: string } }): InterviewSession {
  const durationMin = options.mode === 'mock' ? Math.max(10, Math.min(180, Math.round(options.durationMin ?? definition.minutes))) : null;
  const base: InterviewSession = {
    schema: 'flowzen.interview-session', version: 2, id: options.id, definitionId: definition.id, definitionVersion: definition.version,
    mode: options.mode, durationMin,
    plan: durationMin === null ? null : { durationMin, stageMs: Object.fromEntries(Object.entries(planFor(definition, durationMin)).map(([stage, min]) => [stage, min * 60_000])) },
    pacing: options.mode === 'mock', expired: null,
    createdAt: options.at, updatedAt: options.at, origin: null, stage: 'requirements', completedStages: [], timing: { totalMs: 0, stageMs: {} },
    requirements: { functional: '', nonFunctional: '', scope: '', excluded: '' }, clarificationsAsked: [], clarificationNotes: '',
    estimates: {}, estimateNotes: '', endpoints: [], entities: [], architecture: null, decisions: {}, explanations: {}, designNotes: '', benchmark: null,
    deepDives: {}, followUps: {}, scenarioRuns: {}, changes: {}, checkpoints: [], review: { ...EMPTY_REVIEW }, hintsUsed: [], referencesViewed: [],
    events: [{ at: options.at, elapsedMs: 0, stage: 'requirements', type: 'start', label: `${options.mode === 'mock' ? `Mock interview (${durationMin} min)` : 'Practice interview'} started` }],
  };
  if (!options.from) return base;
  // A new editable session from a previous one: answers and architecture are copied; evidence, timing, help usage,
  // checkpoints and requirement changes start fresh. Starting from a checkpoint uses that checkpoint's architecture.
  const previous = structuredClone(options.from.session);
  const checkpoint = options.from.checkpointId ? previous.checkpoints.find(entry => entry.id === options.from!.checkpointId) : undefined;
  return {
    ...base, origin: { recordId: options.from.recordId, ...(checkpoint ? { checkpointId: checkpoint.id } : {}) },
    requirements: previous.requirements, clarificationsAsked: previous.clarificationsAsked, clarificationNotes: previous.clarificationNotes,
    estimates: previous.estimates, estimateNotes: previous.estimateNotes, endpoints: previous.endpoints, entities: previous.entities,
    architecture: checkpoint ? checkpoint.architecture : previous.architecture, decisions: checkpoint ? checkpoint.decisions : previous.decisions,
    explanations: previous.explanations, designNotes: previous.designNotes, deepDives: previous.deepDives,
    followUps: Object.fromEntries(Object.entries(previous.followUps).filter(([, entry]) => entry.answer.trim()).map(([id, entry]) => [id, { askedAt: options.at, answer: entry.answer, answeredAt: options.at }])),
    review: previous.review,
    events: [{ ...base.events[0], label: `${base.events[0].label} from an earlier interview${checkpoint ? ` (checkpoint “${checkpoint.label}”)` : ''}` }],
  };
}

/**
 * Brings a stored session up to the current version. Version 1 sessions keep every field they had; the fields added
 * in version 2 get empty defaults (answered follow-ups count as submitted). Nothing is reinterpreted or dropped.
 */
export type SessionV1 = Omit<InterviewSession, 'version' | 'plan' | 'pacing' | 'expired' | 'explanations' | 'checkpoints' | 'changes' | 'events'> & { version: 1 };
export function migrateSession(value: InterviewSession | SessionV1): InterviewSession {
  if (value.version === 2) return value;
  const v1 = value as unknown as Omit<InterviewSession, 'version'> & Partial<InterviewSession>;
  return {
    ...v1, version: 2,
    plan: v1.plan ?? null, pacing: v1.pacing ?? false, expired: v1.expired ?? null,
    explanations: v1.explanations ?? {}, checkpoints: v1.checkpoints ?? [], changes: v1.changes ?? {}, events: v1.events ?? [],
    followUps: Object.fromEntries(Object.entries(v1.followUps).map(([id, entry]) => [id, entry.answeredAt && entry.submittedAt === undefined ? { ...entry, submittedAt: entry.answeredAt } : entry])),
  };
}

/** Applies an edit; every change goes through here so `updatedAt` is kept. */
export const update = (session: InterviewSession, patch: Partial<InterviewSession>, at: number): InterviewSession => ({ ...session, ...patch, updatedAt: at });

/** Identifies an architecture's simulation-relevant content (positions and names do not count). */
export const architectureKey = (architecture: ArchitectureSnapshot | null) => architecture ? JSON.stringify([architecture.nodes.map(node => [node.id, node.kind, node.config]).sort(), architecture.edges.map(edge => `${edge.source}>${edge.target}`).sort()]) : '';
