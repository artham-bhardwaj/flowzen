import { byKind, type Kind } from '../app/catalog';
import { validateArchitecture, type Validation } from '../app/validation';
import { TELEMETRY_KINDS } from '../simulation/engine';
import { activeFollowUps, followUpPool, stageText } from './adaptive';
import { compareChange, type ChangeComparison } from './changes';
import { parseNumber } from './numbers';
import { assessDecisions, type DecisionAssessment } from './reasoning';
import { MIN_WORDS, scaleFromRatio, scoreText, type Basis, type Evidence } from './score';
import { architectureKey, type InterviewSession, type RunEvidence } from './session';
import { checkConcepts, lines, mentions, wordCount } from './text';
import { COMPETENCY_LABELS, type ArchitectureRole, type CompetencyId, type EstimateQuantity, type InterviewDefinition, type Prompt, type Resource, type StageId } from './types';
import { reviewWhiteboard, type WhiteboardReview } from './whiteboard';

export { activeFollowUps, followUpPool, MAX_ROOT_FOLLOW_UPS, planFollowUps, stageText, type ActiveFollowUp } from './adaptive';
export { parseNumber } from './numbers';
export { scoreText, type Basis, type Evidence } from './score';

/**
 * Deterministic interview evaluation. Every criterion is scored 0–4 by an explicit rule and lists the evidence
 * behind it, labelled by basis:
 *   structural – read from the architecture and its static validation;
 *   measured   – from an isolated simulation run of the user's architecture;
 *   arithmetic – checked numerically against the user's own inputs and documented tolerances;
 *   keyword    – required concepts recognised in free text (vocabulary, not understanding).
 * Nothing here calls an external service. Keyword-based results can be marked uncertain and corrected by the user;
 * corrections are stored separately and never rewrite the automatic result. Criteria whose correctness the rules
 * cannot judge carry `manualReview`, which the report shows next to the score.
 *
 * Version 2 adds the decision-reasoning rubric, requirement-change criteria and the whiteboard review.
 */
export const EVALUATOR_VERSION = 2;
export const SCALE: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'Missing or fundamentally incorrect', 1: 'Major gaps', 2: 'Partially correct, with notable omissions', 3: 'Solid and appropriate', 4: 'Thorough, justified and attentive to trade-offs',
};
export type CriterionResult = {
  id: string; label: string; competency: CompetencyId; weight: number;
  /** null: not assessed (for example, the benchmark was never run). Excluded from totals and shown as such. */
  score: number | null;
  basis: Basis; evidence: Evidence[]; missed: string[]; critical: string[];
  uncertain: boolean; uncertainReason?: string;
  /** Set when the rules check structure or vocabulary but cannot judge correctness; the user should review it. */
  manualReview?: string;
  resources: Resource[];
};
export type RoleReview = { role: ArchitectureRole; status: 'missing' | 'unused' | 'used' | 'explained'; score: number; nodes: Array<{ id: string; label: string; kind: Kind }>; covered: string[]; missing: string[] };
export type ArchitectureReview = {
  present: boolean; roles: RoleReview[]; validation: Pick<Validation, 'counts' | 'issues'> | null;
  benchmark: { status: 'not-run' | 'stale' | 'measured'; evidence: RunEvidence | null; meets: { p95: boolean | null; success: boolean | null } };
  unnecessary: Array<{ kinds: Kind[]; why: string; nodes: string[]; justified: boolean }>;
  findings: Array<{ basis: Basis; tone: 'ok' | 'warn' | 'bad'; text: string }>;
};
export type EstimateReview = { quantity: EstimateQuantity; value: number | null; expectedFromOwn: number | null; status: 'missing' | 'ok' | 'inconsistent' | 'off-magnitude' | 'outside-range'; note: string };
export type Evaluation = {
  version: number; definitionId: string; definitionVersion: number;
  criteria: CriterionResult[];
  competencies: Array<{ id: CompetencyId; label: string; score: number | null; percent: number | null; criteria: number }>;
  overall: { percent: number; assessed: number; notAssessed: number };
  missedRequirements: Array<{ label: string; why: string; critical: boolean }>;
  estimates: EstimateReview[];
  architecture: ArchitectureReview;
  followUps: Array<{ id: string; title: string; answered: boolean }>;
  untouchedTradeoffs: string[];
  overlookedFailures: string[];
  usage: { hints: number; references: number; mode: InterviewSession['mode']; overtime: boolean };
  /** Version 2 additions (absent from records made by evaluator version 1). */
  decisions?: DecisionAssessment[];
  whiteboard?: WhiteboardReview;
  changes?: Array<Omit<ChangeComparison, 'change' | 'response' | 'baseline' | 'revision'> & { id: string; title: string; introduced: boolean; baselineId?: string; revisionId?: string }>;
};

