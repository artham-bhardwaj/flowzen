import { byKind, type Kind } from '../app/catalog';
import { GUIDES } from '../learn/components';
import { TELEMETRY_KINDS } from '../simulation/engine';
import { parseNumber } from './numbers';
import { scaleFromRatio, type Basis } from './score';
import { EMPTY_EXPLANATION, type InterviewSession } from './session';
import { matchedPhrase, mentions, wordCount } from './text';
import type { InterviewDefinition } from './types';

/**
 * The reasoning rubric for major design decisions. A decision is one component that fills a role in the problem
 * (or one the problem flags as unnecessary). Its explanation is checked on six dimensions, each with a stated rule:
 *   problem       – the problem it solves is stated (≥ 5 words; noted when it names a requirement);
 *   approach      – the chosen approach is stated (the decision note, ≥ 5 words);
 *   alternatives  – at least one alternative is named (a component or a documented alternative for it);
 *   trade-offs    – a cost of the choice is stated;
 *   failure modes – what happens when it fails is stated;
 *   evidence      – a number that matches the user's own estimates or measurements (checked arithmetically),
 *                   or an explicitly stated assumption (recorded as unverified).
 * The rules check that each part of the reasoning is present and grounded. Whether the reasoning is right is a
 * judgement the rules cannot make, so the criterion is marked for manual review and can be corrected in the report.
 */
export type DimensionId = 'problem' | 'approach' | 'alternatives' | 'tradeoffs' | 'failure' | 'evidence';
export type DimensionResult = { id: DimensionId; label: string; met: boolean; basis: Basis; note: string };
export type DecisionAssessment = {
  nodeId: string; label: string; kind: Kind; role: string | null;
  dimensions: DimensionResult[]; score: number; words: number; uncertain: boolean;
  /** Considerations the user could add, drawn from the component guide and the problem; suggestions, not requirements. */
  suggestions: string[];
};
export const DIMENSION_LABELS: Record<DimensionId, string> = { problem: 'Problem stated', approach: 'Approach stated', alternatives: 'Alternatives considered', tradeoffs: 'Trade-offs stated', failure: 'Failure modes', evidence: 'Evidence or assumptions' };
const COST_WORDS = ['cost', 'latency', 'stale', 'consisten', 'complex', 'operational', 'memory', 'expensive', 'slower', 'however', 'at the expense', 'trade', 'downside', 'risk', 'overhead', 'but '];
const FAILURE_WORDS = ['fail', 'down', 'outage', 'unavailable', 'timeout', 'crash', 'lost', 'loss', 'degrad', 'fallback', 'fall back', 'retry', 'overload', 'miss', 'error'];
const ASSUMPTION_WORDS = ['assum', 'expect', 'estimate', 'roughly', 'about'];
/** A number as written in prose; digits inside words ("p95", "base62") are not numbers. */
const NUMBER = /(?<![A-Za-z0-9.])(\d+(?:[.,]\d+)?)\s*(million|thousand|req\/s|rps|ms|gb|tb|k|m)?(?![A-Za-z])/gi;

/** Numbers the user produced: their estimates and the measured runs on their designs. */
function ownNumbers(session: InterviewSession): Array<{ value: number; source: string }> {
  const out: Array<{ value: number; source: string }> = [];
  for (const [id, raw] of Object.entries(session.estimates)) { const value = parseNumber(raw); if (value !== null) out.push({ value, source: `your estimate “${id}”` }); }
  const runs = [session.benchmark, ...Object.values(session.scenarioRuns), ...Object.values(session.changes).flatMap(entry => [entry.runs.original, entry.runs.revised])].filter(Boolean);
  for (const run of runs) {
    if (run!.p95 !== null) out.push({ value: run!.p95, source: `the measured p95 (${run!.label})` });
    out.push({ value: run!.successPct, source: `the measured success rate (${run!.label})` });
    out.push({ value: run!.successThroughput, source: `the measured throughput (${run!.label})` });
    if (run!.busiest) out.push({ value: Math.round(run!.busiest.utilization * 100), source: `the measured utilization of ${run!.busiest.label} (${run!.label})` });
  }
  return out;
}
function numbersIn(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(NUMBER)) { const value = parseNumber(`${match[1].replace(',', '')}${match[2] && /^(k|m|million|thousand)$/i.test(match[2]) ? ` ${match[2]}` : ''}`); if (value !== null && value > 0) values.push(value); }
  return values;
}
/** A stated number is grounded when it is within 25% of one of the user's own estimates or measurements. */
export function groundedNumber(text: string, session: InterviewSession): { value: number; source: string } | null {
  const own = ownNumbers(session);
  for (const value of numbersIn(text)) { const hit = own.find(entry => entry.value > 0 && Math.abs(entry.value - value) <= entry.value * 0.25); if (hit) return { value, source: hit.source }; }
  return null;
}

