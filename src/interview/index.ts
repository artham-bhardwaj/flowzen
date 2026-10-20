import { byKind } from '../app/catalog';
import { LLD_COVERAGE } from '../lld/coverage';
import { MODULES } from '../learn/curriculum';
import { experimentById } from '../learn/experiments';
import { followUpPool, parentOf } from './adaptive';
import { SHARED_FOLLOW_UPS } from './followups';
import { PROBLEMS } from './problems';
import { STAGES, type InterviewDefinition, type Resource, type Trigger } from './types';

export { PROBLEMS };
export const problemById = (id: string): InterviewDefinition | undefined => PROBLEMS.find(problem => problem.id === id);

const LESSON_IDS = new Set(MODULES.flatMap(module => module.lessons.map(lesson => lesson.id)));
/** Why a resource link is invalid, or null. */
export function resourceProblem(resource: Resource): string | null {
  switch (resource.type) {
    case 'lesson': return LESSON_IDS.has(resource.id) ? null : `unknown lesson “${resource.id}”`;
    case 'component': return resource.kind in byKind ? null : `unknown component “${resource.kind}”`;
    case 'lld': return resource.kind in LLD_COVERAGE ? null : `no LLD design for “${resource.kind}”`;
    case 'experiment': return experimentById(resource.id) ? null : `unknown experiment “${resource.id}”`;
    case 'interview': return PROBLEMS.some(problem => problem.id === resource.id) ? null : `unknown interview “${resource.id}”`;
  }
}