// ── Estimation ─────────────────────────────────────────────────────────────────
const within = (value: number, reference: number, factor: number) => value > 0 && reference > 0 && value >= reference / factor && value <= reference * factor;
function compute(formula: NonNullable<EstimateQuantity['formula']>, values: Record<string, number | null>): number | null {
  const resolve = (term: string | number) => typeof term === 'number' ? term : values[term] ?? null;
  const product = formula.product.map(resolve); const divide = (formula.divide ?? []).map(resolve);
  if ([...product, ...divide].some(term => term === null)) return null;
  return (product as number[]).reduce((a, b) => a * b, 1) / (divide as number[]).reduce((a, b) => a * b, 1);
}
/** Tolerance for consistency with the user's own assumptions (rounding is expected). */
export const CONSISTENCY_TOLERANCE = 0.3;
/** Beyond this ratio from the reference a derived value is an order-of-magnitude miss. */
export const MAGNITUDE_FACTOR = 10;
export function reviewEstimates(definition: InterviewDefinition, session: InterviewSession): EstimateReview[] {
  const values = Object.fromEntries(definition.estimates.map(quantity => [quantity.id, parseNumber(session.estimates[quantity.id])]));
  return definition.estimates.map(quantity => {
    const value = values[quantity.id];
    if (value === null) return { quantity, value, expectedFromOwn: null, status: 'missing', note: 'Not estimated.' };
    if (quantity.role === 'assumption') return within(value, quantity.reference, quantity.factor)
      ? { quantity, value, expectedFromOwn: null, status: 'ok', note: `Within ×${quantity.factor} of the reference assumption (${quantity.reference.toLocaleString()} ${quantity.unit}).` }
      : { quantity, value, expectedFromOwn: null, status: 'outside-range', note: `Outside ×${quantity.factor} of the reference assumption (${quantity.reference.toLocaleString()} ${quantity.unit}). A different assumption can be valid if the clarifications support it; the derived values are checked against yours.` };
    const own = quantity.formula ? compute(quantity.formula, values) : null;
    if (own !== null && Math.abs(value - own) > Math.abs(own) * CONSISTENCY_TOLERANCE) return { quantity, value, expectedFromOwn: own, status: 'inconsistent', note: `Your own inputs give about ${Math.round(own).toLocaleString()} ${quantity.unit}; this value differs by more than ${CONSISTENCY_TOLERANCE * 100}%.` };
    if (!within(value, quantity.reference, MAGNITUDE_FACTOR)) return { quantity, value, expectedFromOwn: own, status: 'off-magnitude', note: `Consistent with your inputs${own === null ? ' (not all inputs given)' : ''}, but more than ${MAGNITUDE_FACTOR}× from the reference (${quantity.reference.toLocaleString()} ${quantity.unit}), so an assumption is likely off by an order of magnitude.` };
    return { quantity, value, expectedFromOwn: own, status: 'ok', note: own === null ? `Within ${MAGNITUDE_FACTOR}× of the reference; not checked against your inputs because some are missing.` : 'Consistent with your own assumptions and the right order of magnitude.' };
  });
}

