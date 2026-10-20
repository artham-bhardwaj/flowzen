import { deepFreeze } from '../challenges/grading';
import { validateArchitectureSnapshot, type ArchitectureSnapshot } from '../challenges/attempts';
import { DEFAULT_BENCHMARK, DEFAULT_TARGETS, type LabBenchmark, type LabRun, type LabTargets, type Sweep } from './lab';

/**
 * Local persistence for the Scaling Laboratory (`localStorage`, key `flowzen-lab-v1`).
 *
 * The baseline, the latest experiment run, the latest sweep and saved variants are immutable records: every
 * change produces a new state object, and records are frozen. Replacing the baseline or deleting a variant
 * swaps a record out; nothing ever edits a record in place. Lab data is separate from challenge progress.
 */
export const LAB_STORAGE_KEY = 'flowzen-lab-v1';
export const MAX_VARIANTS = 20;

export type Variant = {
  schema: 'flowzen.lab-variant'; version: 1; id: string; name: string; savedAt: number;
  architecture: ArchitectureSnapshot; benchmark: LabBenchmark;
  /** The experiment run for exactly this architecture and benchmark, if one existed when it was saved. */
  run: LabRun | null;
};
export type LabState = {
  version: 1; benchmark: LabBenchmark; targets: LabTargets;
  baseline: LabRun | null; experiment: LabRun | null; sweep: Sweep | null;
  variants: Variant[];
  /** The editable experiment architecture, kept while the user is elsewhere. */
  draft: ArchitectureSnapshot | null;
};
export const emptyLab = (): LabState => ({ version: 1, benchmark: structuredClone(DEFAULT_BENCHMARK), targets: { ...DEFAULT_TARGETS }, baseline: null, experiment: null, sweep: null, variants: [], draft: null });

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = () => typeof localStorage === 'undefined' ? undefined : localStorage;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function benchmarkOk(value: unknown): value is LabBenchmark {
  return isObject(value) && isNumber(value.rps) && isNumber(value.durationMs) && isNumber(value.drainMs) && isNumber(value.seed) && Array.isArray(value.faults)
    && value.faults.every(fault => isObject(fault) && typeof fault.nodeId === 'string' && isNumber(fault.startMs) && isNumber(fault.endMs));
}
const targetsOk = (value: unknown): value is LabTargets => isObject(value) && isNumber(value.p95Ms) && isNumber(value.maxErrorRatePct) && isNumber(value.minSuccessPct);

/** Why a stored run is unusable, or null. Unknown versions and damaged data are rejected, never repaired. */
export function runProblem(value: unknown): string | null {
  if (!isObject(value) || value.schema !== 'flowzen.lab-run') return 'unknown format';
  if (value.version !== 1) return `unsupported version ${String(value.version)}`;
  const architecture = validateArchitectureSnapshot(value.architecture); if (architecture) return architecture;
  if (!benchmarkOk(value.benchmark) || !targetsOk(value.targets) || !isObject(value.input) || !isObject(value.measurements) || !Array.isArray(value.targetResults)) return 'missing benchmark, targets or measurements';
  if (typeof value.measurements.complete !== 'boolean' || !Array.isArray(value.measurements.components)) return 'malformed measurements';
  return null;
}
function sweepProblem(value: unknown): string | null {
  if (!isObject(value) || value.schema !== 'flowzen.lab-sweep') return 'unknown format';
  if (value.version !== 1) return `unsupported version ${String(value.version)}`;
  const architecture = validateArchitectureSnapshot(value.architecture); if (architecture) return architecture;
  if (!benchmarkOk(value.benchmark) || !targetsOk(value.targets) || !Array.isArray(value.points)) return 'missing benchmark or points';
  return null;
}
function variantProblem(value: unknown): string | null {
  if (!isObject(value) || value.schema !== 'flowzen.lab-variant') return 'unknown format';
  if (value.version !== 1) return `unsupported version ${String(value.version)}`;
  if (typeof value.id !== 'string' || typeof value.name !== 'string' || !isNumber(value.savedAt)) return 'missing identity';
  const architecture = validateArchitectureSnapshot(value.architecture); if (architecture) return architecture;
  if (!benchmarkOk(value.benchmark)) return 'missing benchmark';
  if (value.run !== null && runProblem(value.run)) return `its run is unusable (${runProblem(value.run)})`;
  return null;
}

