import { withCorrections, type Evaluation } from './evaluate';
import type { InterviewState, InterviewRecord } from './store';
import { COMPETENCY_LABELS, type CompetencyId, type InterviewDefinition, type Resource } from './types';

/**
 * Dashboard statistics, computed only from completed records. With no history, everything is empty or null; nothing
 * is estimated or invented. Corrections are applied in a separately labelled view (`corrected`).
 */
export const evaluationOf = (state: InterviewState, record: InterviewRecord): Evaluation => state.corrections[record.id]?.length ? withCorrections(record.evaluation, state.corrections[record.id]) : record.evaluation;

export type Stats = {
  completed: number; averagePercent: number | null;
  competencies: Array<{ id: CompetencyId; label: string; average: number | null; sessions: number; trend: number[] }>;
  recent: InterviewRecord[];
  best: Array<{ definitionId: string; title: string; percent: number; recordId: string }>;
  recurringMistakes: Array<{ label: string; count: number }>;
  practiced: string[]; needsWork: CompetencyId[]; strong: CompetencyId[];
};
export const WEAK_THRESHOLD = 2.5;
export const STRONG_THRESHOLD = 3.25;
export function stats(state: InterviewState): Stats {
  const records = [...state.records].sort((a, b) => a.completedAt - b.completedAt);
  const evaluations = records.map(record => ({ record, evaluation: evaluationOf(state, record) }));
  const competencies = (Object.keys(COMPETENCY_LABELS) as CompetencyId[]).map(id => {
    const trend = evaluations.flatMap(({ evaluation }) => { const entry = evaluation.competencies.find(item => item.id === id); return entry?.score !== null && entry?.score !== undefined ? [entry.score] : []; });
    return { id, label: COMPETENCY_LABELS[id], average: trend.length ? Math.round(trend.reduce((a, b) => a + b, 0) / trend.length * 100) / 100 : null, sessions: trend.length, trend };
  });
  // A mistake is "recurring" when the same missed item appears in two or more completed interviews.
  const counts = new Map<string, number>();
  for (const { evaluation } of evaluations) for (const label of new Set(evaluation.criteria.flatMap(criterion => criterion.missed.map(missed => `${criterion.label}: ${missed}`)))) counts.set(label, (counts.get(label) ?? 0) + 1);
  const best = new Map<string, Stats['best'][number]>();
  for (const { record, evaluation } of evaluations) { const current = best.get(record.definitionId); if (!current || evaluation.overall.percent > current.percent) best.set(record.definitionId, { definitionId: record.definitionId, title: record.title, percent: evaluation.overall.percent, recordId: record.id }); }
  return {
    completed: records.length,
    averagePercent: evaluations.length ? Math.round(evaluations.reduce((sum, { evaluation }) => sum + evaluation.overall.percent, 0) / evaluations.length) : null,
    competencies, recent: [...records].reverse().slice(0, 6), best: [...best.values()].sort((a, b) => b.percent - a.percent),
    recurringMistakes: [...counts].filter(([, count]) => count >= 2).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8),
    practiced: [...new Set(records.map(record => record.title))],
    needsWork: competencies.filter(entry => entry.average !== null && entry.average < WEAK_THRESHOLD).sort((a, b) => (a.average ?? 0) - (b.average ?? 0)).map(entry => entry.id),
    strong: competencies.filter(entry => entry.average !== null && entry.average >= STRONG_THRESHOLD).map(entry => entry.id),
  };
}

/** For each competency: where to learn it in the rest of Flowzen (lessons, components, LLD, an experiment). */
export const COMPETENCY_RESOURCES: Record<CompetencyId, Resource[]> = {
  clarification: [{ type: 'lesson', id: 'requirements' }, { type: 'lesson', id: 'approach' }, { type: 'lesson', id: 'slis-slos' }],
  estimation: [{ type: 'lesson', id: 'capacity-estimation' }, { type: 'lesson', id: 'performance-metrics' }, { type: 'experiment', id: 'latency-under-load' }],
  api: [{ type: 'component', kind: 'gateway' }, { type: 'lld', kind: 'gateway' }, { type: 'component', kind: 'rateLimiter' }],
  'data-model': [{ type: 'component', kind: 'database' }, { type: 'component', kind: 'nosql' }, { type: 'lld', kind: 'database' }],
  architecture: [{ type: 'lesson', id: 'approach' }, { type: 'lesson', id: 'horizontal-vertical' }, { type: 'component', kind: 'loadBalancer' }, { type: 'lld', kind: 'loadBalancer' }],
  scalability: [{ type: 'lesson', id: 'bottlenecks' }, { type: 'lesson', id: 'why-caching' }, { type: 'experiment', id: 'find-the-bottleneck' }, { type: 'experiment', id: 'cache-vs-database' }],
  reliability: [{ type: 'lesson', id: 'horizontal-vertical' }, { type: 'component', kind: 'circuitBreaker' }, { type: 'lld', kind: 'circuitBreaker' }, { type: 'experiment', id: 'circuit-breaker' }],
  consistency: [{ type: 'lesson', id: 'stateful-stateless' }, { type: 'component', kind: 'readReplica' }, { type: 'lesson', id: 'why-caching' }],
  tradeoffs: [{ type: 'lesson', id: 'sync-async' }, { type: 'lesson', id: 'why-caching' }, { type: 'experiment', id: 'sync-vs-async' }],
  communication: [{ type: 'lesson', id: 'approach' }, { type: 'lesson', id: 'requirements' }],
};
/** Problems that exercise a competency strongly (by category and rubric), for "recommended follow-up interview". */
export function suggestInterview(problems: InterviewDefinition[], state: InterviewState, focus: CompetencyId | null, exclude?: string): InterviewDefinition | null {
  const done = new Set(state.records.map(record => record.definitionId));
  const relevant = (problem: InterviewDefinition) => !focus ? 1
    : [...problem.deepDives, ...problem.followUps].filter(prompt => prompt.competency === focus).length + (focus === 'estimation' ? problem.estimates.length / 3 : 0) + (focus === 'api' ? problem.api.length / 2 : 0) + (focus === 'data-model' ? problem.entities.length : 0);
  const order = ['beginner', 'intermediate', 'advanced', 'expert'];
  const candidates = problems.filter(problem => problem.id !== exclude).sort((a, b) => Number(done.has(a.id)) - Number(done.has(b.id)) || relevant(b) - relevant(a) || order.indexOf(a.difficulty) - order.indexOf(b.difficulty));
  return candidates[0] ?? null;
}
/** Recommendations for the weakest competencies of one evaluation, or of the whole history. */
export function recommendations(evaluation: Evaluation | null, history: Stats | null, problems: InterviewDefinition[], state: InterviewState, currentId?: string) {
  const weak: CompetencyId[] = evaluation
    ? evaluation.competencies.filter(entry => entry.score !== null && entry.score < WEAK_THRESHOLD).sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).map(entry => entry.id)
    : history?.needsWork ?? [];
  return weak.slice(0, 4).map(id => {
    const criterionResources = evaluation ? evaluation.criteria.filter(criterion => criterion.competency === id && (criterion.score ?? 4) < 3).flatMap(criterion => criterion.resources) : [];
    const seen = new Set<string>(); const resources = [...criterionResources, ...COMPETENCY_RESOURCES[id]].filter(resource => { const key = JSON.stringify(resource); if (seen.has(key)) return false; seen.add(key); return true; });
    return { competency: id, label: COMPETENCY_LABELS[id], resources, interview: suggestInterview(problems, state, id, currentId) };
  });
}