// ── Architecture ───────────────────────────────────────────────────────────────
export function reviewArchitecture(definition: InterviewDefinition, session: InterviewSession): ArchitectureReview {
  const architecture = session.architecture;
  const empty: ArchitectureReview = { present: false, roles: definition.roles.map(role => ({ role, status: 'missing', score: 0, nodes: [], covered: [], missing: role.explain.map(concept => concept.label) })), validation: null,
    benchmark: { status: 'not-run', evidence: null, meets: { p95: null, success: null } }, unnecessary: [], findings: [{ basis: 'structural', tone: 'bad', text: 'No architecture was designed on the canvas.' }] };
  if (!architecture || !architecture.nodes.length) return empty;
  const labels = Object.fromEntries(architecture.nodes.map(node => [node.id, node.label || byKind[node.kind].label]));
  const validation = validateArchitecture({ nodes: architecture.nodes.map(node => ({ id: node.id, kind: node.kind, config: node.config })), edges: architecture.edges }, labels);
  const current = session.benchmark && session.benchmark.architectureKey === architectureKey(architecture) ? session.benchmark : null;
  const findings: ArchitectureReview['findings'] = [];
  const roles: RoleReview[] = definition.roles.map(role => {
    const nodes = architecture.nodes.filter(node => role.kinds.includes(node.kind)).map(node => ({ id: node.id, label: labels[node.id], kind: node.kind }));
    if (!nodes.length) return { role, status: 'missing', score: 0, nodes, covered: [], missing: role.explain.map(concept => concept.label) };
    // Used: carried requests in the measured run, or (without a current run) functional in static validation.
    // Passive components (dead-letter queues, telemetry sinks) never carry benchmark traffic, so they are judged structurally.
    const passive = role.kinds.every(kind => kind === 'deadLetterQueue' || TELEMETRY_KINDS.has(kind));
    const used = nodes.filter(node => current && !passive ? (current.processed[node.id] ?? 0) > 0 : validation.components[node.id]?.status === 'functional');
    if (!used.length) return { role, status: 'unused', score: 1, nodes, covered: [], missing: role.explain.map(concept => concept.label) };
    const note = used.map(node => [session.decisions[node.id] ?? '', ...Object.values(session.explanations[node.id] ?? {})].join('\n')).join('\n') + '\n' + session.designNotes;
    const checks = checkConcepts(note, role.explain); const covered = checks.filter(check => check.found).map(check => check.concept.label);
    const ratio = role.explain.length ? covered.length / role.explain.length : 1;
    const score = covered.length === 0 ? 2 : ratio < 1 ? 3 : 4;
    return { role, status: covered.length ? 'explained' : 'used', score, nodes: used, covered, missing: checks.filter(check => !check.found).map(check => check.concept.label) };
  });
  for (const issue of validation.issues.slice(0, 6)) findings.push({ basis: 'structural', tone: issue.severity === 'dead' ? 'bad' : 'warn', text: issue.message });
  if (!validation.issues.length) findings.push({ basis: 'structural', tone: 'ok', text: 'Every component is reachable and every connection carries traffic.' });
  const unnecessary = definition.unnecessary.map(entry => {
    const nodes = architecture.nodes.filter(node => entry.kinds.includes(node.kind));
    return { ...entry, nodes: nodes.map(node => labels[node.id]), justified: nodes.length > 0 && nodes.every(node => wordCount(session.decisions[node.id] ?? '') >= MIN_WORDS) };
  }).filter(entry => entry.nodes.length);
  for (const entry of unnecessary) findings.push({ basis: 'structural', tone: entry.justified ? 'warn' : 'bad', text: `${entry.nodes.join(', ')}: ${entry.why}${entry.justified ? ' You recorded a justification; it is not verified.' : ' No justification was recorded.'}` });
  let benchmark: ArchitectureReview['benchmark'] = { status: session.benchmark ? 'stale' : 'not-run', evidence: session.benchmark, meets: { p95: null, success: null } };
  if (current) {
    const { targets } = definition.benchmark;
    const p95 = current.complete && current.p95 !== null ? current.p95 <= targets.p95Ms : false; const success = current.complete && current.successPct >= targets.minSuccessPct;
    benchmark = { status: 'measured', evidence: current, meets: { p95, success } };
    findings.push({ basis: 'measured', tone: p95 && success ? 'ok' : 'bad', text: `Benchmark (${definition.benchmark.rps.toLocaleString()} req/s): p95 ${current.p95 ?? '—'} ms (target ≤ ${targets.p95Ms}), ${current.successPct.toFixed(1)}% succeeded (target ≥ ${targets.minSuccessPct}%).${current.busiest ? ` Busiest: ${current.busiest.label} at ${Math.round(current.busiest.utilization * 100)}%.` : ''}` });
    for (const failure of current.failures.slice(0, 3)) findings.push({ basis: 'measured', tone: 'warn', text: `${failure.count.toLocaleString()} requests failed at ${failure.label} (${failure.kind}).` });
  } else findings.push({ basis: 'measured', tone: 'warn', text: session.benchmark ? 'The benchmark was run on an earlier version of the architecture, so its results are not used.' : 'The benchmark was not run, so performance was not measured.' });
  return { present: true, roles, validation: { counts: validation.counts, issues: validation.issues }, benchmark, unnecessary, findings };
}

