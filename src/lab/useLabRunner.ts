import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimulationInput } from '../simulation/engine';
import { runLabRequest, type LabWorkerRequest, type LabWorkerResponse } from '../simulation/worker';
import type { LabMeasurements } from './measure';

export type LevelOutcome = { ok: true; measurements: LabMeasurements } | { ok: false; error: string };
export type LabJob = {
  label: string; inputs: SimulationInput[]; labels: Record<string, string>;
  /** Labels for one input, when inputs are different architectures (falls back to `labels`). */
  labelsPerInput?: Array<Record<string, string>>;
  /** Called once per completed level, in order. */
  onLevel: (index: number, outcome: LevelOutcome) => void;
  /** Called once at the end. `completed` is how many levels ran; the rest were cancelled. */
  onDone: (result: { cancelled: boolean; completed: number }) => void;
};
export type LabRunnerState = { status: 'idle' } | { status: 'running'; label: string; done: number; total: number };

/**
 * Runs lab simulations level by level on a dedicated worker. Cancel terminates the worker immediately, so even a
 * long level stops at once; levels that did not run are reported to the caller as not run, never estimated.
 * Falls back to the main thread (cancellable between levels) if a worker cannot be created.
 */
export function useLabRunner() {
  const [state, setState] = useState<LabRunnerState>({ status: 'idle' });
  const worker = useRef<Worker | null>(null);
  const job = useRef<{ job: LabJob; index: number; id: number } | null>(null);
  const sequence = useRef(0); const fallbackTimer = useRef<number | null>(null);
  /** Response handler, read through a ref so `post` and `receive` can call each other. */
  const receiveRef = useRef<(response: LabWorkerResponse) => void>(() => undefined);

  const finish = useCallback((cancelled: boolean) => {
    const current = job.current; if (!current) return;
    job.current = null; setState({ status: 'idle' }); current.job.onDone({ cancelled, completed: current.index });
  }, []);

  const post = useCallback(() => {
    const current = job.current; if (!current) return;
    if (current.index >= current.job.inputs.length) { finish(false); return; }
    const request: LabWorkerRequest = { id: ++sequence.current, kind: 'lab', input: current.job.inputs[current.index], labels: current.job.labelsPerInput?.[current.index] ?? current.job.labels };
    current.id = request.id;
    setState({ status: 'running', label: current.job.label, done: current.index, total: current.job.inputs.length });
    if (worker.current) worker.current.postMessage(request);
    else fallbackTimer.current = window.setTimeout(() => { fallbackTimer.current = null; receiveRef.current(runLabRequest(request)); }, 0);
  }, [finish]);

  const receive = useCallback((response: LabWorkerResponse) => {
    const current = job.current; if (!current || response.id !== current.id) return;
    current.job.onLevel(current.index, response.ok ? { ok: true, measurements: response.measurements } : { ok: false, error: response.error });
    current.index += 1; post();
  }, [post]);
  receiveRef.current = receive;

  const ensureWorker = useCallback(() => {
    if (worker.current) return;
    try {
      const instance = new Worker(new URL('../simulation/worker.ts', import.meta.url), { type: 'module' });
      instance.onmessage = (event: MessageEvent<LabWorkerResponse>) => receive(event.data);
      instance.onerror = event => { event.preventDefault(); instance.terminate(); worker.current = null; const current = job.current; if (current) { current.job.onLevel(current.index, { ok: false, error: 'The simulation worker stopped unexpectedly.' }); current.index += 1; post(); } };
      worker.current = instance;
    } catch { worker.current = null; }
  }, [post, receive]);

  useEffect(() => () => { worker.current?.terminate(); worker.current = null; if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current); }, []);

  const run = useCallback((next: LabJob) => {
    if (job.current) return false;
    ensureWorker(); job.current = { job: next, index: 0, id: 0 }; post(); return true;
  }, [ensureWorker, post]);

  const cancel = useCallback(() => {
    if (!job.current) return;
    // Terminating stops a level mid-simulation; a fresh worker is created for the next job.
    worker.current?.terminate(); worker.current = null;
    if (fallbackTimer.current) { window.clearTimeout(fallbackTimer.current); fallbackTimer.current = null; }
    finish(true);
  }, [finish]);

  return { state, run, cancel };
}
