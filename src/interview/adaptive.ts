import { byKind, type Kind } from '../app/catalog';
import { validateArchitecture } from '../app/validation';
import { sharedFollowUp } from './followups';
import { scoreText } from './score';
import { type InterviewSession } from './session';
import { isSubmitted, stageHasContent } from './workflow';
import { checkConcepts, matchedPhrase, mentions } from './text';
import { STAGES, STAGE_LABELS, type FollowUp, type InterviewDefinition, type StageId, type Trigger } from './types';

/**
 * The adaptive follow-up engine. It is rule-based and fully data-driven: every follow-up carries a trigger (see
 * `Trigger` in types.ts) that is evaluated against the user's own architecture, answers and progress. The engine
 *  - asks root questions whose trigger holds, highest priority first, at most MAX_ROOT_FOLLOW_UPS at a time;
 *  - branches: a chained question becomes eligible once its parent is submitted, optionally only when the parent's
 *    answer scored below / at least a threshold, or left out specific expected concepts;
 *  - avoids repetition: one question per topic, and none whose every expected concept one of the user's deep-dive
 *    answers already covered (that question's branches still open, judged on the answer that covered it);
 *  - ignores components that carry no traffic (a disconnected cache does not trigger caching questions).
 * Every decision is explained: the rule that fired is returned with the question, and suppressed questions are
 * returned with the reason. Nothing here is an AI model or an external service.
 */
export const MAX_ROOT_FOLLOW_UPS = 5;
export function followUpPool(definition: InterviewDefinition): FollowUp[] {
  return [...definition.followUps, ...definition.sharedFollowUps.map(id => sharedFollowUp(id)).filter((entry): entry is FollowUp => Boolean(entry))];
}
export function stageText(session: InterviewSession, stage: StageId): string {
  switch (stage) {
    case 'requirements': return Object.values(session.requirements).join('\n') + '\n' + session.clarificationNotes;
    case 'estimation': return session.estimateNotes;
    case 'api': return session.endpoints.map(endpoint => [endpoint.method, endpoint.path, endpoint.request, endpoint.response, endpoint.errors, endpoint.notes].join(' ')).join('\n');
    case 'data': return session.entities.map(entity => Object.values(entity).join(' ')).join('\n');
    case 'design': return [session.designNotes, ...Object.values(session.decisions), ...Object.values(session.explanations).flatMap(entry => Object.values(entry))].join('\n');
    case 'deepdive': return Object.values(session.deepDives).join('\n');
    case 'followups': return Object.values(session.followUps).map(entry => entry.answer).join('\n');
    case 'changes': return Object.values(session.changes).map(entry => entry.answer).join('\n');
    case 'review': return Object.values(session.review).join('\n');
  }
}

type After = Extract<Trigger, { after: string }>;
/** The parent condition of a chained follow-up (an `after` trigger, possibly inside `all`). */
export function parentOf(trigger: Trigger): After | null {
  if ('after' in trigger) return trigger;
  if ('all' in trigger) for (const part of trigger.all) { const found = parentOf(part); if (found) return found; }
  return null;
}

type Context = { definition: InterviewDefinition; session: InterviewSession; pool: FollowUp[]; live: Map<Kind, string[]>; covering: Map<string, string> };
type Check = { ok: boolean; why: string };
const kindList = (kinds: Kind[]) => [...new Set(kinds.map(kind => byKind[kind].label))].join(', ');
const reached = (session: InterviewSession, stage: StageId) => session.completedStages.includes(stage) || stageHasContent(session, stage) || STAGES.indexOf(session.stage) > STAGES.indexOf(stage);

/** The text a parent question is judged on: the user's submitted answer, or the text that already covered it. */
const parentText = (ctx: Context, id: string) => isSubmitted(ctx.session, id) ? ctx.session.followUps[id].answer : ctx.covering.get(id) ?? null;

