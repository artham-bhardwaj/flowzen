import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLabRunner } from '../lab/useLabRunner';
import type { LabMeasurements } from '../lab/measure';
import type { QuizAnswers, QuizResult } from './evaluate';
import { experimentInput, makeExperimentRecord, variantLabels, type ExperimentRecord, type ExperimentTemplate, type ExperimentVariant, type VariantResult } from './experiments';
import { loadLearn, recordExperiment, recordQuiz, recordTask, saveLearn, visitSection, type LearnState } from './progress';
import type { SectionId } from './types';

/** Learning progress for the whole app: persisted locally, independent of challenges and the Playground. */
export function useLearn() {
  const initial = useMemo(() => loadLearn(), []);
  const [state, setState] = useState<LearnState>(initial.state);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => { setSaveFailed(!saveLearn(state)); }, [state]);
  return {
    state, dropped: initial.dropped, saveFailed,
    visit: useCallback((lessonId: string, section: SectionId) => setState(current => visitSection(current, lessonId, section, Date.now())), []),
    recordQuiz: useCallback((lessonId: string, result: QuizResult, answers: QuizAnswers) => setState(current => recordQuiz(current, lessonId, result, answers, Date.now())), []),
    recordTask: useCallback((lessonId: string, taskId: string) => setState(current => recordTask(current, lessonId, taskId, Date.now())), []),
    recordExperiment: useCallback((record: ExperimentRecord) => setState(current => recordExperiment(current, record)), []),
  };
}
export type LearnController = ReturnType<typeof useLearn>;

/**
 * Runs every variant of an experiment template on the lab worker, one at a time, with identical benchmarks.
 * A cancelled or failed run is reported, never recorded as complete.
 */
export function useExperimentRunner(onRecord: (record: ExperimentRecord, results: VariantResult[]) => void) {
  const runner = useLabRunner();
  const [results, setResults] = useState<{ templateId: string; results: VariantResult[]; extra: ExperimentVariant[]; cancelled: boolean } | null>(null);
  const run = useCallback((template: ExperimentTemplate, extra: ExperimentVariant[] = []) => {
    const variants = [...template.variants, ...extra];
    const collected: VariantResult[] = [];
    return runner.run({
      label: template.title, inputs: variants.map(variant => experimentInput(template, variant)), labels: {}, labelsPerInput: variants.map(variantLabels),
      onLevel: (index, outcome) => { collected.push(outcome.ok ? { variantId: variants[index].id, measurements: outcome.measurements as LabMeasurements } : { variantId: variants[index].id, measurements: null, error: outcome.error }); },
      onDone: ({ cancelled }) => {
        setResults({ templateId: template.id, results: [...collected], extra, cancelled });
        // Only complete runs are recorded; a cancelled run is shown but never stored as an experiment result.
        if (!cancelled) onRecord(makeExperimentRecord(template, collected, Date.now(), extra), collected);
      },
    });
  }, [onRecord, runner]);
  return { state: runner.state, run, cancel: runner.cancel, results };
}
