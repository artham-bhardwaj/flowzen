import type { Difficulty } from '../types';
import { evidenceOf } from './catalog';
import { companyName } from './evidence';
import type { BankGroup, BankQuestion, CompanyId, Evidence } from './types';

/** Searching, filtering, sorting and facet counts for the question bank. Pure functions; the UI holds the state. */
export type BankStatus = 'new' | 'in-progress' | 'completed';
export const STATUS_LABELS: Record<BankStatus, string> = { new: 'Not started', 'in-progress': 'In progress', completed: 'Completed' };
export type BankFilters = { query: string; companies: CompanyId[]; difficulties: Difficulty[]; groups: BankGroup[]; evidence: Evidence[]; statuses: BankStatus[]; bookmarkedOnly: boolean };
export const EMPTY_FILTERS: BankFilters = { query: '', companies: [], difficulties: [], groups: [], evidence: [], statuses: [], bookmarkedOnly: false };
export type FacetKey = 'companies' | 'difficulties' | 'groups' | 'evidence' | 'statuses';
/** Per-user state the filters depend on (progress from interview records, bookmarks from the bank store). */
export type BankContext = { status: (question: BankQuestion) => BankStatus; bookmarked: (question: BankQuestion) => boolean };

const normalize = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Searchable text: title, aliases, summary, the product it is modelled on, and the companies with reports. */
export const searchText = (question: BankQuestion) => normalize([question.title, ...question.aliases, question.summary, question.modelledOn ?? '', ...question.reports.map(report => companyName(report.company))].join(' '));
/** Every word of the query must appear (as a word prefix) somewhere in the searchable text. */
export function matchesQuery(question: BankQuestion, query: string): boolean {
  const words = normalize(query).split(' ').filter(Boolean); if (!words.length) return true;
  const haystack = ` ${searchText(question)}`;
  return words.every(word => haystack.includes(` ${word}`));
}
export function matches(question: BankQuestion, filters: BankFilters, context: BankContext, ignore?: FacetKey): boolean {
  return matchesQuery(question, filters.query)
    && (ignore === 'companies' || !filters.companies.length || question.reports.some(report => filters.companies.includes(report.company)))
    && (ignore === 'difficulties' || !filters.difficulties.length || filters.difficulties.includes(question.difficulty))
    && (ignore === 'groups' || !filters.groups.length || filters.groups.includes(question.group))
    && (ignore === 'evidence' || !filters.evidence.length || filters.evidence.includes(evidenceOf(question)))
    && (ignore === 'statuses' || !filters.statuses.length || filters.statuses.includes(context.status(question)))
    && (!filters.bookmarkedOnly || context.bookmarked(question));
}
export type BankSort = 'prominence' | 'group' | 'difficulty' | 'title';
export const SORT_LABELS: Record<BankSort, string> = { prominence: 'Popularity (editorial)', group: 'Category', difficulty: 'Difficulty', title: 'Title A–Z' };
const LEVELS: Difficulty[] = ['beginner', 'intermediate', 'advanced', 'expert'];
const GROUP_ORDER: BankGroup[] = ['fundamentals', 'social', 'storage', 'media', 'commerce', 'infrastructure', 'distributed', 'realtime', 'advanced'];
/** Stable sorts; ties keep catalog order. "Popularity" is the editorial prominence, never a measured frequency. */
export function sortBank(questions: BankQuestion[], sort: BankSort): BankQuestion[] {
  const order = new Map(questions.map((question, i) => [question.id, i]));
  const key = (question: BankQuestion): Array<number | string> => sort === 'prominence' ? [question.prominence, LEVELS.indexOf(question.difficulty)]
    : sort === 'group' ? [GROUP_ORDER.indexOf(question.group), question.prominence] : sort === 'difficulty' ? [LEVELS.indexOf(question.difficulty), question.prominence] : [question.title.toLowerCase()];
  return [...questions].sort((a, b) => { const ka = key(a); const kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1; return order.get(a.id)! - order.get(b.id)!; });
}
export const filterBank = (questions: BankQuestion[], filters: BankFilters, context: BankContext, sort: BankSort) => sortBank(questions.filter(question => matches(question, filters, context)), sort);
/** Counts for one facet's values, applying every other active filter (standard faceted-search behaviour). */
export function facetCounts<V extends string>(questions: BankQuestion[], filters: BankFilters, context: BankContext, facet: FacetKey, values: readonly V[], test: (question: BankQuestion, value: V) => boolean): Record<V, number> {
  const base = questions.filter(question => matches(question, filters, context, facet));
  return Object.fromEntries(values.map(value => [value, base.filter(question => test(question, value)).length])) as Record<V, number>;
}
export const toggle = <T,>(list: T[], value: T): T[] => list.includes(value) ? list.filter(entry => entry !== value) : [...list, value];
