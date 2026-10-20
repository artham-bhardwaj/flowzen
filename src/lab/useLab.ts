import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchitectureSnapshot } from '../challenges/attempts';
import { cancelledPoint, failedPoint, labInput, makeRun, makeSweep, planSweep, sweepPoint, validateBenchmark, type LabBenchmark, type LabRun, type LabTargets, type SweepPoint } from './lab';
import { deleteVariant, loadLab, recordExperiment, recordSweep, saveLab, saveVariant, setBaseline, setBenchmark, setDraft, setTargets, type LabState } from './store';
import { useLabRunner } from './useLabRunner';

/** True when a run was made for exactly this architecture and benchmark (its results are current). */
export const runMatches = (run: LabRun | null, architecture: ArchitectureSnapshot, benchmark: LabBenchmark) =>
  run !== null && JSON.stringify(run.input) === JSON.stringify(labInput(architecture, benchmark));

/** Scaling Laboratory state: persisted locally, separate from challenge progress and from the practice run. */
export function useLab() {
  const initial = useMemo(() => loadLab(), []);
  const [lab, setLab] = useState<LabState>(initial.state);
  const [saveFailed, setSaveFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { setSaveFailed(!saveLab(lab)); }, [lab]);
  const runner = useLabRunner();
  const sequence = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++sequence.current}`;

  const check = (architecture: ArchitectureSnapshot, benchmark: LabBenchmark) => {
    if (!architecture.nodes.length) return 'The architecture is empty.';
    const errors = validateBenchmark(benchmark, new Set(architecture.nodes.map(node => node.id)));
    return errors.length ? errors.join(' ') : null;
  };

  /** Runs one benchmark and records it as the new baseline or the latest experiment. */
  const runSingle = useCallback((kind: 'baseline' | 'experiment', architecture: ArchitectureSnapshot, labels: Record<string, string>) => {
    const benchmark = lab.benchmark; const targets = lab.targets;
    const problem = check(architecture, benchmark); if (problem) { setMessage(problem); return; }
    setMessage(null);
    runner.run({
      label: kind === 'baseline' ? 'Running baseline' : 'Running experiment', inputs: [labInput(architecture, benchmark)], labels,
      onLevel: (_index, outcome) => {
        if (!outcome.ok) { setMessage(`The simulation failed: ${outcome.error}`); return; }
        const run = makeRun({ id: nextId(kind), at: Date.now(), label: kind === 'baseline' ? 'Baseline' : 'Experiment', architecture, benchmark, targets, measurements: outcome.measurements });
        setLab(current => kind === 'baseline' ? setBaseline(current, run) : recordExperiment(current, run));
      },
      onDone: ({ cancelled }) => { if (cancelled) setMessage('Cancelled. Nothing was recorded.'); },
    });
  }, [lab.benchmark, lab.targets, runner]);

  /** Runs a traffic sweep; levels that do not finish are recorded as cancelled, never estimated. */
  const runSweep = useCallback((architecture: ArchitectureSnapshot, labels: Record<string, string>, levels: number[]) => {
    const benchmark = lab.benchmark; const targets = lab.targets;
    const problem = check(architecture, benchmark); if (problem) { setMessage(problem); return; }
    const plan = planSweep(benchmark, levels); if (plan.errors.length) { setMessage(plan.errors.join(' ')); return; }
    setMessage(null);
    const points: SweepPoint[] = [];
    runner.run({
      label: 'Traffic sweep', inputs: plan.levels.map(rps => labInput(architecture, benchmark, rps)), labels,
      onLevel: (index, outcome) => { points.push(outcome.ok ? sweepPoint(plan.levels[index], outcome.measurements, targets) : failedPoint(plan.levels[index], outcome.error)); },
      onDone: ({ cancelled, completed }) => {
        for (const rps of plan.levels.slice(completed)) points.push(cancelledPoint(rps));
        setLab(current => recordSweep(current, makeSweep({ id: nextId('sweep'), at: Date.now(), architecture, benchmark, targets, points })));
        if (cancelled) setMessage(`Sweep cancelled after ${completed} of ${plan.levels.length} levels. Levels that did not run are marked as not run.`);
      },
    });
  }, [lab.benchmark, lab.targets, runner]);

  const saveAsVariant = useCallback((name: string, architecture: ArchitectureSnapshot) => {
    // Attach the latest experiment run only if it was made for exactly this design and benchmark.
    const run = runMatches(lab.experiment, architecture, lab.benchmark) ? lab.experiment : null;
    const outcome = saveVariant(lab, { id: nextId('variant'), name, savedAt: Date.now(), architecture, benchmark: lab.benchmark, run });
    if (outcome.error) { setMessage(outcome.error); return false; }
    setLab(outcome.state); setMessage(null); return true;
  }, [lab]);

  // Stable setters, so effects that depend on them (e.g. draft autosave) are not re-run on every render.
  const setDraftStable = useCallback((draft: ArchitectureSnapshot) => setLab(current => setDraft(current, draft)), []);
  const setBenchmarkStable = useCallback((benchmark: LabBenchmark) => setLab(current => setBenchmark(current, benchmark)), []);
  const setTargetsStable = useCallback((targets: LabTargets) => setLab(current => setTargets(current, targets)), []);
  const deleteVariantStable = useCallback((id: string) => setLab(current => deleteVariant(current, id)), []);

  return {
    lab, dropped: initial.dropped, saveFailed, message, dismissMessage: () => setMessage(null), runner: runner.state, cancel: runner.cancel,
    runBaseline: (architecture: ArchitectureSnapshot, labels: Record<string, string>) => runSingle('baseline', architecture, labels),
    runExperiment: (architecture: ArchitectureSnapshot, labels: Record<string, string>) => runSingle('experiment', architecture, labels),
    runSweep, saveAsVariant,
    deleteVariant: deleteVariantStable, setBenchmark: setBenchmarkStable, setTargets: setTargetsStable, setDraft: setDraftStable,
  };
}
export type LabController = ReturnType<typeof useLab>;
