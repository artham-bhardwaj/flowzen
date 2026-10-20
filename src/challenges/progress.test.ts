import { describe, expect, it } from 'vitest';
import { challenges } from './definitions';
import type { Grade } from './grading';
import { HISTORY_SIZE, STORAGE_KEY, clearDraft, emptyProgress, isUnlocked, loadProgress, pointsFor, recordAttempt, saveDraft, saveProgress, statusOf, type Draft } from './progress';

const memory = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data }; };
const fakeGrade = (challengeId: string, passed: boolean, p95 = 50, passedCount = passed ? 3 : 1): Grade => ({
  challengeId, passed, invalidReason: null, findings: [], mainBottleneck: null, validation: { counts: { functional: 1, warning: 0, dead: 0 }, issues: [] },
  criteria: Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, label: '', mandatory: true, category: 'runtime', status: i < passedCount ? 'pass' : 'fail', measured: i, threshold: 0, comparator: '<=', unit: '', missedBy: i < passedCount ? null : i, detail: '' })),
  summary: { offeredRequests: 10, offeredRps: 1, completedRequests: 10, failedRequests: 0, successThroughput: 1, errorRate: 0, p50: 10, p95, p99: 80, utilization: [] },
});
const byId = (id: string) => challenges.find(challenge => challenge.id === id)!;

describe('challenge progress', () => {
  it('saves and reloads progress and drafts, and recovers from corrupt storage', () => {
    const storage = memory();
    let progress = recordAttempt(emptyProgress(), fakeGrade('slow-api', true), 1000);
    progress = saveDraft(progress, 'slow-api', { nodes: [{ id: 'a', kind: 'client', label: 'A', config: {}, position: { x: 1, y: 2 } }], edges: [] });
    expect(saveProgress(progress, storage)).toBe(true);
    expect(loadProgress(storage)).toEqual(progress);
    storage.setItem(STORAGE_KEY, '{not json'); expect(loadProgress(storage)).toEqual(emptyProgress());
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 })); expect(loadProgress(storage)).toEqual(emptyProgress());
    expect(saveProgress(progress, { getItem: () => null, setItem: () => { throw new Error('quota'); } })).toBe(false);
  });

  it('marks failed attempts as attempted, not solved, and keeps a solve once earned', () => {
    let progress = recordAttempt(emptyProgress(), fakeGrade('slow-api', false), 1);
    expect(statusOf(progress, byId('slow-api'))).toBe('attempted'); expect(pointsFor(progress)).toBe(0);
    progress = recordAttempt(progress, fakeGrade('slow-api', true, 60), 2);
    progress = recordAttempt(progress, fakeGrade('slow-api', false), 3);
    const entry = progress.challenges['slow-api'];
    expect(entry).toMatchObject({ attempts: 3, solved: true, solvedAt: 2 });
    expect(entry.best).toMatchObject({ passed: true, at: 2 }); expect(entry.last!.at).toBe(3); expect(entry.previous!.at).toBe(2);
    expect(statusOf(progress, byId('slow-api'))).toBe('solved');
  });

  it('keeps the best attempt by pass, then criteria met, then p95', () => {
    let progress = recordAttempt(emptyProgress(), fakeGrade('slow-api', true, 80), 1);
    progress = recordAttempt(progress, fakeGrade('slow-api', true, 40), 2);
    progress = recordAttempt(progress, fakeGrade('slow-api', true, 90), 3);
    expect(progress.challenges['slow-api'].best!.p95).toBe(40);
  });

  it('unlocks tiers progressively and awards points by difficulty once', () => {
    let progress = emptyProgress();
    expect(challenges.filter(challenge => isUnlocked(progress, challenge)).map(challenge => challenge.id)).toEqual(challenges.filter(challenge => challenge.difficulty === 'easy').map(challenge => challenge.id));
    expect(statusOf(progress, byId('scale-the-backend'))).toBe('locked');
    progress = recordAttempt(progress, fakeGrade('slow-api', false), 1);
    expect(isUnlocked(progress, byId('scale-the-backend'))).toBe(false);
    progress = recordAttempt(progress, fakeGrade('slow-api', true), 2);
    expect(isUnlocked(progress, byId('scale-the-backend'))).toBe(true); expect(isUnlocked(progress, byId('protect-the-ledger'))).toBe(false);
    progress = recordAttempt(progress, fakeGrade('async-processing', true), 3);
    expect(isUnlocked(progress, byId('protect-the-ledger'))).toBe(true); expect(isUnlocked(progress, byId('reliable-checkout'))).toBe(false);
    progress = recordAttempt(progress, fakeGrade('slow-api', true), 4);
    expect(pointsFor(progress)).toBe(100 + 200);
  });

  it('keeps a capped attempt history and never changes a recorded attempt', () => {
    let progress = recordAttempt(emptyProgress(), fakeGrade('slow-api', false, 120), 1);
    const first = JSON.stringify(progress.challenges['slow-api'].history![0]);
    progress = recordAttempt(progress, fakeGrade('slow-api', true, 60), 2);
    progress = saveDraft(progress, 'slow-api', { nodes: [], edges: [] });
    expect(JSON.stringify(progress.challenges['slow-api'].history![0])).toBe(first);
    const attempt = progress.challenges['slow-api'].history![0];
    expect(Object.isFrozen(attempt) && Object.isFrozen(attempt.criteria)).toBe(true);
    expect(() => { (attempt as { passed: boolean }).passed = true; }).toThrow();
    for (let i = 3; i < 30; i += 1) progress = recordAttempt(progress, fakeGrade('slow-api', false), i);
    const history = progress.challenges['slow-api'].history!;
    expect(history).toHaveLength(HISTORY_SIZE); expect(history.at(-1)!.at).toBe(29); expect(progress.challenges['slow-api'].attempts).toBe(29);
    // The best attempt survives even after it drops out of the capped history.
    expect(progress.challenges['slow-api'].best).toMatchObject({ at: 2, passed: true });
  });

  it('freezes recorded attempts when loading saved progress', () => {
    const storage = memory(); saveProgress(recordAttempt(emptyProgress(), fakeGrade('slow-api', true), 1), storage);
    const loaded = loadProgress(storage);
    expect(Object.isFrozen(loaded.challenges['slow-api'].last)).toBe(true);
    // Recording on top of loaded (frozen) progress still works and leaves the earlier entry intact.
    const next = recordAttempt(loaded, fakeGrade('slow-api', false), 2);
    expect(next.challenges['slow-api'].history!.map(entry => entry.at)).toEqual([1, 2]);
    expect(loaded.challenges['slow-api'].attempts).toBe(1);
  });

  it('keeps each challenge’s draft independent', () => {
    const draft = (label: string): Draft => ({ nodes: [{ id: 'n', kind: 'client', label, config: {}, position: { x: 0, y: 0 } }], edges: [] });
    let progress = saveDraft(emptyProgress(), 'slow-api', draft('A'));
    progress = saveDraft(progress, 'cache-it-right', draft('B'));
    progress = saveDraft(progress, 'slow-api', draft('A2'));
    expect(progress.drafts['cache-it-right'].nodes[0].label).toBe('B');
    expect(progress.drafts['slow-api'].nodes[0].label).toBe('A2');
    expect(clearDraft(progress, 'slow-api').drafts).toEqual({ 'cache-it-right': draft('B') });
  });
});