// ── Whole evaluation ───────────────────────────────────────────────────────────
type Draft = Omit<CriterionResult, 'weight' | 'uncertain' | 'resources' | 'critical'> & Partial<Pick<CriterionResult, 'uncertain' | 'uncertainReason' | 'resources' | 'critical'>>;
export function evaluate(definition: InterviewDefinition, session: InterviewSession): Evaluation {
  const drafts: Draft[] = [];
  const reqText = [session.requirements.functional, session.requirements.nonFunctional, session.requirements.scope, session.clarificationNotes].join('\n');
  // Requirements: each expected requirement is looked for anywhere in the requirement answers.
  const missedRequirements: Evaluation['missedRequirements'] = [];
  for (const kind of ['functional', 'non-functional'] as const) {
    const expected = definition.requirements.filter(entry => entry.kind === kind);
    const found = expected.filter(entry => mentions(reqText, entry.any)); const missing = expected.filter(entry => !found.includes(entry));
    missedRequirements.push(...missing.map(entry => ({ label: entry.label, why: entry.why, critical: entry.critical })));
    const criticalMissing = missing.filter(entry => entry.critical);
    let score = expected.length ? scaleFromRatio(found.length / expected.length) : 4;
    if (criticalMissing.length) score = Math.min(score, 2);
    drafts.push({ id: `req-${kind}`, label: kind === 'functional' ? 'Functional requirements identified' : 'Non-functional requirements identified', competency: 'clarification', score, basis: 'keyword',
      evidence: [...found.map(entry => ({ basis: 'keyword' as const, text: `Identified: ${entry.label}.`, positive: true })), ...(lines(kind === 'functional' ? session.requirements.functional : session.requirements.nonFunctional).length === 0 ? [{ basis: 'keyword' as const, text: `No ${kind} requirements were written.`, positive: false }] : [])],
      missed: missing.map(entry => entry.label), critical: criticalMissing.map(entry => entry.label) });
  }
  const important = definition.clarifications.filter(entry => entry.important);
  const askedImportant = important.filter(entry => session.clarificationsAsked.includes(entry.id));
  const scoped = wordCount(session.requirements.scope) >= 4 || wordCount(session.requirements.excluded) >= 2;
  drafts.push({ id: 'req-scope', label: 'Clarifying questions, scope and exclusions', competency: 'clarification', basis: 'structural',
    score: Math.max(0, scaleFromRatio(important.length ? askedImportant.length / important.length : 1) - (scoped ? 0 : 1)),
    evidence: [{ basis: 'structural', text: `Asked ${askedImportant.length} of ${important.length} important clarifying questions (${session.clarificationsAsked.length} questions asked in total).`, positive: askedImportant.length > 0 }, { basis: 'structural', text: scoped ? 'Scope or exclusions were stated.' : 'No scope or explicit exclusions were stated.', positive: scoped }],
    missed: important.filter(entry => !askedImportant.includes(entry)).map(entry => entry.question) });

  // Estimation: assumptions within documented ranges; derived values consistent with the user's own inputs.
  const estimates = reviewEstimates(definition, session);
  for (const role of ['assumption', 'derived'] as const) {
    const rows = estimates.filter(row => row.quantity.role === role); if (!rows.length) continue;
    const points = rows.reduce((sum, row) => sum + (row.status === 'ok' ? 1 : row.status === 'off-magnitude' || row.status === 'outside-range' ? 0.5 : 0), 0);
    drafts.push({ id: `est-${role}`, label: role === 'assumption' ? 'Workload assumptions' : 'Derived capacity (rates, storage, bandwidth)', competency: 'estimation', basis: 'arithmetic',
      score: rows.every(row => row.status === 'missing') ? 0 : scaleFromRatio(points / rows.length),
      evidence: rows.map(row => ({ basis: 'arithmetic' as const, text: `${row.quantity.label}: ${row.value === null ? 'not given' : `${row.value.toLocaleString()} ${row.quantity.unit}`}. ${row.note}`, positive: row.status === 'ok' })),
      missed: rows.filter(row => row.status !== 'ok').map(row => row.quantity.label) });
  }

  // API: required operations, then the considerations on the matching endpoints.
  const matchFor = (operation: InterviewDefinition['api'][number]) => session.endpoints.find(endpoint => operation.methods.includes(endpoint.method) && mentions(`${endpoint.path} ${endpoint.notes}`, operation.any));
  const required = definition.api.filter(operation => operation.required);
  const matched = definition.api.map(operation => ({ operation, endpoint: matchFor(operation) }));
  const requiredFound = matched.filter(entry => entry.operation.required && entry.endpoint);
  drafts.push({ id: 'api-operations', label: 'Required API operations', competency: 'api', basis: 'structural',
    score: scaleFromRatio(required.length ? requiredFound.length / required.length : 1),
    evidence: matched.filter(entry => entry.endpoint).map(entry => ({ basis: 'structural' as const, text: `${entry.operation.purpose}: ${entry.endpoint!.method} ${entry.endpoint!.path}.`, positive: true })),
    missed: required.filter(operation => !matchFor(operation)).map(operation => operation.purpose), critical: required.filter(operation => !matchFor(operation)).map(operation => operation.purpose) });
  const considerations = matched.flatMap(entry => entry.endpoint ? entry.operation.considerations.map(consideration => {
    const endpoint = entry.endpoint!; const check = consideration.check;
    const ok = 'flag' in check ? endpoint[check.flag] : mentions(check.text === 'any' ? [endpoint.request, endpoint.response, endpoint.errors, endpoint.notes].join(' ') : endpoint[check.text], check.any);
    return { consideration, operation: entry.operation, ok };
  }) : []);
  if (considerations.length || requiredFound.length) drafts.push({ id: 'api-considerations', label: 'API details (auth, idempotency, pagination, errors, payloads)', competency: 'api', basis: 'structural',
    score: considerations.length ? scaleFromRatio(considerations.filter(entry => entry.ok).length / considerations.length) : 2,
    evidence: considerations.map(entry => ({ basis: 'structural' as const, text: `${entry.operation.purpose}: ${entry.consideration.label} ${entry.ok ? 'addressed' : 'not addressed'}.${entry.ok ? '' : ` ${entry.consideration.why}`}`, positive: entry.ok })),
    missed: considerations.filter(entry => !entry.ok).map(entry => `${entry.operation.purpose}: ${entry.consideration.label}`) });

  // Data model: expected entities (by name) and their key fields; access patterns and consistency.
  const entityFor = (expectation: InterviewDefinition['entities'][number]) => session.entities.find(entity => mentions(entity.name, expectation.names));
  const entityRows = definition.entities.map(expectation => {
    const entity = entityFor(expectation);
    const fields = entity ? checkConcepts([entity.fields, entity.primaryKey, entity.indexes].join(' '), expectation.fields) : [];
    return { expectation, entity, fields };
  });
  const entityPoints = entityRows.filter(row => row.expectation.required).map(row => !row.entity ? 0 : 0.5 + 0.5 * (row.expectation.fields.length ? row.fields.filter(check => check.found).length / row.expectation.fields.length : 1));
  drafts.push({ id: 'data-entities', label: 'Entities and key fields', competency: 'data-model', basis: 'keyword',
    score: scaleFromRatio(entityPoints.length ? entityPoints.reduce((a, b) => a + b, 0) / entityPoints.length : 1),
    evidence: entityRows.filter(row => row.entity).map(row => ({ basis: 'keyword' as const, text: `${row.expectation.label} as “${row.entity!.name}”${row.fields.length ? `, with ${row.fields.filter(check => check.found).map(check => check.concept.label).join(', ') || 'none of the key fields'}` : ''}.`, positive: true })),
    missed: entityRows.flatMap(row => !row.entity ? (row.expectation.required ? [row.expectation.label] : []) : row.fields.filter(check => !check.found).map(check => `${row.expectation.label}: ${check.concept.label}`)),
    critical: entityRows.filter(row => row.expectation.required && !row.entity).map(row => row.expectation.label) });
  const modelText = session.entities.map(entity => [entity.indexes, entity.accessPatterns, entity.consistency, entity.relationships, entity.primaryKey].join(' ')).join('\n');
  for (const competency of ['data-model', 'consistency'] as const) {
    const concerns = definition.modelConcerns.filter(entry => entry.competency === competency); if (!concerns.length) continue;
    const found = concerns.filter(entry => mentions(modelText, entry.any));
    drafts.push({ id: competency === 'data-model' ? 'data-access' : 'data-consistency', label: competency === 'data-model' ? 'Access patterns and indexing' : 'Consistency and storage choices', competency, basis: 'keyword',
      score: scaleFromRatio(found.length / concerns.length), evidence: found.map(entry => ({ basis: 'keyword' as const, text: `Addressed: ${entry.label}.`, positive: true })),
      missed: concerns.filter(entry => !found.includes(entry)).map(entry => `${entry.label}: ${entry.why}`) });
  }

  // Architecture: roles (presence earns at most 1 point; use and explanation earn the rest), structure, benchmark.
  const architecture = reviewArchitecture(definition, session);
  const scored = architecture.roles.filter(review => review.role.required || review.status !== 'missing');
  drafts.push({ id: 'arch-roles', label: 'Components serve the requirements, and are explained', competency: 'architecture', basis: 'structural',
    score: architecture.present ? Math.round(scored.reduce((sum, review) => sum + review.score, 0) / Math.max(1, scored.length)) : 0,
    evidence: architecture.roles.filter(review => review.status !== 'missing').map(review => ({ basis: 'structural' as const, text: `${review.role.label}: ${review.nodes.map(node => node.label).join(', ')} — ${review.status === 'unused' ? 'present but carries no traffic' : review.status === 'used' ? 'in the request path, but the decision note does not explain it' : `explained (${review.covered.join(', ')})`}.`, positive: review.score >= 3 })),
    missed: architecture.roles.flatMap(review => review.status === 'missing' ? (review.role.required ? [`${review.role.label}: ${review.role.why}`] : []) : review.missing.map(label => `${review.role.label}: explain ${label}`)),
    critical: architecture.roles.filter(review => review.role.required && review.status === 'missing').map(review => review.role.label),
    resources: definition.lld.map(kind => ({ type: 'lld' as const, kind })) });
  const counts = architecture.validation?.counts;
  drafts.push({ id: 'arch-structure', label: 'Connected, valid request flow', competency: 'architecture', basis: 'structural',
    score: !architecture.present ? 0 : !session.architecture!.nodes.some(node => node.kind === 'client') ? 1 : counts!.dead > 0 ? 1 : counts!.warning > 0 ? 3 : 4,
    evidence: architecture.findings.filter(finding => finding.basis === 'structural').map(finding => ({ basis: 'structural' as const, text: finding.text, positive: finding.tone === 'ok' })), missed: [] });
  const bench = architecture.benchmark;
  drafts.push({ id: 'arch-benchmark', label: `Meets the benchmark (${definition.benchmark.description})`, competency: 'scalability', basis: 'measured',
    score: bench.status !== 'measured' ? null : bench.meets.p95 && bench.meets.success ? 4 : bench.meets.p95 || bench.meets.success ? 2 : 1,
    evidence: architecture.findings.filter(finding => finding.basis === 'measured').map(finding => ({ basis: 'measured' as const, text: finding.text, positive: finding.tone === 'ok' })),
    missed: bench.status === 'measured' ? [...(bench.meets.p95 ? [] : ['p95 latency target']), ...(bench.meets.success ? [] : ['success-rate target'])] : ['Run the benchmark on the final architecture to measure it.'],
    resources: [{ type: 'lesson', id: 'bottlenecks' }, { type: 'experiment', id: 'find-the-bottleneck' }] });

  // Deep dives (only those answered) and follow-ups (every one that was asked).
  const answeredDeep = definition.deepDives.filter(prompt => (session.deepDives[prompt.id] ?? '').trim());
  if (!answeredDeep.length) drafts.push({ id: 'deep-none', label: 'Deep dives', competency: 'tradeoffs', score: 0, basis: 'keyword', evidence: [{ basis: 'keyword', text: 'No deep-dive topic was answered.', positive: false }], missed: definition.deepDives.map(prompt => prompt.title) });
  const prompt = (entry: Prompt, idPrefix: string, text: string): Draft => { const result = scoreText(text, entry.concepts, entry.contradictions); return { id: `${idPrefix}-${entry.id}`, label: entry.title, competency: entry.competency, basis: 'keyword', score: result.score, evidence: result.evidence, missed: result.missed, uncertain: result.uncertain, uncertainReason: result.uncertainReason, resources: entry.resources }; };
  for (const entry of answeredDeep) drafts.push(prompt(entry, 'deep', session.deepDives[entry.id]));
  const active = activeFollowUps(definition, session).filter(item => session.followUps[item.followUp.id]);
  for (const { followUp } of active) {
    const draft = prompt(followUp, 'fu', session.followUps[followUp.id].answer);
    const run = session.scenarioRuns[followUp.id];
    if (run) {
      draft.evidence.push({ basis: 'measured', text: `Scenario run on your design (${run.label}): p95 ${run.p95 ?? '—'} ms, ${run.successPct.toFixed(1)}% succeeded${run.busiest ? `, busiest ${run.busiest.label} at ${Math.round(run.busiest.utilization * 100)}%` : ''}.`, positive: run.successPct >= definition.benchmark.targets.minSuccessPct });
      // A load scenario measures which component saturates; an answer that names a different one is contradicted by the measurement.
      const busiestNode = run.busiest ? session.architecture?.nodes.find(node => (node.label || byKind[node.kind].label) === run.busiest!.label) : undefined;
      if (followUp.scenario?.kind === 'traffic' && run.complete && run.busiest && run.busiest.utilization >= 0.85 && run.architectureKey === architectureKey(session.architecture)) {
        const named = mentions(session.followUps[followUp.id].answer, [run.busiest.label, ...(busiestNode ? [byKind[busiestNode.kind].label] : [])]);
        draft.evidence.push({ basis: 'measured', text: named ? `Your answer names the component the run measured as the bottleneck (${run.busiest.label}).` : `The run measured ${run.busiest.label} as the bottleneck (${Math.round(run.busiest.utilization * 100)}% busy); your answer does not name it.`, positive: named });
        if (!named && draft.score !== null) draft.score = Math.min(draft.score, 3);
      }
    }
    drafts.push(draft);
  }

  // Decision reasoning: the rubric in reasoning.ts, per major decision. Presence of each part is checked; correctness needs review.
  const decisions = assessDecisions(definition, session);
  if (decisions.length) drafts.push({ id: 'decision-reasoning', label: 'Reasoning behind major decisions', competency: 'tradeoffs', basis: 'keyword',
    score: Math.round(decisions.reduce((sum, entry) => sum + entry.score, 0) / decisions.length),
    evidence: decisions.flatMap(entry => entry.dimensions.filter(dim => dim.met).map(dim => ({ basis: dim.basis, text: `${entry.label}: ${dim.label.toLowerCase()} — ${dim.note}`, positive: true }))).concat(decisions.filter(entry => entry.dimensions.every(dim => !dim.met)).map(entry => ({ basis: 'structural' as const, text: `${entry.label}: no explanation recorded.`, positive: false }))),
    missed: decisions.flatMap(entry => entry.dimensions.filter(dim => !dim.met).map(dim => `${entry.label}: ${dim.label.toLowerCase()}`)),
    uncertain: decisions.some(entry => entry.uncertain), uncertainReason: decisions.some(entry => entry.uncertain) ? `Long explanations for ${decisions.filter(entry => entry.uncertain).map(entry => entry.label).join(', ')} met few rubric checks; different phrasing may have been missed.` : undefined,
    manualReview: 'The rules check that each decision states its problem, approach, alternatives, trade-offs, failure modes and evidence, and that cited numbers match your estimates or measurements. They cannot tell whether the reasoning is correct: compare it with the reference and correct the score if needed.',
    resources: [{ type: 'lesson', id: 'approach' }, ...definition.lld.slice(0, 2).map(kind => ({ type: 'lld' as const, kind }))] });
  else if (session.architecture?.nodes.length) drafts.push({ id: 'decision-reasoning', label: 'Reasoning behind major decisions', competency: 'tradeoffs', basis: 'structural', score: 0, evidence: [{ basis: 'structural', text: 'No component in the design fills one of this problem’s roles, so there is no major decision to explain.', positive: false }], missed: definition.roles.filter(role => role.required).map(role => role.label) });

  // Requirement changes: the written response (keyword rubric), whether the design was revised, and measured results when comparable.
  const changeResults: NonNullable<Evaluation['changes']> = [];
  for (const change of definition.changes ?? []) {
    const comparison = compareChange(definition, session, change);
    const { response, baseline, revision, change: _change, ...rest } = comparison;
    changeResults.push({ ...rest, id: change.id, title: change.title, introduced: Boolean(response), baselineId: baseline?.id, revisionId: revision?.id });
    if (!response) continue;
    const result = scoreText(response.answer, change.considerations, change.contradictions);
    const evidence = [...result.evidence];
    const changedCount = comparison.diff ? comparison.diff.components.length + comparison.diff.connectionsAdded.length + comparison.diff.connectionsRemoved.length : 0;
    evidence.push({ basis: 'structural', text: !revision ? 'No revised design was saved for this change.' : changedCount ? `The revised design differs from the original in ${changedCount} place${changedCount === 1 ? '' : 's'}.` : 'The revised design is identical to the original.', positive: Boolean(revision && changedCount) });
    let score = result.score;
    if (comparison.comparable) {
      evidence.push({ basis: 'measured', text: `Under the change: original p95 ${comparison.original!.p95 ?? '—'} ms, ${comparison.original!.successPct.toFixed(1)}% succeeded; revised p95 ${comparison.revised!.p95 ?? '—'} ms, ${comparison.revised!.successPct.toFixed(1)}% succeeded (targets p95 ≤ ${comparison.targets.p95Ms} ms, ≥ ${comparison.targets.minSuccessPct}%).`, positive: Boolean(comparison.meets.revised) });
      // A revision that the measurement shows still misses the changed targets cannot be rated solid.
      if (comparison.meets.revised === false) score = Math.min(score, 2);
    } else evidence.push({ basis: comparison.mode === 'measured' ? 'measured' : 'keyword', text: comparison.notComparable!, positive: false });
    drafts.push({ id: `change-${change.id}`, label: `Requirement change: ${change.title}`, competency: change.competency, basis: 'keyword', score, evidence, missed: result.missed, uncertain: result.uncertain, uncertainReason: result.uncertainReason,
      manualReview: comparison.mode === 'hypothetical' ? 'The simulator cannot model this change; the response is checked for the expected considerations only.' : undefined, resources: change.resources });
  }
  if (definition.changes?.length && !changeResults.some(entry => entry.introduced)) drafts.push({ id: 'changes-none', label: 'Requirement changes', competency: 'tradeoffs', score: 0, basis: 'structural', evidence: [{ basis: 'structural', text: 'No requirement change was taken on.', positive: false }], missed: definition.changes.map(change => change.title) });

  // Trade-offs: across all written answers, plus unjustified unnecessary complexity.
  const allText = ['requirements', 'estimation', 'api', 'data', 'design', 'deepdive', 'followups', 'changes', 'review'].map(stage => stageText(session, stage as StageId)).join('\n');
  const tradeoffChecks = checkConcepts(allText, definition.tradeoffs);
  const unjustified = architecture.unnecessary.filter(entry => !entry.justified).length;
  drafts.push({ id: 'tradeoffs', label: 'Trade-offs discussed', competency: 'tradeoffs', basis: 'keyword',
    score: Math.max(0, scaleFromRatio(definition.tradeoffs.length ? tradeoffChecks.filter(check => check.found).length / definition.tradeoffs.length : 1) - unjustified),
    evidence: [...tradeoffChecks.filter(check => check.found).map(check => ({ basis: 'keyword' as const, text: `Discussed ${check.concept.label}.`, positive: true })), ...architecture.unnecessary.filter(entry => !entry.justified).map(entry => ({ basis: 'structural' as const, text: `Unjustified complexity: ${entry.nodes.join(', ')}.`, positive: false }))],
    missed: tradeoffChecks.filter(check => !check.found).map(check => check.concept.label) });

  // Communication: the final summary is complete and components are explained.
  const reviewSections = Object.entries(session.review); const filled = reviewSections.filter(([, text]) => wordCount(text) >= 12);
  const explainable = (session.architecture?.nodes ?? []).filter(node => node.kind !== 'client' && !TELEMETRY_KINDS.has(node.kind));
  const explained = explainable.filter(node => wordCount(session.decisions[node.id] ?? '') >= 5);
  const decisionShare = explainable.length ? explained.length / explainable.length : 0;
  drafts.push({ id: 'communication', label: 'Final summary and explained decisions', competency: 'communication', basis: 'structural',
    score: scaleFromRatio((filled.length / reviewSections.length) * 0.6 + decisionShare * 0.4),
    evidence: [{ basis: 'structural', text: `${filled.length} of ${reviewSections.length} summary sections have at least 12 words.`, positive: filled.length === reviewSections.length }, { basis: 'structural', text: `${explained.length} of ${explainable.length} components have a decision note.`, positive: decisionShare >= 0.6 }],
    missed: reviewSections.filter(([, text]) => wordCount(text) < 12).map(([key]) => `Summary: ${key}`) });

  const criteria: CriterionResult[] = drafts.map(draft => ({ ...draft, weight: definition.weights?.[draft.id] ?? 1, uncertain: draft.uncertain ?? false, resources: draft.resources ?? [], critical: draft.critical ?? [] }));
  const failures = followUpPool(definition).filter(entry => entry.competency === 'reliability');
  return {
    version: EVALUATOR_VERSION, definitionId: definition.id, definitionVersion: definition.version, criteria, ...totals(criteria),
    missedRequirements, estimates, architecture,
    followUps: activeFollowUps(definition, session).map(item => ({ id: item.followUp.id, title: item.followUp.title, answered: Boolean(session.followUps[item.followUp.id]?.answer.trim()) })),
    untouchedTradeoffs: tradeoffChecks.filter(check => !check.found).map(check => check.concept.label),
    overlookedFailures: failures.filter(entry => !(session.followUps[entry.id]?.answer.trim())).filter(entry => !mentions(allText, entry.concepts.flatMap(concept => concept.any))).map(entry => entry.title),
    usage: { hints: session.hintsUsed.length, references: session.referencesViewed.length, mode: session.mode, overtime: session.durationMin !== null && session.timing.totalMs >= session.durationMin * 60_000 },
    decisions, whiteboard: reviewWhiteboard(definition, session, decisions), changes: changeResults,
  };
}

