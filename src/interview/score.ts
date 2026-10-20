import { checkConcepts, findContradictions, wordCount } from './text';
import type { Concept, Contradiction } from './types';

/**
 * Free-text scoring shared by the evaluator and the follow-up engine. Each concept is a required consideration;
 * the score follows the share recognised, capped by contradictions and very short answers. It recognises
 * vocabulary, not understanding, which is why results can be flagged uncertain and corrected.
 */
export type Basis = 'structural' | 'measured' | 'arithmetic' | 'keyword';
export type Evidence = { basis: Basis; text: string; positive: boolean };
export const MIN_WORDS = 8;
export type TextScore = { score: number; evidence: Evidence[]; missed: string[]; missedIds: string[]; uncertain: boolean; uncertainReason?: string };
export function scoreText(text: string, concepts: Concept[], contradictions: Contradiction[] = []): TextScore {
  const words = wordCount(text);
  if (!words) return { score: 0, evidence: [{ basis: 'keyword', text: 'No answer was recorded.', positive: false }], missed: concepts.map(concept => concept.label), missedIds: concepts.map(concept => concept.id), uncertain: false };
  const checks = checkConcepts(text, concepts); const found = checks.filter(check => check.found);
  const contradicted = findContradictions(text, contradictions);
  const ratio = concepts.length ? found.length / concepts.length : 1;
  let score = found.length === 0 ? 1 : ratio < 0.34 ? 1 : ratio < 0.67 ? 2 : ratio < 1 ? 3 : 4;
  const evidence: Evidence[] = found.map(check => ({ basis: 'keyword', text: `Mentions ${check.concept.label} (“${check.phrase}”).`, positive: true }));
  if (words < MIN_WORDS) { score = Math.min(score, 1); evidence.push({ basis: 'keyword', text: `The answer is very short (${words} words), too brief to show reasoning.`, positive: false }); }
  for (const entry of contradicted) { score = Math.min(score, 1); evidence.push({ basis: 'keyword', text: `Contradiction: ${entry.label}. ${entry.explanation}`, positive: false }); }
  // Keyword rules recognise vocabulary only; a long answer with few recognised concepts may be phrased differently.
  const uncertain = score <= 2 && words >= 40 && !contradicted.length;
  const missing = checks.filter(check => !check.found);
  return { score, evidence, missed: missing.map(check => check.concept.label), missedIds: missing.map(check => check.concept.id), uncertain, ...(uncertain ? { uncertainReason: `A ${words}-word answer matched few of the expected concepts. The keyword rules may have missed different phrasing; review it and correct the score if it is wrong.` } : {}) };
}
export const scaleFromRatio = (ratio: number) => ratio <= 0 ? 0 : ratio < 0.34 ? 1 : ratio < 0.67 ? 2 : ratio < 0.95 ? 3 : 4;