function check(trigger: Trigger, ctx: Context): Check {
  const { session } = ctx;
  if ('always' in trigger) return { ok: true, why: 'asked in every interview' };
  if ('hasKind' in trigger) { const present = trigger.hasKind.filter(kind => ctx.live.has(kind)); return { ok: present.length > 0, why: `your design includes ${present.length ? ctx.live.get(present[0])!.join(', ') : kindList(trigger.hasKind)} (${kindList(present.length ? present : trigger.hasKind)})` }; }
  if ('lacksKind' in trigger) return { ok: Boolean(session.architecture?.nodes.length) && !trigger.lacksKind.some(kind => ctx.live.has(kind)), why: `your design has no working ${kindList(trigger.lacksKind)}` };
  if ('mentions' in trigger) { const phrase = matchedPhrase(stageText(session, trigger.mentions.stage), trigger.mentions.any); return { ok: phrase !== null, why: `your ${STAGE_LABELS[trigger.mentions.stage].toLowerCase()} answers mention “${phrase ?? trigger.mentions.any[0]}”` }; }
  if ('omits' in trigger) return { ok: stageHasContent(session, trigger.omits.stage) && !mentions(stageText(session, trigger.omits.stage), trigger.omits.any), why: `your ${STAGE_LABELS[trigger.omits.stage].toLowerCase()} answers never mention ${trigger.omits.any.filter(phrase => !phrase.startsWith('/')).slice(0, 3).map(phrase => `“${phrase}”`).join(' or ')}` };
  if ('reached' in trigger) return { ok: reached(session, trigger.reached), why: `you have reached ${STAGE_LABELS[trigger.reached].toLowerCase()}` };
  if ('all' in trigger) { const parts = trigger.all.map(part => check(part, ctx)); return { ok: parts.every(part => part.ok), why: parts.map(part => part.why).join(' and ') }; }
  if ('any' in trigger) { const parts = trigger.any.map(part => check(part, ctx)); const hit = parts.find(part => part.ok); return { ok: Boolean(hit), why: hit?.why ?? parts.map(part => part.why).join(' or ') }; }
  const parent = ctx.pool.find(item => item.id === trigger.after);
  const text = parent ? parentText(ctx, parent.id) : null;
  if (!parent || text === null) return { ok: false, why: `you have not answered “${parent?.title ?? trigger.after}” yet` };
  const result = scoreText(text, parent.concepts, parent.contradictions);
  const source = isSubmitted(session, parent.id) ? `you answered “${parent.title}”` : `you already covered “${parent.title}” in other answers`;
  if (trigger.ifScoreBelow !== undefined && !(result.score < trigger.ifScoreBelow)) return { ok: false, why: `${source} with a score of ${result.score}/4 (asked only below ${trigger.ifScoreBelow})` };
  if (trigger.ifScoreAtLeast !== undefined && !(result.score >= trigger.ifScoreAtLeast)) return { ok: false, why: `${source} with a score of ${result.score}/4 (asked only from ${trigger.ifScoreAtLeast})` };
  if (trigger.ifMissing) {
    const missing = parent.concepts.filter(concept => trigger.ifMissing!.includes(concept.id) && result.missedIds.includes(concept.id));
    if (!missing.length) return { ok: false, why: `${source} and covered ${parent.concepts.filter(concept => trigger.ifMissing!.includes(concept.id)).map(concept => concept.label).join(', ')}` };
    return { ok: true, why: `${source} without covering ${missing.map(concept => concept.label).join(', ')}` };
  }
  return { ok: true, why: `${source}${trigger.ifScoreBelow !== undefined || trigger.ifScoreAtLeast !== undefined ? ` (score ${result.score}/4)` : ''}` };
}

export type ActiveFollowUp = {
  followUp: FollowUp;
  /** The question's stated reason. */
  reason: string;
  /** The rule that fired, in terms of the user's own design and answers. */
  rule: string;
  /** False when the question was asked earlier but its trigger no longer holds; it stays for the record. */
  applies: boolean;
  depth: number; parent?: string;
};
export type SuppressedFollowUp = { followUp: FollowUp; why: string };
export type FollowUpPlan = { active: ActiveFollowUp[]; suppressed: SuppressedFollowUp[] };
const topicOf = (entry: FollowUp) => entry.topic ?? entry.id;

