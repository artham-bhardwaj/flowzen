import { useCallback, useEffect, useRef, useState } from 'react';
import type { SimulationInput } from '../simulation/engine';
import { runSimulation, type WorkerRequest, type WorkerResponse } from '../simulation/worker';

export type RunnerState = { status: 'idle' } | { status: 'running' } | { status: 'error'; message: string };
type Success = Extract<WorkerResponse, { ok: true }>;

/** Runs the engine in a Web Worker (falling back to the main thread) and ignores superseded runs. */
export function useSimulationRunner(onResult: (response: Success) => void) {
  const [state, setState] = useState<RunnerState>({ status: 'idle' });
  const worker = useRef<Worker | null>(null); const sequence = useRef(0); const callback = useRef(onResult); callback.current = onResult;

  const receive = useCallback((response: WorkerResponse) => {
    if (response.id !== sequence.current) return;
    if (response.ok) { setState({ status: 'idle' }); callback.current(response); }
    else setState({ status: 'error', message: response.error });
  }, []);

  useEffect(() => {
    try {
      const instance = new Worker(new URL('../simulation/worker.ts', import.meta.url), { type: 'module' });
      instance.onmessage = (event: MessageEvent<WorkerResponse>) => receive(event.data);
      instance.onerror = event => { event.preventDefault(); worker.current = null; setState({ status: 'error', message: 'The simulation worker stopped unexpectedly. Run again to retry on the main thread.' }); };
      worker.current = instance;
      return () => instance.terminate();
    } catch { worker.current = null; }
  }, [receive]);

  const run = useCallback((input: SimulationInput) => {
    const request: WorkerRequest = { id: ++sequence.current, input };
    setState({ status: 'running' });
    if (worker.current) worker.current.postMessage(request);
    else window.setTimeout(() => receive(runSimulation(request)), 16);
  }, [receive]);
  const dismiss = useCallback(() => setState({ status: 'idle' }), []);
  return { state, run, dismiss };
}
