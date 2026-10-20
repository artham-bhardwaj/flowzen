import { byKind } from '../app/catalog';
import { diffSnapshots, type ComponentChange } from '../challenges/attempts';
import { benchmarkInput, scenarioApplies, scenarioLabel } from './benchmark';
import { architectureKey, type ChangeResponse, type Checkpoint, type InterviewSession, type RunEvidence } from './session';
import { checkpointById } from './workflow';
import type { InterviewDefinition, RequirementChange } from './types';

/**
 * Requirement changes: comparing the original design (the checkpoint taken when the change was introduced) with
 * the revision. Structural differences are always shown. Measured results are compared only when both designs
 * were run under the same change scenario and each run belongs to exactly that checkpoint's architecture; otherwise
 * the comparison says why it is not comparable. A change the simulator cannot model is labelled hypothetical.
 */
export const changeTargets = (definition: InterviewDefinition, change: RequirementChange) => ({
  p95Ms: change.targets?.p95Ms ?? definition.benchmark.targets.p95Ms, minSuccessPct: change.targets?.minSuccessPct ?? definition.benchmark.targets.minSuccessPct,
});
/** Whether the simulator can run this change on a design: a scenario that applies, or new targets on the benchmark itself. */
export const changeRunnable = (change: RequirementChange, architecture: Checkpoint['architecture'] | null | undefined) =>
  Boolean(architecture?.nodes.length) && (change.scenario ? scenarioApplies(architecture!, change.scenario) : Boolean(change.targets));
export const changeRunLabel = (definition: InterviewDefinition, change: RequirementChange) => `${change.title}: ${scenarioLabel(definition, change.scenario)}`;
export const changeInput = (definition: InterviewDefinition, change: RequirementChange, architecture: Checkpoint['architecture']) => benchmarkInput(definition, architecture, change.scenario);
export const meets = (run: RunEvidence | undefined, targets: { p95Ms: number; minSuccessPct: number }) => run && run.complete ? run.p95 !== null && run.p95 <= targets.p95Ms && run.successPct >= targets.minSuccessPct : undefined;

export type ChangeComparison = {
  change: RequirementChange; response: ChangeResponse | undefined;
  baseline?: Checkpoint; revision?: Checkpoint;
  /** Differences between the original and the revised architecture. */
  diff: { components: ComponentChange[]; connectionsAdded: string[]; connectionsRemoved: string[] } | null;
  /** 'measured' when the simulator can run the change; 'hypothetical' otherwise. */
  mode: 'measured' | 'hypothetical';
  original?: RunEvidence; revised?: RunEvidence;
  /** True only when both runs are complete and each belongs to its checkpoint's architecture. */
  comparable: boolean; notComparable?: string;
  targets: { p95Ms: number; minSuccessPct: number };
  meets: { original?: boolean; revised?: boolean };
};

export function compareChange(definition: InterviewDefinition, session: InterviewSession, change: RequirementChange): ChangeComparison {
  const response = session.changes[change.id];
  const baseline = checkpointById(session, response?.baselineId); const revision = checkpointById(session, response?.revisionId);
  const targets = changeTargets(definition, change);
  const mode = change.scenario || change.targets ? 'measured' : 'hypothetical';
  let diff: ChangeComparison['diff'] = null;
  if (baseline && revision) {
    const labels = new Map([...baseline.architecture.nodes, ...revision.architecture.nodes].map(node => [node.id, node.label || byKind[node.kind].label]));
    diff = diffSnapshots(baseline.architecture, revision.architecture, changeInput(definition, change, baseline.architecture), changeInput(definition, change, revision.architecture), id => labels.get(id) ?? id);
    diff = { ...diff, components: diff.components.filter(entry => entry.type !== 'changed' || entry.config.length || entry.kindChanged || entry.renamed) };
  }
  const original = response?.runs.original; const revised = response?.runs.revised;
  const originalOk = Boolean(original?.complete && baseline && original.architectureKey === architectureKey(baseline.architecture));
  const revisedOk = Boolean(revised?.complete && revision && revised.architectureKey === architectureKey(revision.architecture));
  const notComparable = mode === 'hypothetical' ? 'The simulator cannot model this change, so the comparison is structural and reasoned only.'
    : !baseline ? 'The change has not been introduced.'
    : !revision ? 'Save the revised design to compare it with the original.'
    : !original || !revised ? 'Run the change on both the original and the revised design to compare measurements.'
    : !originalOk || !revisedOk ? 'A run does not belong to its checkpoint (the design changed after it was measured, or the run was incomplete), so the measurements are not compared.'
    : undefined;
  return { change, response, baseline, revision, diff, mode, original, revised, comparable: !notComparable, notComparable, targets, meets: { original: originalOk ? meets(original, targets) : undefined, revised: revisedOk ? meets(revised, targets) : undefined } };
}
