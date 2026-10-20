import type { Concept, Contradiction } from './types';

/**
 * Transparent text checks. A phrase matches at the start of a word, case-insensitively, so "cache" matches "caches"
 * and "caching" but not "cachet"-style accidents inside other words. These rules recognise vocabulary; they do not
 * understand reasoning, and every result that depends on them is labelled as keyword-based.
 */
const cache = new Map<string, RegExp>();
function pattern(phrase: string): RegExp {
  let compiled = cache.get(phrase);
  if (!compiled) {
    compiled = phrase.length > 2 && phrase.startsWith('/') && phrase.endsWith('/')
      ? new RegExp(phrase.slice(1, -1), 'i')
      : new RegExp(`(^|[^a-z0-9])${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+')}`, 'i');
    cache.set(phrase, compiled);
  }
  return compiled;
}
export const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
export const mentions = (text: string, any: string[]) => any.some(phrase => pattern(phrase).test(text));
export const matchedPhrase = (text: string, any: string[]) => any.find(phrase => pattern(phrase).test(text)) ?? null;
export const wordCount = (text: string) => normalize(text) ? normalize(text).split(' ').length : 0;
export const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

export type ConceptCheck = { concept: Concept; found: boolean; phrase: string | null };
export const checkConcepts = (text: string, concepts: Concept[]): ConceptCheck[] => concepts.map(concept => { const phrase = matchedPhrase(text, concept.any); return { concept, found: phrase !== null, phrase }; });
export const findContradictions = (text: string, contradictions: Contradiction[] = []) => contradictions.filter(entry => mentions(text, entry.any));
