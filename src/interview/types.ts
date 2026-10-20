import type { Kind } from '../app/catalog';
import type { Diagram } from '../learn/types';

/**
 * Interview definitions: structured data that drives the workflow, the follow-up engine and the deterministic
 * evaluation. Nothing here is executed; formulas and triggers are data, so definitions can be validated and stored.
 */

export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';
export type Category = 'api' | 'caching' | 'storage' | 'messaging' | 'scalability' | 'reliability' | 'distributed' | 'observability' | 'complete';
export type CompetencyId =
  | 'clarification' | 'estimation' | 'api' | 'data-model' | 'architecture'
  | 'scalability' | 'reliability' | 'consistency' | 'tradeoffs' | 'communication';
export type StageId = 'requirements' | 'estimation' | 'api' | 'data' | 'design' | 'deepdive' | 'followups' | 'changes' | 'review';

/**
 * A concept recognised in free text. Each entry of `any` is a case-insensitive phrase matched at word starts
 * (so "cache" also matches "caches" and "caching"); an entry wrapped in slashes is a regular expression.
 */
export type Concept = { id: string; label: string; any: string[] };
/** Phrases that state something wrong for this problem. A match caps the score and is explained. */
export type Contradiction = { id: string; label: string; any: string[]; explanation: string };

/** A link into the rest of Flowzen. */
export type Resource =
  | { type: 'lesson'; id: string }
  | { type: 'component'; kind: Kind }
  | { type: 'lld'; kind: Kind }
  | { type: 'experiment'; id: string }
  | { type: 'interview'; id: string };

export type RequirementExpectation = { id: string; kind: 'functional' | 'non-functional'; label: string; any: string[]; critical: boolean; why: string };
export type Clarification = { id: string; question: string; answer: string; important: boolean };