/** Overall and per-competency results from criterion scores (not-assessed criteria are excluded). */
export function totals(criteria: CriterionResult[]): Pick<Evaluation, 'competencies' | 'overall'> {
  const assessed = criteria.filter(criterion => criterion.score !== null);
  const weight = assessed.reduce((sum, criterion) => sum + criterion.weight, 0);
  const points = assessed.reduce((sum, criterion) => sum + criterion.weight * (criterion.score as number), 0);
  const ids = [...new Set(criteria.map(criterion => criterion.competency))];
  return {
    overall: { percent: weight ? Math.round(points / (weight * 4) * 100) : 0, assessed: assessed.length, notAssessed: criteria.length - assessed.length },
    competencies: (Object.keys(COMPETENCY_LABELS) as CompetencyId[]).filter(id => ids.includes(id)).map(id => {
      const own = assessed.filter(criterion => criterion.competency === id); const w = own.reduce((sum, criterion) => sum + criterion.weight, 0);
      const score = w ? own.reduce((sum, criterion) => sum + criterion.weight * (criterion.score as number), 0) / w : null;
      return { id, label: COMPETENCY_LABELS[id], score: score === null ? null : Math.round(score * 100) / 100, percent: score === null ? null : Math.round(score / 4 * 100), criteria: criteria.filter(criterion => criterion.competency === id).length };
    }),
  };
}
/** A user correction: stored apart from the record; the automatic result is never rewritten. */
export type Correction = { criterionId: string; at: number; score: number | null; uncertain: boolean; note: string };
/** Applies the latest correction per criterion, returning a separate, labelled evaluation view. */
export function withCorrections(evaluation: Evaluation, corrections: Correction[]): Evaluation & { corrected: string[] } {
  const latest = new Map<string, Correction>(); for (const correction of corrections) latest.set(correction.criterionId, correction);
  const criteria = evaluation.criteria.map(criterion => { const correction = latest.get(criterion.id); return correction ? { ...criterion, score: correction.score ?? criterion.score, uncertain: correction.uncertain } : criterion; });
  return { ...evaluation, criteria, ...totals(criteria), corrected: [...latest.values()].filter(correction => correction.score !== null).map(correction => correction.criterionId) };
}
