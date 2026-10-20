import { describe, expect, it } from 'vitest';
import { simulate } from '../simulation/engine';
import { simulationInput } from '../app/model';
import { validateArchitecture } from '../app/validation';
import { challengeById } from './definitions';
import { deepFreeze } from './grading';
import { emptyProgress, recordAttempt } from './progress';
import { starterArchitecture, toArchitecture } from './starter';
import { gradeSubmission, prepareSubmission } from './submission';

const challenge = challengeById('slow-api')!;
const architectureFor = (instances: string) => {
  const s = starterArchitecture(challenge);
  return { nodes: s.nodes.map(node => node.id === 'api' ? { ...node, data: { ...node.data, config: { ...node.data.config, instances } } } : node), edges: s.edges };
};

describe('submission flow', () => {
  it('grades the fixed benchmark without modifying the architecture, whatever the interactive settings are', () => {
    const base = architectureFor('14');
    // Simulate a locked value edited outside the inspector (e.g. an old draft): the user's copy must keep it.
    const nodes = base.nodes.map(node => node.id === 'api' ? { ...node, data: { ...node.data, config: { ...node.data.config, processingLatencyMs: '1' } } } : node); const edges = base.edges;
    const architecture = deepFreeze(toArchitecture(nodes, edges)); // any write would throw
    // An interactive practice run with the user's own toolbar settings, which grading must not touch.
    const practiceInput = simulationInput(nodes, edges, 37, 3000); const practice = simulate(practiceInput); const practiceSnapshot = JSON.stringify(practice);
    const prepared = prepareSubmission(challenge, architecture, input => validateArchitecture(input));
    expect(prepared.input).toMatchObject({ offeredRps: 300, durationMs: 11_000, seed: 101 });
    expect(architecture.nodes.find(node => node.id === 'api')?.config?.processingLatencyMs).toBe('1'); // untouched
    expect(prepared.input.nodes.find(node => node.id === 'api')?.config?.processingLatencyMs).toBe('40'); // the benchmark copy is locked
    const outcome = gradeSubmission(challenge, prepared, simulate(prepared.input), emptyProgress());
    expect(outcome.grade.passed).toBe(true); expect(outcome.newlySolved).toBe(true);
    expect(JSON.stringify(practice)).toBe(practiceSnapshot);
  });

  it('reports the previous and best attempts as they were before this submission, without recording it', () => {
    const progress = deepFreeze(recordAttempt(recordAttempt(emptyProgress(), gradeOf('14'), 1), gradeOf('2'), 2));
    const prepared = prepareSubmission(challenge, toArchitecture(...arch('3')), input => validateArchitecture(input));
    const outcome = gradeSubmission(challenge, prepared, simulate(prepared.input), progress);
    expect(outcome.previous?.at).toBe(2); expect(outcome.best?.at).toBe(1); expect(outcome.newlySolved).toBe(false);
    expect(progress.challenges['slow-api'].attempts).toBe(2);
  });

  it('gives identical grades for identical submissions', () => {
    const a = gradeOf('14'); const b = gradeOf('14');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

function arch(instances: string): [ReturnType<typeof architectureFor>['nodes'], ReturnType<typeof architectureFor>['edges']] {
  const { nodes, edges } = architectureFor(instances); return [nodes, edges];
}
function gradeOf(instances: string) {
  const prepared = prepareSubmission(challenge, toArchitecture(...arch(instances)), input => validateArchitecture(input));
  return gradeSubmission(challenge, prepared, simulate(prepared.input), emptyProgress()).grade;
}