/** `product` and `divide` hold quantity ids or numbers: value = Π product ÷ Π divide, computed from the user's own inputs. */
export type Formula = { product: Array<string | number>; divide?: Array<string | number> };
export type EstimateQuantity = {
  id: string; label: string; unit: string;
  /** Assumptions are inputs; derived quantities are checked for consistency with the user's own assumptions. */
  role: 'assumption' | 'derived';
  reference: number;
  /** Accepted ratio either side of the reference (order of magnitude, not equality). Documented in the UI. */
  factor: number;
  formula?: Formula;
  /** Why the quantity matters for the design. */
  why: string;
  working: string[];
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ApiConsideration = {
  id: string; label: string; why: string;
  check: { flag: 'auth' | 'idempotent' | 'paginated' } | { text: 'request' | 'response' | 'errors' | 'any'; any: string[] };
};
export type ApiOperation = {
  id: string; purpose: string; required: boolean;
  methods: HttpMethod[];
  /** Words that identify the operation in the endpoint path or notes. */
  any: string[];
  considerations: ApiConsideration[];
};

export type EntityExpectation = { id: string; label: string; names: string[]; fields: Concept[]; required: boolean };
export type ModelConcern = { id: string; label: string; any: string[]; competency: 'data-model' | 'consistency'; why: string };

export type ArchitectureRole = {
  id: string; label: string;
  /** Requirement ids this role serves (used by the whiteboard review to trace requirements to components). */
  covers?: string[];
  /** Any of these kinds fulfils the role (documented alternatives). */
  kinds: Kind[];
  required: boolean;
  why: string;
  /** Concepts the user's decision note for the component should cover to earn full credit. */
  explain: Concept[];
};
export type Benchmark = {
  rps: number; durationMs: number; drainMs: number; seed: number;
  overrides: Array<{ kinds: Kind[]; config: Record<string, string>; reason: string }>;
  targets: { p95Ms: number; minSuccessPct: number };
  description: string;
};

/** A curated discussion topic answered in free text and checked against required concepts. */
export type Prompt = {
  id: string; title: string; question: string; competency: CompetencyId;
  concepts: Concept[]; contradictions?: Contradiction[];
  reference: string[]; mistakes: string[]; resources: Resource[];
};
/**
 * When a follow-up applies. Triggers are data: the engine (adaptive.ts) evaluates them against the session, and the
 * rule that fired is recorded with the question so the user can see why it was asked.
 */
export type Trigger =
  | { always: true }
  | { hasKind: Kind[] }
  | { lacksKind: Kind[] }
  /** A stage's answers mention one of the phrases. */
  | { mentions: { stage: StageId; any: string[] } }
  /** A stage has answers but none of them mention the phrases: an omission worth probing. */
  | { omits: { stage: StageId; any: string[] } }
  /** The user has worked on (or moved past) this stage. */
  | { reached: StageId }
  /**
   * Asked after another follow-up has been submitted (a branch). Optional conditions on that answer:
   * a score below / at least a threshold, or specific expected concepts missing from it.
   */
  | { after: string; ifScoreBelow?: number; ifScoreAtLeast?: number; ifMissing?: string[] }
  | { all: Trigger[] }
  | { any: Trigger[] };
/** A failure or load scenario the simulator can run on the user's own design. */
export type Scenario = { kind: 'traffic'; multiplier: number } | { kind: 'outage'; kinds: Kind[]; startMs: number; endMs: number };
export type FollowUp = Prompt & {
  trigger: Trigger;
  /** Explains why the question is being asked, in terms of the trigger. */
  because: string;
  priority: number;
  next?: string;
  scenario?: Scenario;
  /**
   * Questions on the same topic are not asked twice as separate root questions: only the highest-priority one is.
   * Defaults to the question's own id.
   */
  topic?: string;
};

/**
 * A requirement that changes part-way through the interview ("now traffic is five times higher"). The user revises
 * the architecture; the original is kept as a checkpoint and both are compared, measured where the simulator can.
 */
export type RequirementChange = {
  id: string; title: string;
  kind: 'traffic' | 'dependency-failure' | 'latency' | 'read-heavy' | 'consistency' | 'backlog';
  /** The new or changed requirement, as the interviewer states it. */
  change: string;
  why: string;
  competency: CompetencyId;
  /** Expected considerations; the rubric for the written response. */
  considerations: Concept[];
  contradictions?: Contradiction[];
  mistakes: string[];
  /** A simulator run that applies the change to a design. Absent when the simulator cannot model it. */
  scenario?: Scenario;
  /** Targets under the change (default: the problem's benchmark targets). */
  targets?: { p95Ms?: number; minSuccessPct?: number };
  /** What a simulator run can and cannot show for this change. */
  measurable: string; notModelled: string;
  /** Alternatives that suit the changed requirement. */
  alternatives: string[];
  resources: Resource[];
};

export type ReferenceDesign = {
  /** Version of the reference solution; changes whenever its content changes. Defaults to the definition version. */
  version?: number;
  requirements: string[]; estimates: string[]; api: string[]; dataModel: string[];
  architecture: { summary: string; diagram: Diagram; decisions: string[] };
  alternatives: string[]; scaling: string[]; failures: string[]; tradeoffs: string[];
  /** Low-level design considerations for the key components. */
  lld?: string[];
  /** Why this design meets the requirements. */
  whyItWorks?: string[];
  /** When a documented alternative is the better choice. */
  preferAlternatives?: Array<{ alternative: string; when: string }>;
};

export type InterviewDefinition = {
  id: string; version: number;
  title: string; summary: string; statement: string;
  difficulty: Difficulty; categories: Category[]; topics: string[];
  minutes: number;
  requirements: RequirementExpectation[];
  clarifications: Clarification[];
  estimates: EstimateQuantity[];
  api: ApiOperation[];
  entities: EntityExpectation[];
  modelConcerns: ModelConcern[];
  roles: ArchitectureRole[];
  /** Components that add complexity this problem does not need, unless the user justifies them. */
  unnecessary: Array<{ kinds: Kind[]; why: string }>;
  benchmark: Benchmark;
  deepDives: Prompt[];
  /** Problem-specific follow-ups; the shared bank (followups.ts) is added by id. */
  followUps: FollowUp[];
  sharedFollowUps: string[];
  tradeoffs: Concept[];
  mistakes: string[];
  hints: Partial<Record<StageId, string[]>>;
  reference: ReferenceDesign;
  /** Earlier reference versions, so a record graded against one can still show it. */
  referenceHistory?: ReferenceDesign[];
  /** Requirement changes the interviewer can introduce (stage "Changing requirements"). */
  changes?: RequirementChange[];
  /** Recommended share of a mock interview per stage (defaults to STAGE_ALLOCATION). Shares are normalised. */
  stageAllocation?: Partial<Record<StageId, number>>;
  lessons: string[]; lld: Kind[];
  /** Criterion weights (default 1). Keys are criterion ids produced by the evaluator. */
  weights?: Record<string, number>;
};

/** Every stage, in order. A problem without requirement changes skips "changes" (see `stagesOf`). */
export const STAGES: StageId[] = ['requirements', 'estimation', 'api', 'data', 'design', 'deepdive', 'followups', 'changes', 'review'];
export const stagesOf = (definition: Pick<InterviewDefinition, 'changes'>): StageId[] => definition.changes?.length ? STAGES : STAGES.filter(stage => stage !== 'changes');
export const STAGE_LABELS: Record<StageId, string> = {
  requirements: 'Requirements', estimation: 'Capacity estimation', api: 'API design', data: 'Data model',
  design: 'High-level design', deepdive: 'Deep dives', followups: 'Trade-offs and failures', changes: 'Changing requirements', review: 'Final review',
};
/** Default recommended share of a mock interview's time per stage (normalised over the stages a problem uses). */
export const STAGE_ALLOCATION: Record<StageId, number> = { requirements: 0.1, estimation: 0.1, api: 0.1, data: 0.1, design: 0.25, deepdive: 0.15, followups: 0.12, changes: 0.1, review: 0.08 };
/** Mock interview lengths offered. */
export const MOCK_DURATIONS = [30, 45, 60] as const;
export const COMPETENCY_LABELS: Record<CompetencyId, string> = {
  clarification: 'Requirement clarification', estimation: 'Capacity estimation', api: 'API design', 'data-model': 'Data modeling',
  architecture: 'High-level architecture', scalability: 'Scalability', reliability: 'Reliability and failure handling',
  consistency: 'Consistency and storage decisions', tradeoffs: 'Trade-off reasoning', communication: 'Communication',
};
export const DIFFICULTY_LABELS: Record<Difficulty, string> = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' };
export const CATEGORY_LABELS: Record<Category, string> = {
  api: 'API and backend systems', caching: 'Caching', storage: 'Databases and storage', messaging: 'Messaging and asynchronous processing',
  scalability: 'Scalability', reliability: 'Reliability and fault tolerance', distributed: 'Distributed systems', observability: 'Observability', complete: 'Complete system design',
};