/**
 * Loads lab state. Each record is validated on its own: an unusable record is dropped and reported in
 * `dropped`, and the rest still load. Nothing is substituted for a dropped record.
 */
export function loadLab(storage: StorageLike | undefined = defaultStorage()): { state: LabState; dropped: string[] } {
  const dropped: string[] = [];
  let raw: unknown;
  try { raw = JSON.parse(storage?.getItem(LAB_STORAGE_KEY) ?? 'null'); } catch { return { state: emptyLab(), dropped: ['The saved lab data could not be read.'] }; }
  if (raw === null) return { state: emptyLab(), dropped };
  if (!isObject(raw) || raw.version !== 1) return { state: emptyLab(), dropped: ['The saved lab data has an unsupported version.'] };
  const state = emptyLab();
  if (benchmarkOk(raw.benchmark)) state.benchmark = raw.benchmark; else if (raw.benchmark !== undefined) dropped.push('benchmark settings');
  if (targetsOk(raw.targets)) state.targets = raw.targets; else if (raw.targets !== undefined) dropped.push('performance targets');
  const take = <T>(value: unknown, problem: (value: unknown) => string | null, name: string): T | null => {
    if (value === null || value === undefined) return null;
    const reason = problem(value); if (reason) { dropped.push(`${name}: ${reason}`); return null; }
    return deepFreeze(value as T);
  };
  state.baseline = take<LabRun>(raw.baseline, runProblem, 'baseline');
  state.experiment = take<LabRun>(raw.experiment, runProblem, 'latest experiment');
  state.sweep = take<Sweep>(raw.sweep, sweepProblem, 'traffic sweep');
  state.draft = raw.draft === null || raw.draft === undefined ? null : validateArchitectureSnapshot(raw.draft) ? (dropped.push('experiment draft'), null) : deepFreeze(raw.draft as ArchitectureSnapshot);
  if (Array.isArray(raw.variants)) for (const variant of raw.variants) {
    const reason = variantProblem(variant);
    if (reason) dropped.push(`variant ${isObject(variant) && typeof variant.name === 'string' ? `“${variant.name}”` : '(unnamed)'}: ${reason}`); else state.variants.push(deepFreeze(variant as Variant));
  }
  return { state, dropped };
}
export function saveLab(state: LabState, storage: StorageLike | undefined = defaultStorage()): boolean {
  try { storage?.setItem(LAB_STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

// ── State transitions (all return new state; records are never edited) ─────────
export const setBaseline = (state: LabState, run: LabRun): LabState => ({ ...state, baseline: deepFreeze(run) });
export const recordExperiment = (state: LabState, run: LabRun): LabState => ({ ...state, experiment: deepFreeze(run) });
export const recordSweep = (state: LabState, sweep: Sweep): LabState => ({ ...state, sweep: deepFreeze(sweep) });
export const setDraft = (state: LabState, draft: ArchitectureSnapshot): LabState => ({ ...state, draft: deepFreeze(structuredClone(draft)) });
export const setBenchmark = (state: LabState, benchmark: LabBenchmark): LabState => ({ ...state, benchmark: structuredClone(benchmark) });
export const setTargets = (state: LabState, targets: LabTargets): LabState => ({ ...state, targets: { ...targets } });

export function saveVariant(state: LabState, params: { id: string; name: string; savedAt: number; architecture: ArchitectureSnapshot; benchmark: LabBenchmark; run: LabRun | null }): { state: LabState; error?: string } {
  const name = params.name.trim();
  if (!name || name.length > 60) return { state, error: 'Give the variant a name of 1–60 characters.' };
  if (state.variants.some(variant => variant.name.toLowerCase() === name.toLowerCase())) return { state, error: `A variant named “${name}” already exists. Saved variants are never overwritten; choose another name.` };
  if (state.variants.length >= MAX_VARIANTS) return { state, error: `You can keep up to ${MAX_VARIANTS} variants. Delete one to save another.` };
  const variant: Variant = deepFreeze(structuredClone({ schema: 'flowzen.lab-variant' as const, version: 1 as const, id: params.id, name, savedAt: params.savedAt, architecture: params.architecture, benchmark: params.benchmark, run: params.run }));
  return { state: { ...state, variants: [...state.variants, variant] } };
}
export const deleteVariant = (state: LabState, id: string): LabState => ({ ...state, variants: state.variants.filter(variant => variant.id !== id) });
