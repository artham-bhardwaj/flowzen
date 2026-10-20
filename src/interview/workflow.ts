import type { ArchitectureSnapshot } from '../challenges/attempts';
import { EMPTY_EXPLANATION, architectureKey, planFor, update, type Checkpoint, type DecisionExplanation, type Endpoint, type Entity, type InterviewSession, type RunEvidence, type SessionEvent, type SessionEventType } from './session';
import { STAGE_ALLOCATION, type InterviewDefinition, type StageId } from './types';

/**
 * Operations on a running interview session. Every function is pure: it returns a new session and never edits its
 * input. Timeline entries are appended for playback; checkpoints are only ever added.
 */
export const MAX_CHECKPOINTS = 40;
export const MAX_EVENTS = 600;
export const EXPLANATION_FIELDS: Array<{ key: keyof DecisionExplanation; label: string; placeholder: string }> = [
  { key: 'problem', label: 'Problem it solves', placeholder: 'Which requirement or bottleneck makes this necessary?' },
  { key: 'alternatives', label: 'Alternatives considered', placeholder: 'What else could do this job, and why not that?' },
  { key: 'tradeoffs', label: 'Trade-offs accepted', placeholder: 'What does this choice cost (latency, consistency, money, operations)?' },
  { key: 'failure', label: 'Failure modes', placeholder: 'What happens when it fails or slows down, and how is that handled?' },
  { key: 'evidence', label: 'Evidence or assumptions', placeholder: 'Numbers from your estimates or measurements, or the assumption you rely on.' },
];
/** Appends a timeline entry (capped; the oldest non-structural entries go first only past the cap). */
export function logEvent(session: InterviewSession, type: SessionEventType, label: string, at: number, ref?: string): InterviewSession {
  const event: SessionEvent = { at, elapsedMs: session.timing.totalMs, stage: session.stage, type, label, ...(ref ? { ref } : {}) };
  return { ...session, events: [...session.events, event].slice(-MAX_EVENTS), updatedAt: at };
}

/** Moves to a stage. Leaving a stage with content marks it complete; leaving the design stage saves a checkpoint if the design changed. */
export function goToStage(session: InterviewSession, stage: StageId, at: number): InterviewSession {
  if (stage === session.stage) return session;
  let next = session;
  if (session.stage === 'design') next = saveCheckpoint(next, { at, label: 'Leaving high-level design', kind: 'auto' });
  const done = stageHasContent(next, next.stage) && !next.completedStages.includes(next.stage) ? [...next.completedStages, next.stage] : next.completedStages;
  next = logEvent(next, 'stage', `Moved to ${stage}`, at, stage);
  return { ...next, stage, completedStages: done, updatedAt: at };
}
export function stageHasContent(session: InterviewSession, stage: StageId): boolean {
  switch (stage) {
    case 'requirements': return Boolean(session.requirements.functional.trim() || session.requirements.nonFunctional.trim());
    case 'estimation': return Object.values(session.estimates).some(value => value.trim());
    case 'api': return session.endpoints.some(endpoint => endpoint.path.trim());
    case 'data': return session.entities.some(entity => entity.name.trim());
    case 'design': return Boolean(session.architecture?.nodes.length);
    case 'deepdive': return Object.values(session.deepDives).some(answer => answer.trim());
    case 'followups': return Object.values(session.followUps).some(entry => entry.answer.trim());
    case 'changes': return Object.values(session.changes).some(entry => entry.answer.trim());
    case 'review': return Object.values(session.review).some(text => text.trim());
  }
}

