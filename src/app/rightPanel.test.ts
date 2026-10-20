import { describe, expect, it } from 'vitest';
import { nextRightTab, type PanelEvent } from './rightPanel';

describe('right panel policy', () => {
  const stays: PanelEvent[] = [{ type: 'view-change' }, { type: 'history' }, { type: 'submit' }, { type: 'graded' }, { type: 'select', changed: false, hasTarget: true }, { type: 'select', changed: true, hasTarget: false }];
  it('keeps the challenge brief through view changes, undo/redo, submission, results and re-reported selections', () => {
    for (const event of stays) expect(nextRightTab('challenge', event), event.type).toBe('challenge');
  });
  it('switches to the inspector only for explicit inspection', () => {
    expect(nextRightTab('challenge', { type: 'select', changed: true, hasTarget: true })).toBe('inspector');
    expect(nextRightTab('challenge', { type: 'open-request' })).toBe('inspector');
    expect(nextRightTab('challenge', { type: 'review-issues' })).toBe('inspector');
  });
  it('honors explicit tab choices and reopens the brief for a newly opened challenge', () => {
    expect(nextRightTab('inspector', { type: 'tab', tab: 'challenge' })).toBe('challenge');
    expect(nextRightTab('challenge', { type: 'tab', tab: 'inspector' })).toBe('inspector');
    expect(nextRightTab('inspector', { type: 'open-challenge' })).toBe('challenge');
    for (const event of stays) expect(nextRightTab('inspector', event)).toBe('inspector');
  });
});
