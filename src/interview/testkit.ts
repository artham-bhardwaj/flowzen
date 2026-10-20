import { byKind, type Kind } from '../app/catalog';
import type { ArchitectureSnapshot } from '../challenges/attempts';
import { measure } from '../lab/measure';
import { simulate } from '../simulation/engine';
import { benchmarkInput, toEvidence } from './benchmark';
import { activeFollowUps } from './evaluate';
import { createSession, type InterviewSession } from './session';
import { answerChange, introduceChange, reviseChange, submitChange } from './workflow';
import { majorDecisions } from './reasoning';
import type { Concept, InterviewDefinition, Scenario } from './types';

/**
 * Test helpers (used by unit tests only). They build sessions from a definition's own expectations, so tests check
 * the engine's rules rather than hand-written answers, and they simulate architectures exactly as the app does.
 */
export type Graph = { nodes: Array<[id: string, kind: Kind, config?: Record<string, string>]>; edges: Array<[string, string]> };
export const snapshot = (graph: Graph): ArchitectureSnapshot => ({
  schema: 'flowzen.architecture', version: 1,
  nodes: graph.nodes.map(([id, kind, config], i) => ({ id, kind, label: `${byKind[kind].label} ${id}`, config: { ...byKind[kind].defaults, ...config }, position: { x: i * 200, y: 0 } })),
  edges: graph.edges.map(([source, target]) => ({ source, target })),
});
export function runBenchmark(definition: InterviewDefinition, architecture: ArchitectureSnapshot, scenario?: Scenario) {
  const input = benchmarkInput(definition, architecture, scenario);
  return toEvidence(measure(simulate(input), input, Object.fromEntries(architecture.nodes.map(node => [node.id, node.label]))), architecture, 'test', 1);
}
/** Text that mentions every concept (first phrase of each), padded to a realistic length. */
export const covering = (concepts: Concept[]) => `In this design I would address ${concepts.map(concept => concept.any[0].replace(/^\/|\/$/g, '')).join(', and ')} because it matters for the workload and the requirements.`;

/** A session that answers every stage from the definition's expectations, on the given architecture. */
export function strongSession(definition: InterviewDefinition, architecture: ArchitectureSnapshot, options: { benchmark?: boolean } = {}): InterviewSession {
  let session = createSession(definition, { id: 's-strong', at: 1, mode: 'practice' });
  const values: Record<string, string> = {};
  for (const quantity of definition.estimates.filter(entry => entry.role === 'assumption')) values[quantity.id] = String(quantity.reference);
  // Derived values computed from the assumptions above, exactly as a careful candidate would.
  const resolve = (term: string | number) => typeof term === 'number' ? term : Number(values[term]);
  for (const quantity of definition.estimates.filter(entry => entry.role === 'derived')) values[quantity.id] = String((quantity.formula!.product.map(resolve).reduce((a, b) => a * b, 1)) / (quantity.formula!.divide ?? []).map(resolve).reduce((a, b) => a * b, 1));
  const decisions = Object.fromEntries(architecture.nodes.map(node => [node.id, covering(definition.roles.filter(role => role.kinds.includes(node.kind)).flatMap(role => role.explain).concat({ id: 'x', label: 'x', any: ['component choice'] }))]));
  session = {
    ...session,
    requirements: {
      functional: definition.requirements.filter(entry => entry.kind === 'functional').map(entry => entry.any[0]).join('\n'),
      nonFunctional: definition.requirements.filter(entry => entry.kind === 'non-functional').map(entry => entry.any[0]).join('\n'),
      scope: 'In scope: the core read and write paths described above, at the stated scale.', excluded: 'Billing and administration tools',
    },
    clarificationsAsked: definition.clarifications.map(entry => entry.id),
    estimates: values, estimateNotes: 'Derived from the stated assumptions.',
    endpoints: definition.api.map((operation, i) => ({
      id: `e${i}`, method: operation.methods[0], path: `/v1/${operation.any[0]}`,
      request: operation.considerations.flatMap(entry => 'text' in entry.check && entry.check.text === 'request' ? [entry.check.any[0]] : []).join(' ') || 'body',
      response: operation.considerations.flatMap(entry => 'text' in entry.check && entry.check.text === 'response' ? [entry.check.any[0]] : []).join(' ') || 'result',
      errors: operation.considerations.flatMap(entry => 'text' in entry.check && entry.check.text === 'errors' ? [entry.check.any[0]] : []).join(' ') || '400',
      notes: operation.considerations.flatMap(entry => 'text' in entry.check && entry.check.text === 'any' ? [entry.check.any[0]] : []).join(' '),
      auth: true, idempotent: true, paginated: true,
    })),
    entities: definition.entities.map((expectation, i) => ({ id: `d${i}`, name: expectation.names[0], fields: expectation.fields.map(field => field.any[0]).join(', '), primaryKey: 'id', indexes: definition.modelConcerns.map(concern => concern.any[0]).join('; '), relationships: '', accessPatterns: '', consistency: '' })),
    architecture, decisions, designNotes: covering(definition.tradeoffs),
    deepDives: Object.fromEntries(definition.deepDives.map(prompt => [prompt.id, covering(prompt.concepts)])),
    review: { architecture: covering(definition.tradeoffs), decisions: covering(definition.tradeoffs), bottlenecks: covering(definition.tradeoffs), failures: covering(definition.tradeoffs), limitations: covering(definition.tradeoffs), tradeoffs: covering(definition.tradeoffs) },
  };
  if (options.benchmark !== false) session = { ...session, benchmark: runBenchmark(definition, architecture) };
  // Structured explanations for every major decision, citing one of the user's own estimates as evidence.
  const assumption = definition.estimates.find(entry => entry.role === 'assumption')!;
  session = { ...session, explanations: Object.fromEntries(majorDecisions(definition, session).map(node => [node.id, {
    problem: `It serves the ${definition.requirements[0].label.toLowerCase()} requirement at the expected load.`,
    alternatives: 'Considered a Read Replica instead, which would also work but costs more per read.',
    tradeoffs: 'The trade-off is more operational complexity and some extra cost to run it.',
    failure: 'If it fails, requests fall back to the next tier and latency rises until it recovers.',
    evidence: `Based on my estimate of ${assumption.reference} ${assumption.unit}.`,
  }])) };
  // Take on every requirement change: keep the original, answer it, save the (unchanged) revision.
  for (const change of definition.changes ?? []) {
    session = introduceChange(session, change.id, change.title, 2);
    session = answerChange(session, change.id, covering(change.considerations), 2);
    session = submitChange(reviseChange(session, change.id, change.title, 3), change.id, 3);
  }
  // Answer follow-ups until the chains stop growing.
  for (let round = 0; round < 6; round++) {
    const active = activeFollowUps(definition, session).filter(item => !session.followUps[item.followUp.id]?.answer);
    if (!active.length) break;
    session = { ...session, followUps: { ...session.followUps, ...Object.fromEntries(active.map(item => [item.followUp.id, { askedAt: 1, answeredAt: 1, submittedAt: 1, answer: covering(item.followUp.concepts) }])) } };
  }
  return session;
}
