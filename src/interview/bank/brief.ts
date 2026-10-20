import { c, diagram, flag, fr, nfr, text } from '../problems/helpers';
import type { ApiOperation, CompetencyId, Concept, Difficulty, EstimateQuantity, FollowUp, HttpMethod, InterviewDefinition, Prompt, StageId } from '../types';
type Allocation = Partial<Record<StageId, number>>;
import { SHAPES, type ShapeId } from './shapes';

/**
 * A question-bank problem written as a compact, typed brief. `fromBrief` turns it into a full interview definition
 * that runs in the existing workflow: the same stages, evaluator, canvas, follow-up engine and records. The brief's
 * shape supplies a proven simulated benchmark and the architecture roles; the brief supplies everything
 * problem-specific (requirements, scale, APIs, data model, deep dives, follow-ups, trade-offs and the reference).
 * Nothing here is generated at run time by a model: every word is authored data.
 */
type Req = [id: string, label: string, any: string[], critical?: boolean];
type ConceptSpec = [label: string, any: string[]];
type PromptSpec = { id: string; title: string; competency: CompetencyId; question: string; concepts: ConceptSpec[]; reference: string[]; mistakes: string[] };
export type QuestionBrief = {
  id: string; title: string; summary: string; statement: string;
  difficulty: Difficulty; minutes?: number; topics: string[];
  shape: ShapeId;
  functional: Req[]; nonFunctional: Req[];
  /** Clarifying questions with the interviewer's answer; `true` marks an important one. Scale questions are added automatically. */
  ask: Array<[question: string, answer: string, important?: boolean]>;
  /** Workload assumptions: daily active users, primary write actions per user per day, reads per write, bytes per record, retention. */
  scale: { users: number; actions: number; action: string; reads: number; bytes: number; years: number };
  api: Array<[method: HttpMethod, path: string, purpose: string, any: string[], required?: boolean]>;
  entities: Array<[name: string, fields: ConceptSpec[], required?: boolean]>;
  concerns: Array<[label: string, any: string[], competency: 'data-model' | 'consistency', why: string]>;
  deepDives: PromptSpec[];
  followUps: PromptSpec[];
  tradeoffs: ConceptSpec[];
  mistakes: string[];
  /** Relabels nodes of the shape's reference diagram (by node id). */
  labels?: Record<string, string>;
  reference: {
    requirements: string[]; dataModel: string[]; summary: string; decisions: string[];
    alternatives: string[]; scaling: string[]; failures: string[]; tradeoffs: string[];
    whyItWorks: string[]; prefer: Array<[alternative: string, when: string]>; lld?: string[];
  };
};

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const concepts = (specs: ConceptSpec[]): Concept[] => specs.map(([label, any]) => c(slug(label).slice(0, 40), label, any));
const prompt = (spec: PromptSpec): Prompt => ({ id: spec.id, title: spec.title, question: spec.question, competency: spec.competency, concepts: concepts(spec.concepts), reference: spec.reference, mistakes: spec.mistakes, resources: [] });
const fmt = (value: number) => value >= 100 ? Math.round(value).toLocaleString('en-US') : String(Math.round(value * 10) / 10);