// ── Help usage ─────────────────────────────────────────────────────────────────
/** Hints are a practice-mode feature; a mock interview never reveals them. Each reveal is recorded. */
export function revealHint(session: InterviewSession, stage: StageId, index: number, at: number): InterviewSession {
  if (session.mode === 'mock' || session.hintsUsed.some(hint => hint.stage === stage && hint.index === index)) return session;
  return logEvent({ ...session, hintsUsed: [...session.hintsUsed, { stage, index, at }] }, 'hint', `Hint ${index + 1} shown`, at, stage);
}
export const hintsShown = (session: InterviewSession, stage: StageId) => session.hintsUsed.filter(hint => hint.stage === stage).length;
/** Practice mode shows reference considerations once an answer exists; mock mode only after submission. */
export const canViewReference = (session: InterviewSession, hasAnswer: boolean) => session.mode === 'practice' && hasAnswer;
export function viewReference(session: InterviewSession, key: string, at: number): InterviewSession {
  if (session.referencesViewed.includes(key)) return session;
  return logEvent({ ...session, referencesViewed: [...session.referencesViewed, key] }, 'reference', `Reference viewed: ${key}`, at, key);
}
export function askClarification(session: InterviewSession, id: string, at: number): InterviewSession {
  return session.clarificationsAsked.includes(id) ? session : logEvent({ ...session, clarificationsAsked: [...session.clarificationsAsked, id] }, 'clarification', 'Clarifying question asked', at, id);
}

// ── Follow-ups ─────────────────────────────────────────────────────────────────
/** Records that follow-ups were presented, with the reason shown, so the record shows exactly what was asked and why. */
export function markAsked(session: InterviewSession, items: Array<{ id: string; reason: string }>, at: number): InterviewSession {
  const missing = items.filter(item => !session.followUps[item.id]); if (!missing.length) return session;
  let next: InterviewSession = { ...session, followUps: { ...session.followUps, ...Object.fromEntries(missing.map(item => [item.id, { askedAt: at, answer: '', reason: item.reason, stage: session.stage }])) } };
  for (const item of missing) next = logEvent(next, 'followup-asked', `Asked: ${item.id}`, at, item.id);
  return next;
}
export function answerFollowUp(session: InterviewSession, id: string, answer: string, at: number): InterviewSession {
  const previous = session.followUps[id] ?? { askedAt: at, answer: '' };
  return { ...session, followUps: { ...session.followUps, [id]: { ...previous, answer, ...(answer.trim() ? { answeredAt: previous.answeredAt ?? at } : {}) } }, updatedAt: at };
}
/** Submits an answer. It stays editable; the first submission time is kept and later edits are still evaluated. */
export function submitFollowUp(session: InterviewSession, id: string, at: number): InterviewSession {
  const entry = session.followUps[id]; if (!entry?.answer.trim() || entry.submittedAt) return session;
  return logEvent({ ...session, followUps: { ...session.followUps, [id]: { ...entry, submittedAt: at } } }, 'followup-submitted', `Answered: ${id}`, at, id);
}
export const isSubmitted = (session: InterviewSession, id: string) => Boolean(session.followUps[id]?.submittedAt && session.followUps[id].answer.trim());

// ── Decisions ──────────────────────────────────────────────────────────────────
export function explain(session: InterviewSession, nodeId: string, patch: Partial<DecisionExplanation>, at: number): InterviewSession {
  return update(session, { explanations: { ...session.explanations, [nodeId]: { ...EMPTY_EXPLANATION, ...session.explanations[nodeId], ...patch } } }, at);
}

// ── Checkpoints ────────────────────────────────────────────────────────────────
const designKey = (architecture: ArchitectureSnapshot | null) => architectureKey(architecture);
export const latestCheckpoint = (session: InterviewSession) => session.checkpoints[session.checkpoints.length - 1];
/**
 * Saves the current architecture as a checkpoint. Automatic checkpoints are skipped when nothing simulation-relevant
 * changed since the last one, or when the limit is reached; checkpoints that requirement changes depend on are always kept.
 */
