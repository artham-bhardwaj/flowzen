import type { Difficulty } from '../types';

/**
 * The question bank: a catalog entry per system design problem, each opening a real interview definition.
 *
 * Interview evidence is kept strictly apart from editorial data:
 *  - `reports` are company associations backed by a public source that was fetched and checked, quoting the source's
 *    own wording. A question without reports is a "common practice question": nothing is claimed about any company.
 *  - `modelledOn` names a public product the problem is based on (e.g. "Uber" for ride booking). It describes the
 *    product, never an interview.
 *  - `prominence` is an editorial judgement of how central the problem is in public preparation material. It is not
 *    a measure of how often any company asks it; no such frequency data is used.
 */
export type BankGroup = 'fundamentals' | 'social' | 'storage' | 'media' | 'commerce' | 'infrastructure' | 'distributed' | 'realtime' | 'advanced';
export const GROUP_LABELS: Record<BankGroup, string> = {
  fundamentals: 'Fundamentals', social: 'Social', storage: 'Storage', media: 'Media', commerce: 'Commerce',
  infrastructure: 'Infrastructure', distributed: 'Distributed systems', realtime: 'Real-time', advanced: 'Advanced',
};
export const GROUPS = Object.keys(GROUP_LABELS) as BankGroup[];

export type CompanyId = 'google' | 'amazon' | 'meta' | 'microsoft' | 'apple' | 'netflix' | 'uber' | 'stripe' | 'linkedin' | 'twitter' | 'airbnb';
export type Company = { id: CompanyId; name: string };

/** A public page that was fetched and read to support one or more reports. */
export type Source = {
  id: string; url: string; title: string; publisher: string;
  /** What kind of evidence it is. */
  kind: 'third-party-compilation';
  /** The source's own statement of how it gathered questions, quoted. */
  sourcing: string;
  /** When the page was fetched and the quoted wording confirmed. */
  checkedOn: string;
  /** Publication or update date as shown by the page, or why none is available. */
  dateNote: string;
};
/**
 * low:    the source lists the question for the company but does not tie it to an individual account (for example a
 *         general "question database" list or a page that calls itself a calibration list);
 * medium: the source attributes it to candidate or interviewer reports for that company.
 * Nothing is rated high: no company publishes its interview questions, so no source is first-party.
 */
export type Confidence = 'low' | 'medium';
export type CompanyReport = {
  company: CompanyId; sourceId: string;
  /** The question as the source words it, quoted exactly. */
  asked: string;
  confidence: Confidence;
  /** Anything a reader needs to interpret the match (e.g. "reported as a low-level design question"). */
  note?: string;
};
/** practice: no company evidence. reported: a report without a checked source URL. sourced: a report whose source was fetched and checked. */
export type Evidence = 'practice' | 'reported' | 'sourced';
export const EVIDENCE_LABELS: Record<Evidence, string> = { practice: 'Common practice question', reported: 'Publicly reported (unverified source)', sourced: 'Publicly reported, source checked' };

export type BankQuestion = {
  id: string;
  /** The interview definition the question opens (curated or generated from a brief). */
  definitionId: string;
  title: string; aliases: string[]; summary: string;
  group: BankGroup; difficulty: Difficulty;
  /** 1 = core, 2 = common, 3 = specialised (editorial; see the type comment). */
  prominence: 1 | 2 | 3;
  modelledOn?: string;
  reports: CompanyReport[];
};
export const PROMINENCE_LABELS: Record<BankQuestion['prominence'], string> = { 1: 'Core', 2: 'Common', 3: 'Specialised' };