/** Estimation quantities derived from the brief's scale, with formulas checked against the user's own inputs. */
function estimates(brief: QuestionBrief): EstimateQuantity[] {
  const { users, actions, action, reads, bytes, years } = brief.scale;
  const writesPerDay = users * actions; const writeRps = writesPerDay / 86_400; const readRps = writeRps * reads;
  const storageTb = writesPerDay * 365 * years * bytes / 1e12;
  return [
    { id: 'users', label: 'Daily active users', unit: 'users', role: 'assumption', reference: users, factor: 3, why: 'Scales every other number.', working: [`Given in the clarifications: about ${fmt(users)}.`] },
    { id: 'actions', label: `${action[0].toUpperCase()}${action.slice(1)} per user per day`, unit: '/day', role: 'assumption', reference: actions, factor: 3, why: 'Drives the write rate.', working: [`Given in the clarifications: about ${fmt(actions)}.`] },
    { id: 'reads', label: 'Reads per write', unit: ':1', role: 'assumption', reference: reads, factor: 3, why: 'Shows whether the read or the write path dominates.', working: [`Given in the clarifications: about ${fmt(reads)}:1.`] },
    { id: 'bytes', label: 'Bytes per stored record', unit: 'bytes', role: 'assumption', reference: bytes, factor: 4, why: 'Sizes storage.', working: [`Estimate the fields and round: about ${fmt(bytes)} bytes.`] },
    { id: 'writeRps', label: `Average ${action} per second`, unit: '/s', role: 'derived', reference: writeRps, factor: 3, formula: { product: ['users', 'actions'], divide: [86_400] }, why: 'Write load on the store.', working: [`${fmt(users)} × ${fmt(actions)} ÷ 86,400 s ≈ ${fmt(writeRps)}/s on average; peaks are several times higher.`] },
    { id: 'readRps', label: 'Average reads per second', unit: 'req/s', role: 'derived', reference: readRps, factor: 3, formula: { product: ['users', 'actions', 'reads'], divide: [86_400] }, why: 'The read load decides caching and replication.', working: [`${fmt(writeRps)}/s × ${fmt(reads)} ≈ ${fmt(readRps)} reads/s.`] },
    { id: 'storageTb', label: `Storage after ${years} year${years === 1 ? '' : 's'}`, unit: 'TB', role: 'derived', reference: storageTb, factor: 3, formula: { product: ['users', 'actions', 365, years, 'bytes'], divide: [1e12] }, why: 'Decides whether the data fits one node or must be partitioned.', working: [`${fmt(writesPerDay)}/day × 365 × ${years} × ${fmt(bytes)} B ≈ ${fmt(storageTb)} TB before replication.`] },
  ];
}
function api(brief: QuestionBrief): ApiOperation[] {
  return brief.api.map(([method, path, purpose, any, required = true], i) => {
    const write = method !== 'GET';
    return { id: `op${i}`, purpose, required, methods: [method], any: [path.split('/').filter(part => part && !part.startsWith('{') && !/^v\d$/.test(part)).pop() ?? path, ...any],
      considerations: write
        ? [text(`op${i}-req`, 'request carries the needed fields', 'request', ['id', 'body', 'json', ...any]), text(`op${i}-err`, 'error responses (invalid input, conflicts, limits)', 'errors', ['400', '404', '409', '422', '429', 'invalid', 'conflict']), flag(`op${i}-auth`, 'authentication', 'auth', 'Writes must be tied to an authenticated caller.')]
        : [text(`op${i}-res`, 'response describes what is returned', 'response', ['200', 'list', 'json', 'id', ...any]), text(`op${i}-err`, 'not-found or invalid-input errors', 'errors', ['404', '400', 'not found', 'invalid'])] };
  });
}
/** Recommended mock-interview time per stage, by workload shape (normalised over the stages a problem uses). */
const plan = (requirements: number, estimation: number, api: number, data: number, design: number, deepdive: number, followups: number, review: number): Allocation => ({ requirements, estimation, api, data, design, deepdive, followups, review });
const ALLOCATION: Record<ShapeId, Allocation> = {
  'read-cache': plan(0.1, 0.1, 0.1, 0.1, 0.24, 0.16, 0.12, 0.08), 'catalog-read': plan(0.1, 0.08, 0.1, 0.12, 0.24, 0.16, 0.12, 0.08),
  'async-delivery': plan(0.1, 0.08, 0.1, 0.08, 0.24, 0.16, 0.16, 0.08), blob: plan(0.1, 0.12, 0.1, 0.1, 0.24, 0.14, 0.12, 0.08),
  transactional: plan(0.12, 0.06, 0.12, 0.14, 0.22, 0.16, 0.12, 0.06), 'stream-fanout': plan(0.1, 0.1, 0.08, 0.1, 0.26, 0.16, 0.12, 0.08),
  feed: plan(0.08, 0.12, 0.06, 0.1, 0.26, 0.18, 0.12, 0.08), 'index-lookup': plan(0.1, 0.12, 0.06, 0.12, 0.24, 0.16, 0.12, 0.08),
  'media-pipeline': plan(0.1, 0.12, 0.08, 0.08, 0.26, 0.16, 0.12, 0.08), 'realtime-ingest': plan(0.1, 0.12, 0.06, 0.1, 0.26, 0.16, 0.12, 0.08),
  scheduler: plan(0.12, 0.06, 0.08, 0.12, 0.24, 0.18, 0.12, 0.08), gatekeeper: plan(0.12, 0.08, 0.14, 0.08, 0.24, 0.14, 0.12, 0.08),
};
const HINTS = (designHint: string): Partial<Record<StageId, string[]>> => ({
  requirements: ['Separate what users do (functional) from how well it must work (latency, availability, consistency).', 'Ask about scale and the read/write mix before designing.'],
  estimation: ['Daily volume ÷ 86,400 gives per-second rates; peaks are several times the average.', 'Storage = records per day × days × bytes per record.'],
  api: ['One endpoint per core operation; say which writes must be safe to retry.'],
  data: ['Start from the access patterns: which key does each hot query use?'],
  design: [designHint, 'Explain each component: why it is there and what would break without it.'],
  deepdive: ['Pick the topics where your design makes a real choice.'],
  followups: ['Use numbers from your estimates in your answers.'],
  review: ['Summarise decisions and their trade-offs, not a list of boxes.'],
});