export function saveCheckpoint(session: InterviewSession, options: { at: number; label: string; kind: Checkpoint['kind'] }): InterviewSession {
  const architecture = session.architecture; if (!architecture?.nodes.length) return session;
  const last = latestCheckpoint(session);
  if (options.kind === 'auto' && last && designKey(last.architecture) === designKey(architecture)) return session;
  const essential = options.kind === 'change-before' || options.kind === 'change-after' || options.kind === 'restore';
  if (!essential && session.checkpoints.length >= MAX_CHECKPOINTS) return session;
  const checkpoint: Checkpoint = { id: `cp-${session.checkpoints.length + 1}-${options.at.toString(36)}`, at: options.at, label: options.label, kind: options.kind, stage: session.stage, architecture: structuredClone(architecture), decisions: structuredClone(session.decisions) };
  return logEvent({ ...session, checkpoints: [...session.checkpoints, checkpoint] }, 'checkpoint', `Checkpoint: ${options.label}`, options.at, checkpoint.id);
}
/** Restores a checkpoint into the working design. The current design is saved first, so nothing is lost. */
export function restoreCheckpoint(session: InterviewSession, checkpointId: string, at: number): InterviewSession {
  const checkpoint = session.checkpoints.find(entry => entry.id === checkpointId); if (!checkpoint) return session;
  let next = session;
  if (designKey(session.architecture) !== designKey(checkpoint.architecture)) next = saveCheckpoint(next, { at, label: `Before restoring “${checkpoint.label}”`, kind: 'restore' });
  next = logEvent(next, 'restore', `Restored checkpoint “${checkpoint.label}”`, at, checkpoint.id);
  return { ...next, architecture: structuredClone(checkpoint.architecture), decisions: { ...next.decisions, ...structuredClone(checkpoint.decisions) }, updatedAt: at };
}

// ── Requirement changes ────────────────────────────────────────────────────────
/** Introduces a requirement change: the current architecture is kept as the original (baseline) checkpoint. */
export function introduceChange(session: InterviewSession, changeId: string, title: string, at: number): InterviewSession {
  if (session.changes[changeId] || !session.architecture?.nodes.length) return session;
  const next = saveCheckpoint(session, { at, label: `Original design, before “${title}”`, kind: 'change-before' });
  const baseline = latestCheckpoint(next);
  return logEvent({ ...next, changes: { ...next.changes, [changeId]: { introducedAt: at, baselineId: baseline.id, answer: '', runs: {} } } }, 'change-introduced', `Requirement change: ${title}`, at, changeId);
}
/** Saves the current architecture as the revision for a change (it can be saved again after further edits). */
export function reviseChange(session: InterviewSession, changeId: string, title: string, at: number): InterviewSession {
  const entry = session.changes[changeId]; if (!entry) return session;
  const next = saveCheckpoint(session, { at, label: `Revised for “${title}”`, kind: 'change-after' });
  const revision = latestCheckpoint(next);
  return logEvent({ ...next, changes: { ...next.changes, [changeId]: { ...entry, revisionId: revision.id, runs: { original: entry.runs.original } } } }, 'change-revised', `Revision saved: ${title}`, at, changeId);
}
export function answerChange(session: InterviewSession, changeId: string, answer: string, at: number): InterviewSession {
  const entry = session.changes[changeId]; if (!entry) return session;
  return update(session, { changes: { ...session.changes, [changeId]: { ...entry, answer } } }, at);
}
export function submitChange(session: InterviewSession, changeId: string, at: number): InterviewSession {
  const entry = session.changes[changeId]; if (!entry?.answer.trim() || entry.submittedAt) return session;
  return logEvent({ ...session, changes: { ...session.changes, [changeId]: { ...entry, submittedAt: at } } }, 'change-submitted', `Response submitted: ${changeId}`, at, changeId);
}
export function recordChangeRun(session: InterviewSession, changeId: string, which: 'original' | 'revised', evidence: RunEvidence, at: number): InterviewSession {
  const entry = session.changes[changeId]; if (!entry) return session;
  return logEvent({ ...session, changes: { ...session.changes, [changeId]: { ...entry, runs: { ...entry.runs, [which]: evidence } } } }, 'scenario', `Measured ${which} design: ${evidence.label}`, at, changeId);
}
export const checkpointById = (session: InterviewSession, id: string | undefined) => id ? session.checkpoints.find(entry => entry.id === id) : undefined;

// ── Timing ─────────────────────────────────────────────────────────────────────
/**
 * Adds active time to a stage. Time only accrues while the session is open, so reloads lose no work and add no time.
 * When a mock interview's limit is crossed, the expiry is recorded once; nothing is locked.
 */