export function majorDecisions(definition: InterviewDefinition, session: InterviewSession) {
  const kinds = new Set<Kind>([...definition.roles.flatMap(role => role.kinds), ...definition.unnecessary.flatMap(entry => entry.kinds)]);
  return (session.architecture?.nodes ?? []).filter(node => node.kind !== 'client' && !TELEMETRY_KINDS.has(node.kind) && kinds.has(node.kind));
}

export function assessDecisions(definition: InterviewDefinition, session: InterviewSession): DecisionAssessment[] {
  return majorDecisions(definition, session).map(node => {
    const role = definition.roles.find(entry => entry.kinds.includes(node.kind)) ?? null;
    const explanation = { ...EMPTY_EXPLANATION, ...session.explanations[node.id] };
    const approach = session.decisions[node.id] ?? '';
    const guide = GUIDES[node.kind];
    const dims: DimensionResult[] = [];
    // Problem: written, and noted when it names a requirement this role serves.
    const requirementPhrases = definition.requirements.filter(entry => role?.covers?.includes(entry.id));
    const linked = requirementPhrases.find(entry => mentions(explanation.problem, entry.any));
    dims.push({ id: 'problem', label: DIMENSION_LABELS.problem, basis: 'structural', met: wordCount(explanation.problem) >= 5,
      note: wordCount(explanation.problem) < 5 ? 'Not stated (needs at least 5 words).' : linked ? `Stated, and linked to the requirement “${linked.label}”.` : 'Stated.' });
    dims.push({ id: 'approach', label: DIMENSION_LABELS.approach, basis: 'structural', met: wordCount(approach) >= 5, note: wordCount(approach) >= 5 ? 'Stated in the decision note.' : 'The decision note is missing or under 5 words.' });
    // Alternatives: another component, or one of the guide's documented alternatives.
    const alternativeNames = [...guide.alternatives.map(entry => entry.name), ...Object.values(byKind).filter(item => item.kind !== node.kind && item.kind !== 'client').map(item => item.label)];
    const named = wordCount(explanation.alternatives) >= 3 ? matchedPhrase(explanation.alternatives, alternativeNames) ?? (mentions(explanation.alternatives, ['instead', 'rather than', 'alternative', 'could also', 'versus', ' vs ']) ? 'an alternative approach' : null) : null;
    dims.push({ id: 'alternatives', label: DIMENSION_LABELS.alternatives, basis: 'keyword', met: Boolean(named), note: named ? `Names ${named}.` : `No alternative named. Documented alternatives: ${guide.alternatives.slice(0, 3).map(entry => entry.name).join(', ')}.` });
    const cost = wordCount(explanation.tradeoffs) >= 5 ? matchedPhrase(explanation.tradeoffs, COST_WORDS) : null;
    dims.push({ id: 'tradeoffs', label: DIMENSION_LABELS.tradeoffs, basis: 'keyword', met: Boolean(cost), note: cost ? `States a cost (“${cost.trim()}”).` : `No cost stated. From the guide: ${guide.cons.slice(0, 2).join(' ')}` });
    const failure = wordCount(explanation.failure) >= 5 ? matchedPhrase(explanation.failure, FAILURE_WORDS) : null;
    dims.push({ id: 'failure', label: DIMENSION_LABELS.failure, basis: 'keyword', met: Boolean(failure), note: failure ? `Describes failure behaviour (“${failure}”).` : `No failure mode stated. From the guide: ${guide.failureModes.slice(0, 2).join(' ')}` });
    const grounded = groundedNumber(`${explanation.evidence} ${explanation.problem} ${approach}`, session);
    const assumed = !grounded && numbersIn(explanation.evidence).length > 0 && mentions(explanation.evidence, ASSUMPTION_WORDS);
    dims.push({ id: 'evidence', label: DIMENSION_LABELS.evidence, basis: grounded ? 'arithmetic' : 'keyword', met: Boolean(grounded) || assumed,
      note: grounded ? `Cites ${grounded.value.toLocaleString()}, which matches ${grounded.source}.` : assumed ? 'States a numeric assumption; it does not match your estimates or measurements, so it is unverified.' : 'No number from your estimates or measurements, and no stated assumption.' });
    const met = dims.filter(dim => dim.met).length;
    const words = wordCount([approach, ...Object.values(explanation)].join(' '));
    const score = met === 0 ? (words ? 1 : 0) : scaleFromRatio(met / dims.length);
    const suggestions = [...(role ? [`Why the role matters here: ${role.why}`] : []), ...guide.failureModes.slice(0, 1).map(entry => `Failure to consider: ${entry}`), ...(role?.explain.map(concept => `Consider explaining ${concept.label}.`) ?? [])];
    return { nodeId: node.id, label: node.label || byKind[node.kind].label, kind: node.kind, role: role?.label ?? null, dimensions: dims, score, words, uncertain: score <= 2 && words >= 60, suggestions };
  });
}
