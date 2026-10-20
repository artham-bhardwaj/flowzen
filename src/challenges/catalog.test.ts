import { describe, expect, it } from 'vitest';
import { challenges } from './definitions';
import { EMPTY_FILTERS, durationOf, facetCounts, filterCatalog, nextUp, sortCatalog } from './catalog';
import { emptyProgress, recordAttempt } from './progress';
import type { Grade } from './grading';

const fakeGrade = (challengeId: string, passed: boolean): Grade => ({ challengeId, passed, invalidReason: null, findings: [], mainBottleneck: null, validation: { counts: { functional: 1, warning: 0, dead: 0 }, issues: [] }, criteria: [], summary: null });

describe('challenge catalog', () => {
  it('has at least ten challenges across all four levels', () => {
    expect(challenges.length).toBeGreaterThanOrEqual(10);
    expect(new Set(challenges.map(challenge => challenge.difficulty))).toEqual(new Set(['easy', 'medium', 'hard', 'expert']));
    expect(new Set(challenges.map(challenge => challenge.id)).size).toBe(challenges.length);
    expect(new Set(challenges.map(challenge => challenge.number)).size).toBe(challenges.length);
  });
  it('filters by search, level, status, topic and time, combining facets with AND and values with OR', () => {
    const progress = emptyProgress();
    expect(filterCatalog(challenges, progress, EMPTY_FILTERS, '')).toHaveLength(challenges.length);
    expect(filterCatalog(challenges, progress, EMPTY_FILTERS, 'cdn').map(challenge => challenge.id)).toEqual(['go-global']);
    expect(filterCatalog(challenges, progress, { ...EMPTY_FILTERS, levels: ['easy', 'expert'] }, '').every(challenge => ['easy', 'expert'].includes(challenge.difficulty))).toBe(true);
    const caching = filterCatalog(challenges, progress, { ...EMPTY_FILTERS, topics: ['Caching'] }, '');
    expect(caching.length).toBeGreaterThan(1); expect(caching.every(challenge => challenge.topics.includes('Caching'))).toBe(true);
    const combined = filterCatalog(challenges, progress, { ...EMPTY_FILTERS, topics: ['Caching'], levels: ['easy'] }, '');
    expect(combined.every(challenge => challenge.difficulty === 'easy' && challenge.topics.includes('Caching'))).toBe(true);
    expect(filterCatalog(challenges, progress, { ...EMPTY_FILTERS, statuses: ['locked'] }, '').every(challenge => challenge.difficulty !== 'easy')).toBe(true);
    expect(filterCatalog(challenges, progress, { ...EMPTY_FILTERS, durations: ['short'] }, '').every(challenge => durationOf(challenge) === 'short')).toBe(true);
  });
  it('counts each facet value against the other active filters', () => {
    const progress = emptyProgress();
    const counts = facetCounts(challenges, progress, { ...EMPTY_FILTERS, levels: ['easy'] }, '');
    // Level counts ignore the level filter itself, so every level still shows its total.
    expect(counts.levels.medium).toBe(challenges.filter(challenge => challenge.difficulty === 'medium').length);
    // Other facets are counted within the selected level.
    expect(counts.statuses.new).toBe(challenges.filter(challenge => challenge.difficulty === 'easy').length);
    expect(counts.statuses.locked).toBe(0);
  });
  it('recommends in-progress work first and suggests what to do next', () => {
    let progress = recordAttempt(emptyProgress(), fakeGrade('cache-it-right', false), 1);
    expect(sortCatalog(challenges, progress, 'recommended')[0].id).toBe('cache-it-right');
    expect(nextUp(challenges, progress)?.id).toBe('cache-it-right');
    progress = recordAttempt(progress, fakeGrade('cache-it-right', true), 2);
    const next = nextUp(challenges, progress)!;
    expect(next.id).not.toBe('cache-it-right');
    const shortest = sortCatalog(challenges, progress, 'shortest');
    expect(shortest.map(challenge => challenge.estimatedMinutes)).toEqual([...shortest.map(challenge => challenge.estimatedMinutes)].sort((a, b) => a - b));
    expect(sortCatalog(challenges, progress, 'points')[0].difficulty).toBe('expert');
  });
});
