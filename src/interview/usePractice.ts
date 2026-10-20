import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPractice, recordAttempt, savePractice, type BottleneckMeasurement, type Drill, type DrillAnswers, type PracticeState } from './drills';

/** Targeted-practice attempts, saved under their own key and never mixed with interview drafts or records. */
export function usePractice() {
  const initial = useMemo(() => loadPractice(), []);
  const [state, setState] = useState<PracticeState>(initial.state);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(state); latest.current = state;
  const sequence = useRef(0);
  useEffect(() => { setSaveFailed(!savePractice(state)); }, [state]);
  const submit = useCallback((drill: Drill, answers: DrillAnswers, measured: Record<string, BottleneckMeasurement>) => {
    const { state: next, attempt } = recordAttempt(latest.current, drill, answers, measured, { id: `drill-${Date.now().toString(36)}-${++sequence.current}`, at: Date.now() });
    latest.current = next; setState(next); return attempt;
  }, []);
  return { state, dropped: initial.dropped, saveFailed, submit };
}
export type PracticeController = ReturnType<typeof usePractice>;
