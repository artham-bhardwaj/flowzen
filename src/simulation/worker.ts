import { simulate, type SimulationInput } from './engine';
import { createPlaybackIndex } from './playback';
import { measure, type LabMeasurements } from '../lab/measure';

export type WorkerRequest = { id: number; input: SimulationInput };
export type WorkerResponse = { id: number; ok: true; result: ReturnType<typeof simulate>; index: ReturnType<typeof createPlaybackIndex>; elapsedMs: number } | { id: number; ok: false; error: string };
/** Scaling Laboratory runs: the worker simulates and returns measurements only (no traces, no playback index). */
export type LabWorkerRequest = { id: number; kind: 'lab'; input: SimulationInput; labels: Record<string, string> };
export type LabWorkerResponse = { id: number; kind: 'lab'; ok: true; measurements: LabMeasurements; elapsedMs: number } | { id: number; kind: 'lab'; ok: false; error: string };

export function runLabRequest(request: LabWorkerRequest): LabWorkerResponse {
  try {
    const started = performance.now(); const measurements = measure(simulate(request.input), request.input, request.labels);
    return { id: request.id, kind: 'lab', ok: true, measurements, elapsedMs: performance.now() - started };
  } catch (error) {
    return { id: request.id, kind: 'lab', ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Collects typed-array buffers so the index moves to the main thread without copying. */
export function transferables(value: unknown, found: Set<ArrayBuffer> = new Set()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer) found.add(value.buffer); }
  else if (value && typeof value === 'object') for (const item of Object.values(value)) transferables(item, found);
  return [...found];
}

export function runSimulation(request: WorkerRequest): WorkerResponse {
  try {
    const started = performance.now(); const result = simulate(request.input); const index = createPlaybackIndex(result);
    return { id: request.id, ok: true, result, index, elapsedMs: performance.now() - started };
  } catch (error) {
    return { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Only register the message handler inside a dedicated worker.
const scope = globalThis as unknown as { WorkerGlobalScope?: new () => unknown; onmessage: ((event: MessageEvent<WorkerRequest | LabWorkerRequest>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
if (typeof scope.WorkerGlobalScope === 'function' && globalThis instanceof scope.WorkerGlobalScope) {
  scope.onmessage = event => {
    const request = event.data;
    if ('kind' in request && request.kind === 'lab') { scope.postMessage(runLabRequest(request), []); return; }
    const response = runSimulation(request); scope.postMessage(response, response.ok ? transferables(response.index) : []);
  };
}