export function fromBrief(brief: QuestionBrief): InterviewDefinition {
  const shape = SHAPES[brief.shape];
  const scaleAsk = [
    { id: 'scale-users', question: 'How many daily active users should we plan for?', answer: `About ${fmt(brief.scale.users)} daily active users.`, important: true },
    { id: 'scale-mix', question: `How often do users ${brief.scale.action.replace(/s$/, '')}, and how read-heavy is it?`, answer: `About ${fmt(brief.scale.actions)} ${brief.scale.action} per user per day, with roughly ${fmt(brief.scale.reads)} reads per write.`, important: true },
  ];
  const nodes = shape.diagram.nodes.map(([id, label, col, row, kind]) => [id, brief.labels?.[id] ?? label, col, row, kind] as [string, string, number, number, typeof kind]);
  const followUps: FollowUp[] = brief.followUps.map((spec, i) => ({ ...prompt(spec), trigger: { always: true }, because: `A question specific to ${brief.title}.`, priority: 86 - i, topic: `${brief.id}:${spec.id}` }));
  const ops = api(brief);
  return {
    id: brief.id, version: 1, title: brief.title, summary: brief.summary, statement: brief.statement,
    difficulty: brief.difficulty, categories: shape.categories, topics: brief.topics, minutes: brief.minutes ?? 45,
    requirements: [...brief.functional.map(([id, label, any, critical]) => fr(id, label, any, Boolean(critical), `${label} is part of the core product.`)), ...brief.nonFunctional.map(([id, label, any, critical]) => nfr(id, label, any, Boolean(critical), `${label} shapes the architecture.`))],
    clarifications: [...scaleAsk, ...brief.ask.map(([question, answer, important], i) => ({ id: `ask-${i}`, question, answer, important: Boolean(important) }))],
    estimates: estimates(brief), api: ops,
    entities: brief.entities.map(([name, fields, required = true], i) => ({ id: `entity-${i}`, label: name, names: [name.toLowerCase().split(' ')[0].replace(/s$/, '')], fields: concepts(fields), required })),
    modelConcerns: brief.concerns.map(([label, any, competency, why]) => ({ id: slug(label).slice(0, 40), label, any, competency, why })),
    roles: structuredClone(shape.roles), unnecessary: structuredClone(shape.unnecessary), benchmark: structuredClone(shape.benchmark),
    deepDives: brief.deepDives.map(prompt), followUps, sharedFollowUps: shape.sharedFollowUps,
    tradeoffs: concepts(brief.tradeoffs), mistakes: brief.mistakes, hints: HINTS(shape.designHint),
    reference: {
      version: 1, requirements: brief.reference.requirements,
      estimates: estimates(brief).filter(quantity => quantity.role === 'derived').map(quantity => `${quantity.label}: ${quantity.working[0]}`),
      api: brief.api.map(([method, path, purpose]) => `${method} ${path} — ${purpose}.`), dataModel: brief.reference.dataModel,
      architecture: { summary: brief.reference.summary, diagram: diagram(`${brief.id}-ref`, 'Reference design', 'One reasonable design; others are valid if they meet the requirements.', nodes, shape.diagram.edges), decisions: brief.reference.decisions },
      alternatives: brief.reference.alternatives, scaling: brief.reference.scaling, failures: brief.reference.failures, tradeoffs: brief.reference.tradeoffs,
      whyItWorks: brief.reference.whyItWorks, preferAlternatives: brief.reference.prefer.map(([alternative, when]) => ({ alternative, when })), ...(brief.reference.lld ? { lld: brief.reference.lld } : {}),
    },
    stageAllocation: ALLOCATION[brief.shape], lessons: shape.lessons, lld: shape.lld,
  };
}
