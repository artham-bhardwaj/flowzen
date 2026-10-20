import type { SimulationInput, SimulationResult } from '../simulation/engine';
import type { Validation } from '../app/validation';
import type { Challenge } from './definitions';
import { benchmarkInput, grade, type Architecture, type Grade } from './grading';
import type { AttemptSummary, Progress } from './progress';
import type { ArchitectureSnapshot } from './attempts';

/** Everything a submission is graded against, captured when the user presses Submit. */
export type PreparedSubmission = {
  challengeId: string; input: SimulationInput; validation: Pick<Validation, 'counts' | 'issues'>;
  /** The canvas as it was when Submit was pressed; edits made while grading runs do not reach it. */
  snapshot?: ArchitectureSnapshot;
};
export type SubmissionOutcome = { grade: Grade; previous: AttemptSummary | undefined; best: AttemptSummary | undefined; newlySolved: boolean };

/**
 * Builds the benchmark run for a submission. The user's architecture is copied, never modified:
 * the benchmark's fixed workload and locked settings apply only to the copy that is simulated.
 */
export function prepareSubmission(challenge: Challenge, architecture: Architecture, validate: (input: SimulationInput) => Pick<Validation, 'counts' | 'issues'>, snapshot?: ArchitectureSnapshot): PreparedSubmission {
  const input = benchmarkInput(challenge, structuredClone(architecture));
  const validation = validate(input);
  return { challengeId: challenge.id, input, validation: structuredClone({ counts: validation.counts, issues: validation.issues }), ...(snapshot ? { snapshot } : {}) };
}

/**
 * Grades a finished benchmark run against the challenge. Pure: it reads progress only to report the
 * previous and best attempts as they were before this submission; recording is the caller's step.
 */
export function gradeSubmission(challenge: Challenge, prepared: PreparedSubmission, result: SimulationResult | null, progress: Progress): SubmissionOutcome {
  const graded = grade(challenge, prepared.input, result, prepared.validation);
  const before = progress.challenges[challenge.id];
  return { grade: graded, previous: before?.last, best: before?.best, newlySolved: graded.passed && !before?.solved };
}
