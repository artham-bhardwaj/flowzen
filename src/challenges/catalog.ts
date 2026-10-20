import { DIFFICULTIES, DIFFICULTY_POINTS, type Challenge, type Difficulty } from './definitions';
import { statusOf, type ChallengeStatus, type Progress } from './progress';

/** Catalog filters: each facet is a set of selected values; an empty set means "any". */
export type CatalogFilters = { levels: Difficulty[]; statuses: ChallengeStatus[]; topics: string[]; durations: DurationBucket[] };
export type DurationBucket = 'short' | 'medium' | 'long';
export type CatalogSort = 'recommended' | 'shortest' | 'points' | 'difficulty';
export const EMPTY_FILTERS: CatalogFilters = { levels: [], statuses: [], topics: [], durations: [] };

export const LEVEL_LABELS: Record<Difficulty, string> = { easy: 'Beginner friendly', medium: 'Intermediate', hard: 'Advanced', expert: 'Expert' };
export const DURATION_LABELS: Record<DurationBucket, string> = { short: 'Under 15 minutes', medium: '15–25 minutes', long: 'Over 25 minutes' };
export const STATUS_LABELS: Record<ChallengeStatus, string> = { new: 'Not started', attempted: 'Attempted', solved: 'Solved', locked: 'Locked' };
export const durationOf = (challenge: Challenge): DurationBucket => challenge.estimatedMinutes < 15 ? 'short' : challenge.estimatedMinutes <= 25 ? 'medium' : 'long';

const searchText = (challenge: Challenge) => [challenge.title, challenge.summary, LEVEL_LABELS[challenge.difficulty], challenge.difficulty, ...challenge.topics, ...challenge.learningObjectives].join(' ').toLowerCase();

/** Applies search and filters. Facets combine with AND; values within a facet combine with OR. */
export function filterCatalog(list: Challenge[], progress: Progress, filters: CatalogFilters, query: string, ignore?: keyof CatalogFilters): Challenge[] {
  const needle = query.trim().toLowerCase();
  return list.filter(challenge =>
    (!needle || searchText(challenge).includes(needle))
    && (ignore === 'levels' || !filters.levels.length || filters.levels.includes(challenge.difficulty))
    && (ignore === 'statuses' || !filters.statuses.length || filters.statuses.includes(statusOf(progress, challenge, list)))
    && (ignore === 'topics' || !filters.topics.length || challenge.topics.some(topic => filters.topics.includes(topic)))
    && (ignore === 'durations' || !filters.durations.length || filters.durations.includes(durationOf(challenge))));
}

const STATUS_ORDER: Record<ChallengeStatus, number> = { attempted: 0, new: 1, solved: 2, locked: 3 };
/** Recommended: in-progress first, then what is open to start, then solved, then locked; by difficulty and number within each. */
export function sortCatalog(list: Challenge[], progress: Progress, sort: CatalogSort, all: Challenge[] = list): Challenge[] {
  const level = (challenge: Challenge) => DIFFICULTIES.indexOf(challenge.difficulty);
  const byNumber = (a: Challenge, b: Challenge) => a.number - b.number;
  const sorted = [...list];
  if (sort === 'shortest') return sorted.sort((a, b) => a.estimatedMinutes - b.estimatedMinutes || byNumber(a, b));
  if (sort === 'points') return sorted.sort((a, b) => DIFFICULTY_POINTS[b.difficulty] - DIFFICULTY_POINTS[a.difficulty] || byNumber(a, b));
  if (sort === 'difficulty') return sorted.sort((a, b) => level(a) - level(b) || byNumber(a, b));
  return sorted.sort((a, b) => STATUS_ORDER[statusOf(progress, a, all)] - STATUS_ORDER[statusOf(progress, b, all)] || level(a) - level(b) || byNumber(a, b));
}

/** Result counts per facet value, computed with every other active filter applied (so counts predict the result). */
export function facetCounts(list: Challenge[], progress: Progress, filters: CatalogFilters, query: string) {
  const count = <T extends string>(facet: keyof CatalogFilters, values: readonly T[], match: (challenge: Challenge, value: T) => boolean) => {
    const pool = filterCatalog(list, progress, filters, query, facet);
    return Object.fromEntries(values.map(value => [value, pool.filter(challenge => match(challenge, value)).length])) as Record<T, number>;
  };
  const topics = [...new Set(list.flatMap(challenge => challenge.topics))].sort((a, b) => a.localeCompare(b));
  return {
    levels: count('levels', DIFFICULTIES, (challenge, value) => challenge.difficulty === value),
    statuses: count('statuses', ['new', 'attempted', 'solved', 'locked'] as const, (challenge, value) => statusOf(progress, challenge, list) === value),
    topics: count('topics', topics, (challenge, value) => challenge.topics.includes(value)),
    durations: count('durations', ['short', 'medium', 'long'] as const, (challenge, value) => durationOf(challenge) === value),
    topicList: topics,
  };
}

/** The first open challenge to suggest: one in progress, else the first unlocked unsolved one. */
export function nextUp(list: Challenge[], progress: Progress): Challenge | null {
  return sortCatalog(list, progress, 'recommended').find(challenge => { const status = statusOf(progress, challenge, list); return status === 'attempted' || status === 'new'; }) ?? null;
}
