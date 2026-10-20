/**
 * Which tab the right panel shows in a challenge: the brief or the inspector.
 *
 * Only explicit user actions that open something to inspect switch to the inspector. Changing the design
 * view, undo/redo, submitting, results arriving and React Flow re-reporting an unchanged selection never
 * move the user away from the brief.
 */
export type RightTab = 'challenge' | 'inspector';
export type PanelEvent =
  | { type: 'open-challenge' }
  | { type: 'tab'; tab: RightTab }
  /** The canvas reported a selection; `changed` is false when React Flow re-reports the same selection. */
  | { type: 'select'; changed: boolean; hasTarget: boolean }
  | { type: 'open-request' }
  | { type: 'review-issues' }
  | { type: 'view-change' }
  | { type: 'history' }
  | { type: 'submit' }
  | { type: 'graded' };

export function nextRightTab(current: RightTab, event: PanelEvent): RightTab {
  switch (event.type) {
    case 'open-challenge': return 'challenge';
    case 'tab': return event.tab;
    case 'select': return event.changed && event.hasTarget ? 'inspector' : current;
    case 'open-request': case 'review-issues': return 'inspector';
    default: return current;
  }
}
