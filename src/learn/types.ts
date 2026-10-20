import type { Kind } from '../app/catalog';

/**
 * The learning track's content model. Lessons are structured data; UI components render them.
 * Inline text may use **bold** and `code`; nothing else is interpreted.
 */

/** How much of a lesson the simulator can demonstrate. */
export type SimulatorSupport = 'simulated' | 'partial' | 'theory';

export type DiagramNode = { id: string; label: string; kind?: Kind; note?: string; col: number; row: number };
export type DiagramEdge = { from: string; to: string; label?: string; dashed?: boolean };
/** A small left-to-right architecture diagram laid out on a grid (columns are hops). */
export type Diagram = { id: string; title: string; caption: string; nodes: DiagramNode[]; edges: DiagramEdge[] };

export type Block =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[]; ordered?: boolean }
  | { type: 'table'; caption: string; columns: string[]; rows: string[][] }
  | { type: 'diagram'; diagram: Diagram }
  | { type: 'callout'; tone: 'note' | 'warn' | 'sim'; title: string; text: string }
  | { type: 'formula'; expression: string; explanation: string }
  | { type: 'example'; title: string; blocks: Block[] };

export type Term = { term: string; definition: string };

/** Section A: from intuition to technical depth. */
export type ConceptSection = {
  definition: string;
  problem: Block[];
  whyItOccurs: Block[];
  howItWorks: Block[];
  /** Optional deeper material, revealed on request. */
  deeper?: Block[];
  terms: Term[];
  example: { title: string; blocks: Block[] };
  diagrams: Diagram[];
  advantages: string[];
  limitations: string[];
};
/** Section B. */
export type WhyWhenSection = {
  justification: string;
  usefulWhen: string[]; unnecessaryWhen: string[]; makesWorse: string[];
  complexity: string[]; failureModes: string[]; evidence: string[];
};
/** Section C. Never names a universal winner: each option has the conditions under which it fits. */
export type AlternativesSection = {
  intro: string;
  table: { caption: string; columns: string[]; rows: string[][] };
  options: Array<{ name: string; chooseWhen: string; kind?: Kind }>;
};
/** Section D. */
export type DesignSection = {
  diagram: Diagram; summary: string;
  upstream: string[]; downstream: string[]; flow: string[]; configuration: string[];
  bottlenecks: string[]; failure: string[];
};

/** Knowledge-check questions test judgment (why, when, trade-offs, failure), not just definitions. */
export type QuestionSkill = 'why' | 'when' | 'trade-off' | 'failure' | 'estimate' | 'concept';
export type Question = {
  id: string; prompt: string; skill: QuestionSkill;
  /** `single`: exactly one correct option. `multi`: select every correct option. */
  mode: 'single' | 'multi';
  options: Array<{ id: string; text: string; feedback?: string }>;
  correct: string[];
  explanation: string;
};

/** Practical exercise tasks. Numeric tasks are graded with a tolerance; build tasks with a measured Playground run. */
export type NumericTask = { type: 'numeric'; id: string; prompt: string; unit: string; answer: number; tolerancePct: number; working: string[] };
export type ClassifyTask = { type: 'classify'; id: string; prompt: string; categories: string[]; items: Array<{ id: string; text: string; category: string; why: string }> };
export type BuildCheck =
  | { metric: 'p95'; max: number }
  | { metric: 'successPct'; min: number }
  | { metric: 'computeSlots'; max: number }
  | { metric: 'hasKind'; kind: Kind }
  /** Background jobs completed by the end of the run, as a share of jobs created. */
  | { metric: 'jobsCompletedPct'; min: number };
export type BuildTask = {
  type: 'build'; id: string; prompt: string;
  /** The exercise's own workload. It is run on whatever the user builds, so any design that meets the checks passes. */
  benchmark: { rps: number; durationMs: number; drainMs: number; seed: number };
  /** Settings the benchmark forces on every component of these kinds (e.g. per-request work), so a task cannot be passed by lowering them. */
  overrides: Array<{ kinds: Kind[]; config: Record<string, string>; reason: string }>;
  /** Starting canvas loaded into the Playground (a copy). */
  starter: Array<{ id: string; kind: Kind; label: string; x: number; y: number; config?: Record<string, string> }>;
  starterEdges: Array<[string, string]>;
  checks: Array<BuildCheck & { label: string }>;
  hints: string[];
  /** One design that passes (tests check it does, and that the starter does not). Shown only after the task is passed. */
  solution: { nodes: BuildTask['starter']; edges: Array<[string, string]>; note: string };
};
export type ExerciseTask = NumericTask | ClassifyTask | BuildTask;
export type Exercise = { title: string; brief: string; tasks: ExerciseTask[] };

export type Lesson = {
  id: string; moduleId: string; title: string; summary: string; minutes: number;
  simulator: SimulatorSupport;
  /** What the simulator can and cannot show for this lesson. */
  simulatorNote: string;
  objectives: string[];
  concept: ConceptSection; whyWhen: WhyWhenSection; alternatives: AlternativesSection; design: DesignSection;
  /** Id of an experiment template (see experiments.ts); absent for theory-only lessons. */
  experiment?: string;
  /** Why there is no experiment, when there is none. */
  noExperimentReason?: string;
  quiz: Question[];
  exercise?: Exercise;
  /** Components (component guides) and LLD designs this lesson relates to. */
  components: Kind[]; lld: Kind[];
  /** Challenges that test this lesson's ideas (optional practice). */
  challenges: string[];
};

/** A lesson listed in the curriculum but not written yet. It is shown as planned, never as content. */
export type PlannedLesson = { id: string; title: string; simulator: SimulatorSupport; components?: Kind[] };
export type Module = {
  id: string; number: number; title: string; summary: string;
  lessons: Array<Lesson | PlannedLesson>;
};
export const isLesson = (entry: Lesson | PlannedLesson): entry is Lesson => 'concept' in entry;

/** Lesson sections in reading order. A–D are reading; the rest are practice. */
export type SectionId = 'concept' | 'why' | 'alternatives' | 'design' | 'experiment' | 'check' | 'exercise';
export const READING_SECTIONS: SectionId[] = ['concept', 'why', 'alternatives', 'design'];