/** Schema and reference checks for one definition. Returns human-readable errors (empty when valid). */
export function validateDefinition(definition: InterviewDefinition): string[] {
  const errors: string[] = []; const fail = (message: string) => errors.push(`${definition.id}: ${message}`);
  if (!/^[a-z0-9-]+$/.test(definition.id)) fail('id must be kebab-case');
  if (!Number.isInteger(definition.version) || definition.version < 1) fail('version must be a positive integer');
  if (definition.statement.length < 80) fail('problem statement is too short to be usable');
  const unique = (label: string, ids: string[]) => { if (new Set(ids).size !== ids.length) fail(`duplicate ${label} ids`); };
  unique('requirement', definition.requirements.map(entry => entry.id)); unique('clarification', definition.clarifications.map(entry => entry.id));
  unique('estimate', definition.estimates.map(entry => entry.id)); unique('api', definition.api.map(entry => entry.id)); unique('entity', definition.entities.map(entry => entry.id));
  unique('role', definition.roles.map(entry => entry.id)); unique('deep-dive', definition.deepDives.map(entry => entry.id));
  for (const kind of ['functional', 'non-functional'] as const) if (!definition.requirements.some(entry => entry.kind === kind && entry.critical)) fail(`needs at least one critical ${kind} requirement`);
  if (definition.clarifications.length < 4 || !definition.clarifications.some(entry => entry.important)) fail('needs at least 4 clarifications, some important');
  const estimateIds = new Set(definition.estimates.map(entry => entry.id));
  for (const quantity of definition.estimates) {
    if (!(quantity.reference > 0) || !(quantity.factor > 1)) fail(`estimate ${quantity.id} needs a positive reference and a factor above 1`);
    if (quantity.role === 'derived' && !quantity.formula) fail(`derived estimate ${quantity.id} needs a formula`);
    for (const term of [...(quantity.formula?.product ?? []), ...(quantity.formula?.divide ?? [])]) if (typeof term === 'string' && !estimateIds.has(term)) fail(`estimate ${quantity.id} refers to unknown quantity ${term}`);
  }
  if (!definition.estimates.some(entry => entry.role === 'assumption') || !definition.estimates.some(entry => entry.role === 'derived')) fail('needs both assumptions and derived estimates');
  if (!definition.api.some(entry => entry.required)) fail('needs a required API operation');
  if (!definition.entities.some(entry => entry.required)) fail('needs a required entity');
  for (const role of definition.roles) for (const kind of role.kinds) if (!(kind in byKind)) fail(`role ${role.id} uses unknown kind ${kind}`);
  if (!definition.roles.some(role => role.required)) fail('needs a required architecture role');
  for (const override of definition.benchmark.overrides) for (const kind of override.kinds) if (!(kind in byKind)) fail(`benchmark override uses unknown kind ${kind}`);
  if (definition.deepDives.length < 2) fail('needs at least two deep dives');
  for (const id of definition.sharedFollowUps) if (!SHARED_FOLLOW_UPS.some(entry => entry.id === id)) fail(`unknown shared follow-up ${id}`);
  const pool = followUpPool(definition); unique('follow-up', pool.map(entry => entry.id));
  const poolIds = new Set(pool.map(entry => entry.id));
  // Every part of every trigger must refer to things that exist; branch conditions must name the parent's concepts.
  const checkTrigger = (id: string, trigger: Trigger) => {
    if ('all' in trigger || 'any' in trigger) { const parts = 'all' in trigger ? trigger.all : trigger.any; if (!parts.length) fail(`follow-up ${id} has an empty composite trigger`); for (const part of parts) checkTrigger(id, part); return; }
    if ('after' in trigger) {
      const parent = pool.find(entry => entry.id === trigger.after);
      if (!parent) { fail(`follow-up ${id} follows ${trigger.after}, which this problem does not include`); return; }
      for (const concept of trigger.ifMissing ?? []) if (!parent.concepts.some(entry => entry.id === concept)) fail(`follow-up ${id} branches on unknown concept ${concept} of ${parent.id}`);
      if (trigger.ifScoreBelow !== undefined && (trigger.ifScoreBelow < 1 || trigger.ifScoreBelow > 4)) fail(`follow-up ${id} has an impossible score condition`);
    }
    if ('hasKind' in trigger || 'lacksKind' in trigger) for (const kind of 'hasKind' in trigger ? trigger.hasKind : trigger.lacksKind) if (!(kind in byKind)) fail(`follow-up ${id} uses unknown kind ${kind}`);
    if ('mentions' in trigger && !STAGES.includes(trigger.mentions.stage)) fail(`follow-up ${id} mentions an unknown stage`);
    if ('omits' in trigger && !STAGES.includes(trigger.omits.stage)) fail(`follow-up ${id} omits an unknown stage`);
    if ('reached' in trigger && !STAGES.includes(trigger.reached)) fail(`follow-up ${id} waits for an unknown stage`);
  };
  for (const entry of pool) {
    checkTrigger(entry.id, entry.trigger);
    if ('any' in entry.trigger && JSON.stringify(entry.trigger).includes('"after"')) fail(`follow-up ${entry.id} hides a branch inside "any"; use "all"`);
    if (entry.next && !poolIds.has(entry.next)) fail(`follow-up ${entry.id} points to missing next ${entry.next}`);
    if (entry.next && parentOf(pool.find(item => item.id === entry.next)!.trigger)?.after !== entry.id) fail(`follow-up ${entry.id} names ${entry.next} as next, but that question does not follow it`);
  }
  // Requirement changes, stage plans and reference versions.
  unique('requirement change', (definition.changes ?? []).map(entry => entry.id));
  for (const change of definition.changes ?? []) {
    if (change.considerations.length < 2) fail(`change ${change.id} needs at least two expected considerations`);
    if (!change.measurable || !change.notModelled) fail(`change ${change.id} must say what the simulator can and cannot show`);
    if (change.scenario?.kind === 'outage') for (const kind of change.scenario.kinds) if (!(kind in byKind)) fail(`change ${change.id} uses unknown kind ${kind}`);
    for (const resource of change.resources) { const problem = resourceProblem(resource); if (problem) fail(`change ${change.id}: ${problem}`); }
  }
  for (const [stage, share] of Object.entries(definition.stageAllocation ?? {})) {
    if (!STAGES.includes(stage as never)) fail(`stage plan names an unknown stage ${stage}`);
    if (!(share! > 0)) fail(`stage plan gives ${stage} no time`);
    if (stage === 'changes' && !definition.changes?.length) fail('stage plan gives time to requirement changes, but there are none');
  }
  const referenceVersions = [definition.reference.version ?? definition.version, ...(definition.referenceHistory ?? []).map(entry => entry.version ?? 1)];
  if (new Set(referenceVersions).size !== referenceVersions.length) fail('reference versions must be unique');
  if ((definition.reference.version ?? definition.version) > definition.version) fail('the reference cannot be newer than its definition');
  const requirementIds = new Set(definition.requirements.map(entry => entry.id));
  for (const role of definition.roles) for (const id of role.covers ?? []) if (!requirementIds.has(id)) fail(`role ${role.id} covers unknown requirement ${id}`);
  for (const prompt of [...definition.deepDives, ...pool]) {
    if (!prompt.concepts.length) fail(`${prompt.id} has no concepts to evaluate`);
    if (!prompt.reference.length) fail(`${prompt.id} has no reference considerations`);
    for (const resource of prompt.resources) { const problem = resourceProblem(resource); if (problem) fail(`${prompt.id}: ${problem}`); }
  }
  for (const id of definition.lessons) if (!LESSON_IDS.has(id)) fail(`unknown lesson ${id}`);
  for (const kind of definition.lld) if (!(kind in LLD_COVERAGE)) fail(`no LLD for ${kind}`);
  if (definition.tradeoffs.length < 2) fail('needs at least two trade-off concepts');
  const diagramIds = new Set(definition.reference.architecture.diagram.nodes.map(node => node.id));
  for (const edge of definition.reference.architecture.diagram.edges) if (!diagramIds.has(edge.from) || !diagramIds.has(edge.to)) fail('reference diagram has a dangling edge');
  return errors;
}
