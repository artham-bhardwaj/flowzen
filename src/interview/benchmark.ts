import type { ArchitectureSnapshot } from '../challenges/attempts';
import { labInput, type LabMeasurements } from '../lab/measure';
import type { SimulationInput } from '../simulation/engine';
import { architectureKey, type RunEvidence } from './session';
import type { InterviewDefinition, Scenario } from './types';

/**
 * Isolated benchmark runs for interviews. The input is built from a copy of the session's architecture with the
 * problem's forced settings; it runs on its own worker and never touches the canvas, practice runs or challenges.
 */
export function benchmarkInput(definition: InterviewDefinition, architecture: ArchitectureSnapshot, scenario?: Scenario): SimulationInput {
  const { benchmark } = definition;
  const rps = scenario?.kind === 'traffic' ? Math.round(benchmark.rps * scenario.multiplier) : benchmark.rps;
  const faults = scenario?.kind === 'outage' ? architecture.nodes.filter(node => scenario.kinds.includes(node.kind)).map(node => ({ nodeId: node.id, startMs: scenario.startMs, endMs: scenario.endMs })) : [];
  const input = labInput(architecture, { rps, durationMs: benchmark.durationMs, drainMs: benchmark.drainMs, seed: benchmark.seed, faults });
  return { ...input, nodes: input.nodes.map(node => {
    const forced = benchmark.overrides.filter(override => override.kinds.includes(node.kind)).reduce<Record<string, string>>((acc, override) => ({ ...acc, ...override.config }), {});
    return Object.keys(forced).length ? { ...node, config: { ...node.config, ...forced } } : node;
  }) };
}
export const scenarioLabel = (definition: InterviewDefinition, scenario?: Scenario) => !scenario ? `benchmark at ${definition.benchmark.rps.toLocaleString()} req/s`
  : scenario.kind === 'traffic' ? `${scenario.multiplier}× traffic (${Math.round(definition.benchmark.rps * scenario.multiplier).toLocaleString()} req/s)`
  : `outage of ${scenario.kinds.join(' / ')} from ${scenario.startMs / 1000} s to ${scenario.endMs / 1000} s`;
/** Whether a scenario can run on this architecture (an outage needs a component of the affected kinds). */
export const scenarioApplies = (architecture: ArchitectureSnapshot | null, scenario: Scenario) => Boolean(architecture?.nodes.length) && (scenario.kind === 'traffic' || architecture!.nodes.some(node => scenario.kinds.includes(node.kind)));
export function toEvidence(measurements: LabMeasurements, architecture: ArchitectureSnapshot, label: string, at: number): RunEvidence {
  const top = measurements.components.find(component => component.kind !== 'client');
  return {
    at, label, architectureKey: architectureKey(architecture), complete: measurements.complete,
    p95: measurements.p95 === null ? null : Math.round(measurements.p95 * 10) / 10, successPct: Math.round(measurements.successPct * 100) / 100, errorRatePct: Math.round(measurements.errorRatePct * 100) / 100,
    successThroughput: Math.round(measurements.successThroughput * 10) / 10,
    busiest: top ? { label: top.label, utilization: Math.round(top.utilization * 1000) / 1000 } : null,
    processed: Object.fromEntries(measurements.components.map(component => [component.id, component.requestsProcessed])),
    failures: measurements.failures.slice(0, 5).map(failure => ({ label: failure.label, kind: failure.kind, count: failure.count })),
  };
}
