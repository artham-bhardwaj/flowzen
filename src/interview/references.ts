import type { InterviewDefinition, ReferenceDesign } from './types';

/**
 * Reference solutions are versioned with their definitions. A record stores the reference version it was graded
 * against; `referenceFor` returns that version when the definition still carries it (current or in
 * `referenceHistory`), and otherwise the current one, flagged so the report can say it differs.
 */
export const referenceVersion = (definition: InterviewDefinition) => definition.reference.version ?? definition.version;
/** `version` is the record's reference version; records made before references were versioned used version 1. */
export function referenceFor(definition: InterviewDefinition, version = 1): { reference: ReferenceDesign; version: number; exact: boolean } {
  const current = referenceVersion(definition);
  if (version === current) return { reference: definition.reference, version: current, exact: true };
  const old = definition.referenceHistory?.find(entry => (entry.version ?? 1) === version);
  return old ? { reference: old, version, exact: true } : { reference: definition.reference, version: current, exact: false };
}
