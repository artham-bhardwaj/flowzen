import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createSession, type InterviewSession } from './session';
import { addCorrection, addRecord, discardDraft, loadInterviews, purgeUnreadable, putDraft, saveInterviews, type InterviewRecord, type InterviewState } from './store';
import type { Correction } from './evaluate';
import type { InterviewDefinition } from './types';

/** Interview drafts and history for the whole app, saved locally (debounced) and separately from everything else. */
export function useInterviews() {
  const initial = useMemo(() => loadInterviews(), []);
  const [state, setState] = useState<InterviewState>(initial.state);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(state); latest.current = state;
  useEffect(() => { const timer = window.setTimeout(() => setSaveFailed(!saveInterviews(state)), 250); return () => window.clearTimeout(timer); }, [state]);
  // Save immediately when the page is hidden or closed, so a reload never loses the last edits.
  useEffect(() => {
    const flush = () => { saveInterviews(latest.current); };
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', flush);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); };
  }, []);
  const sequence = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence.current}`;

  /** Definitions are passed in by the (lazily loaded) Interview page, so the problem library stays out of the main bundle. */
  /**
   * Starts a new draft. From a record (optionally one of its checkpoints) the answers and architecture are copied into
   * a new draft with its own id; existing drafts and the record are never touched.
   */
  const start = useCallback((definition: InterviewDefinition, mode: 'practice' | 'mock', durationMin?: number, from?: InterviewRecord, checkpointId?: string): InterviewSession => {
    const session = createSession(definition, { id: nextId('session'), at: Date.now(), mode, durationMin, from: from ? { recordId: from.id, session: from.session, checkpointId } : undefined });
    setState(current => putDraft(current, session)); return session;
  }, []);
  /** Applies an edit to a draft. Completed records cannot be edited; only drafts are reachable here. */
  const edit = useCallback((id: string, change: (session: InterviewSession) => InterviewSession) => setState(current => {
    const draft = current.drafts.find(entry => entry.id === id); if (!draft) return current;
    const next = change(draft); return next === draft ? current : putDraft(current, next);
  }), []);
  /** Stores a completed record built by the caller (see record.ts); the draft is removed and the history saved at once. */
  const complete = useCallback((id: string, build: (draft: InterviewSession, recordId: string) => InterviewRecord): InterviewRecord | null => {
    const draft = latest.current.drafts.find(entry => entry.id === id); if (!draft) return null;
    const record = build(draft, nextId('interview'));
    const next = addRecord(latest.current, record);
    latest.current = next; setState(next); saveInterviews(next);
    return record;
  }, []);
  return {
    state, dropped: initial.dropped, saveFailed, start, edit, complete,
    discard: useCallback((id: string) => setState(current => discardDraft(current, id)), []),
    correct: useCallback((recordId: string, correction: Correction) => setState(current => addCorrection(current, recordId, correction)), []),
    /** Deletes entries that could not be read. Only ever called from an explicit user action. */
    purgeUnreadable: useCallback(() => setState(current => purgeUnreadable(current)), []),
  };
}
export type InterviewController = ReturnType<typeof useInterviews>;
