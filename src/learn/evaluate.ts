import type { ArchitectureSnapshot } from '../challenges/attempts';
import type { SimulationInput } from '../simulation/engine';
import { labInput, type LabMeasurements } from '../lab/measure';
import type { BuildCheck, BuildTask, ClassifyTask, NumericTask, Question } from './types';

/** Pure evaluation of knowledge checks and practical tasks. Nothing here touches the DOM or storage. */

// ── Knowledge checks ────────────────────────────────────────────────────────────
export type QuizAnswers = Record<string, string[]>;
export type QuestionResult = { id: string; answered: boolean; correct: boolean; selected: string[]; missed: string[]; wrong: string[] };
export type QuizResult = { score: number; total: number; percent: number; passed: boolean; questions: QuestionResult[] };
/** Share of questions that must be correct for the check to count as completed. */
export const QUIZ_PASS_PERCENT = 70;

/** A question is correct only when exactly the correct options are selected (all of them, and nothing else). */
export function gradeQuestion(question: Question, selected: string[] = []): QuestionResult {
  const chosen = [...new Set(selected)].filter(id => question.options.some(option => option.id === id));
  const missed = question.correct.filter(id => !chosen.includes(id));
  const wrong = chosen.filter(id => !question.correct.includes(id));
  return { id: question.id, answered: chosen.length > 0, correct: chosen.length > 0 && !missed.length && !wrong.length, selected: chosen, missed, wrong };
}
export function gradeQuiz(questions: Question[], answers: QuizAnswers): QuizResult {
  const results = questions.map(question => gradeQuestion(question, answers[question.id]));
  const score = results.filter(result => result.correct).length;
  const percent = questions.length ? Math.round(score / questions.length * 100) : 0;
  return { score, total: questions.length, percent, passed: percent >= QUIZ_PASS_PERCENT, questions: results };
}

// ── Numeric and classification tasks ───────────────────────────────────────────
/** Parses a typed number, accepting thousands separators, a trailing unit or a percent sign. */
export function parseAnswer(text: string): number | null {
  const match = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/i.exec(text.replace(/(\d),(?=\d{3}\b)/g, '$1'));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}
export type NumericResult = { correct: boolean; value: number | null; answer: number; tolerance: number };
export function gradeNumeric(task: NumericTask, text: string): NumericResult {
  const value = parseAnswer(text);
  const tolerance = Math.abs(task.answer) * task.tolerancePct / 100;
  return { correct: value !== null && Math.abs(value - task.answer) <= tolerance + 1e-9, value, answer: task.answer, tolerance };
}
export type ClassifyResult = { correct: boolean; items: Array<{ id: string; chosen: string | null; correct: boolean }> };
export function gradeClassify(task: ClassifyTask, choices: Record<string, string>): ClassifyResult {
  const items = task.items.map(item => ({ id: item.id, chosen: choices[item.id] ?? null, correct: choices[item.id] === item.category }));
  return { correct: items.every(item => item.correct), items };
}

// ── Build tasks (checked by simulation) ────────────────────────────────────────
/** The engine input for a build task: the user's design under the task's benchmark, with its forced settings applied. */
export function buildInput(task: BuildTask, architecture: ArchitectureSnapshot): SimulationInput {
  const input = labInput(architecture, { ...task.benchmark, faults: [] });
  return { ...input, nodes: input.nodes.map(node => {
    const forced = task.overrides.filter(override => override.kinds.includes(node.kind)).reduce<Record<string, string>>((acc, override) => ({ ...acc, ...override.config }), {});
    return Object.keys(forced).length ? { ...node, config: { ...node.config, ...forced } } : node;
  }) };
}
export type CheckResult = { label: string; met: boolean; measured: string };
export type BuildResult = { passed: boolean; complete: boolean; checks: CheckResult[] };
const fmt = (value: number | null, unit: string) => value === null ? 'not measured' : `${(Math.round(value * 10) / 10).toLocaleString()}${unit}`;

/** Evaluates each check against the design and the measured run. An incomplete run passes nothing. */
export function evaluateBuild(task: BuildTask, architecture: ArchitectureSnapshot, measurements: LabMeasurements): BuildResult {
  const complete = measurements.complete;
  const check = (entry: BuildCheck & { label: string }): CheckResult => {
    switch (entry.metric) {
      case 'hasKind': { const met = architecture.nodes.some(node => node.kind === entry.kind); return { label: entry.label, met, measured: met ? 'present' : 'missing' }; }
      case 'p95': return { label: entry.label, met: complete && measurements.p95 !== null && measurements.p95 <= entry.max, measured: fmt(measurements.p95, ' ms') };
      case 'successPct': return { label: entry.label, met: complete && measurements.successPct >= entry.min, measured: fmt(measurements.successPct, '%') };
      case 'computeSlots': return { label: entry.label, met: measurements.computeSlots <= entry.max, measured: `${measurements.computeSlots} slots` };
      case 'jobsCompletedPct': {
        const value = measurements.jobs.total ? measurements.jobs.completed / measurements.jobs.total * 100 : null;
        return { label: entry.label, met: complete && value !== null && value >= entry.min, measured: value === null ? 'no background jobs' : fmt(value, '%') };
      }
    }
  };
  const checks = task.checks.map(check);
  return { passed: complete && checks.every(entry => entry.met), complete, checks };
}

/** The starting or solution design of a build task as an architecture snapshot. */
export function taskArchitecture(nodes: BuildTask['starter'], edges: Array<[string, string]>, defaults: (kind: BuildTask['starter'][number]['kind']) => Record<string, string>): ArchitectureSnapshot {
  return {
    schema: 'flowzen.architecture', version: 1,
    nodes: nodes.map(node => ({ id: node.id, kind: node.kind, label: node.label, config: { ...defaults(node.kind), ...node.config }, position: { x: node.x, y: node.y } })),
    edges: edges.map(([source, target]) => ({ source, target })),
  };
}