export function tick(session: InterviewSession, ms: number, stage: StageId = session.stage, at: number = session.updatedAt): InterviewSession {
  if (ms <= 0) return session;
  const stageMs = { ...session.timing.stageMs, [stage]: (session.timing.stageMs[stage] ?? 0) + ms };
  const next = { ...session, timing: { totalMs: session.timing.totalMs + ms, stageMs } };
  const limitMs = session.durationMin ? session.durationMin * 60_000 : null;
  if (limitMs !== null && !session.expired && next.timing.totalMs >= limitMs) return logEvent({ ...next, expired: { at, stage } }, 'expired', 'Time ran out; work continued as overtime', at);
  return next;
}
export type Clock = { limitMs: number | null; elapsedMs: number; remainingMs: number | null; overtime: boolean; stageBudgetMs: number | null; stageMs: number; stageOver: boolean };
/** Remaining time never locks anything: when it runs out the session is marked as over time and stays editable. */
export function clock(session: InterviewSession): Clock {
  const limitMs = session.durationMin ? session.durationMin * 60_000 : null;
  const stageBudgetMs = limitMs === null ? null : session.plan?.stageMs[session.stage] ?? Math.round(limitMs * STAGE_ALLOCATION[session.stage]);
  const stageMs = session.timing.stageMs[session.stage] ?? 0;
  return {
    limitMs, elapsedMs: session.timing.totalMs, remainingMs: limitMs === null ? null : Math.max(0, limitMs - session.timing.totalMs),
    overtime: limitMs !== null && session.timing.totalMs >= limitMs, stageBudgetMs, stageMs, stageOver: stageBudgetMs !== null && stageMs > stageBudgetMs,
  };
}
export type Pacing = { tone: 'ok' | 'warn' | 'bad'; message: string } | null;
/**
 * A pacing note for mock interviews, from the plan: over time; over this stage's budget; or behind schedule (the time
 * left is less than the plan for the stages not yet worked on). Practice sessions and sessions with pacing off get none.
 */
export function pacing(session: InterviewSession, stages: StageId[]): Pacing {
  if (!session.plan || !session.pacing) return null;
  const now = clock(session);
  if (now.overtime) return { tone: 'bad', message: `Time is up (${formatDuration(now.elapsedMs - now.limitMs!)} over). Your work is kept: finish and review when ready.` };
  if (now.stageOver) return { tone: 'warn', message: `This stage has taken ${formatDuration(now.stageMs)}; the plan suggests ${formatDuration(now.stageBudgetMs!)}. Consider moving on.` };
  const index = stages.indexOf(session.stage);
  const ahead = stages.slice(index + 1).filter(stage => !(session.timing.stageMs[stage]));
  const needed = ahead.reduce((sum, stage) => sum + (session.plan!.stageMs[stage] ?? 0), 0) + Math.max(0, (now.stageBudgetMs ?? 0) - now.stageMs);
  if (now.remainingMs! < needed) return { tone: 'warn', message: `Behind schedule: ${formatDuration(now.remainingMs!)} left, the remaining stages are planned for ${formatDuration(needed)}.` };
  return { tone: 'ok', message: `On schedule: ${formatDuration(now.remainingMs!)} left.` };
}
export const stageBudgets = (definition: Pick<InterviewDefinition, 'changes' | 'stageAllocation'>, durationMin: number) => planFor(definition, durationMin);
export const formatDuration = (ms: number) => { const total = Math.round(ms / 1000); const m = Math.floor(total / 60); const s = total % 60; return `${m}:${String(s).padStart(2, '0')}`; };

export const newEndpoint = (id: string): Endpoint => ({ id, method: 'GET', path: '', request: '', response: '', auth: false, idempotent: false, paginated: false, errors: '', notes: '' });
export const newEntity = (id: string): Entity => ({ id, name: '', fields: '', primaryKey: '', indexes: '', relationships: '', accessPatterns: '', consistency: '' });