/** The questions to ask now, and the ones held back with the reason. Deterministic for a given session. */
export function planFollowUps(definition: InterviewDefinition, session: InterviewSession): FollowUpPlan {
  const pool = followUpPool(definition);
  const live = new Map<Kind, string[]>();
  const architecture = session.architecture;
  if (architecture?.nodes.length) {
    const validation = validateArchitecture({ nodes: architecture.nodes.map(node => ({ id: node.id, kind: node.kind, config: node.config })), edges: architecture.edges });
    for (const node of architecture.nodes) if (validation.components[node.id]?.status !== 'dead') live.set(node.kind, [...(live.get(node.kind) ?? []), node.label || byKind[node.kind].label]);
  }
  // A single deep-dive answer that already covers every point a question would probe makes that question repetitive.
  // (One answer, not all text pooled together: words from unrelated notes must not add up to coverage.)
  const covering = new Map<string, string>(); const coveredBy = new Map<string, string>();
  for (const entry of pool) {
    if (session.followUps[entry.id] || entry.concepts.length < 2) continue;
    const prompt = definition.deepDives.find(deep => checkConcepts(session.deepDives[deep.id] ?? '', entry.concepts).every(result => result.found));
    if (prompt) { covering.set(entry.id, session.deepDives[prompt.id]); coveredBy.set(entry.id, prompt.title); }
  }
  const ctx: Context = { definition, session, pool, live, covering };

  const asked = (id: string) => Boolean(session.followUps[id]);
  const active: ActiveFollowUp[] = []; const suppressed: SuppressedFollowUp[] = [];
  const topics = new Map<string, string>();
  for (const id of Object.keys(session.followUps)) { const entry = pool.find(item => item.id === id); if (entry) topics.set(topicOf(entry), entry.title); }
  const included = new Set<string>();
  /** Adds a question whose trigger holds, unless it repeats a topic or is already covered; then visits its branches. */
  const consider = (entry: FollowUp, rule: string, depth: number, parent?: string) => {
    if (included.has(entry.id)) return;
    if (!asked(entry.id)) {
      const sameTopic = topics.get(topicOf(entry));
      if (sameTopic && sameTopic !== entry.title) { suppressed.push({ followUp: entry, why: `Not asked: “${sameTopic}” already covers this topic.` }); return; }
      if (covering.has(entry.id)) { suppressed.push({ followUp: entry, why: `Not asked: your deep-dive answer “${coveredBy.get(entry.id)}” already covers every point it would probe.` }); included.add(entry.id); visitChildren(entry, depth); return; }
    }
    included.add(entry.id); topics.set(topicOf(entry), entry.title);
    active.push({ followUp: entry, reason: entry.because, rule, applies: true, depth, ...(parent ? { parent } : {}) });
    visitChildren(entry, depth + 1);
  };
  const visitChildren = (entry: FollowUp, depth: number) => {
    for (const child of pool.filter(item => parentOf(item.trigger)?.after === entry.id)) { const result = check(child.trigger, ctx); if (result.ok) consider(child, result.why, depth, entry.id); }
  };

  // Roots: questions without a parent. Already-asked roots always stay; new ones fill up to the cap by priority.
  const roots = pool.filter(entry => !parentOf(entry.trigger)).map(entry => ({ entry, result: check(entry.trigger, ctx) }))
    .filter(item => item.result.ok).sort((a, b) => Number(asked(b.entry.id)) - Number(asked(a.entry.id)) || b.entry.priority - a.entry.priority || a.entry.id.localeCompare(b.entry.id));
  let rootCount = 0;
  for (const { entry, result } of roots) {
    if (!asked(entry.id) && rootCount >= MAX_ROOT_FOLLOW_UPS) { suppressed.push({ followUp: entry, why: `Not asked: the interviewer asks at most ${MAX_ROOT_FOLLOW_UPS} opening questions, and higher-priority ones were chosen.` }); continue; }
    const before = active.length; consider(entry, result.why, 0);
    if (active.length > before && active[before].followUp.id === entry.id) rootCount += 1;
  }
  // Questions asked earlier whose trigger no longer holds stay listed, so the record is complete.
  for (const id of Object.keys(session.followUps)) {
    const entry = pool.find(item => item.id === id);
    if (entry && !active.some(item => item.followUp.id === id)) active.push({ followUp: entry, reason: session.followUps[id].reason ?? entry.because, rule: 'asked earlier; its trigger no longer applies to your current design', applies: false, depth: 0 });
  }
  return { active, suppressed };
}
export const activeFollowUps = (definition: InterviewDefinition, session: InterviewSession) => planFollowUps(definition, session).active;

/** A readable statement of a trigger, for showing where a question can lead. */
export function describeTrigger(trigger: Trigger, pool: FollowUp[]): string {
  if ('always' in trigger) return 'always';
  if ('hasKind' in trigger) return `the design includes ${kindList(trigger.hasKind)}`;
  if ('lacksKind' in trigger) return `the design has no ${kindList(trigger.lacksKind)}`;
  if ('mentions' in trigger) return `the ${STAGE_LABELS[trigger.mentions.stage].toLowerCase()} answers mention ${trigger.mentions.any.slice(0, 3).map(phrase => `“${phrase}”`).join(' or ')}`;
  if ('omits' in trigger) return `the ${STAGE_LABELS[trigger.omits.stage].toLowerCase()} answers leave out ${trigger.omits.any.filter(phrase => !phrase.startsWith('/')).slice(0, 3).map(phrase => `“${phrase}”`).join(' or ')}`;
  if ('reached' in trigger) return `the interview reaches ${STAGE_LABELS[trigger.reached].toLowerCase()}`;
  if ('all' in trigger) return trigger.all.map(part => describeTrigger(part, pool)).join(' and ');
  if ('any' in trigger) return trigger.any.map(part => describeTrigger(part, pool)).join(' or ');
  const parent = pool.find(item => item.id === trigger.after);
  const conditions = [
    ...(trigger.ifScoreBelow !== undefined ? [`it scores below ${trigger.ifScoreBelow}/4`] : []),
    ...(trigger.ifScoreAtLeast !== undefined ? [`it scores at least ${trigger.ifScoreAtLeast}/4`] : []),
    ...(trigger.ifMissing ? [`it leaves out ${parent?.concepts.filter(concept => trigger.ifMissing!.includes(concept.id)).map(concept => concept.label).join(', ')}`] : []),
  ];
  return `after “${parent?.title ?? trigger.after}” is answered${conditions.length ? `, if ${conditions.join(' and ')}` : ''}`;
}
/** The questions an answer can lead to, with the condition for each. */
export function nextQuestions(definition: InterviewDefinition, id: string): Array<{ followUp: FollowUp; condition: string }> {
  const pool = followUpPool(definition);
  return pool.filter(entry => parentOf(entry.trigger)?.after === id).map(entry => ({ followUp: entry, condition: describeTrigger(entry.trigger, pool) }));
}
