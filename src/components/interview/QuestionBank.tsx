import { Bookmark, BookmarkCheck, ExternalLink, ShieldCheck, Users } from 'lucide-react';
import { followUpPool } from '../../interview/adaptive';
import { evidenceOf } from '../../interview/bank/catalog';
import { companyName, sourceById } from '../../interview/bank/evidence';
import { EVIDENCE_LABELS, GROUP_LABELS, PROMINENCE_LABELS, type BankQuestion } from '../../interview/bank/types';
import type { InterviewDefinition } from '../../interview/types';
import { ReferenceDesignView } from './ReportView';

const EVIDENCE_CLASS = { practice: 'is-practice', reported: 'is-reported', sourced: 'is-sourced' } as const;

/** Company badges (only for reported questions), the evidence status and a bookmark toggle, for a catalog card. */
export function BankCardNote({ question, bookmarked, onBookmark }: { question: BankQuestion; bookmarked: boolean; onBookmark: () => void }) {
  const evidence = evidenceOf(question);
  const companies = [...new Set(question.reports.map(report => report.company))];
  return <div className="fz-bank-note">
    <div className="fz-bank-badges">
      <span className={`fz-bank-evidence ${EVIDENCE_CLASS[evidence]}`} title={evidence === 'practice' ? 'No company association is claimed.' : 'See the question page for the source.'}>{evidence === 'practice' ? <Users size={11} aria-hidden /> : <ShieldCheck size={11} aria-hidden />}{EVIDENCE_LABELS[evidence]}</span>
      {companies.map(company => <span key={company} className="fz-bank-company" title={`Publicly reported by a third-party source; see the question page.`}>{companyName(company)}</span>)}
    </div>
    <div className="fz-bank-tags"><span>{GROUP_LABELS[question.group]}</span>{question.modelledOn && <span title="The public product this problem is based on; not an interview claim.">Modelled on {question.modelledOn}</span>}</div>
    <button className={`fz-bank-bookmark${bookmarked ? ' is-on' : ''}`} aria-pressed={bookmarked} aria-label={`${bookmarked ? 'Remove bookmark from' : 'Bookmark'} ${question.title}`} onClick={onBookmark}>
      {bookmarked ? <BookmarkCheck size={13} aria-hidden /> : <Bookmark size={13} aria-hidden />}{bookmarked ? 'Bookmarked' : 'Bookmark'}</button>
  </div>;
}

/** Interview evidence for one question: every report with its quoted wording, confidence and checked source. */
export function EvidencePanel({ question }: { question: BankQuestion }) {
  return <section className="fz-bank-evidence-panel" aria-labelledby="bank-evidence">
    <h2 id="bank-evidence" className="fz-iv-h2">Interview evidence</h2>
    {!question.reports.length ? <p className="fz-prose__p"><b>{EVIDENCE_LABELS.practice}.</b> No public report tying this question to a specific company could be verified, so none is claimed. It is included because it is a widely used practice problem.</p> : <>
      <p className="fz-brief__note">These come from third-party preparation guides that say they compile candidate and interviewer reports. No company publishes its interview questions, so none of these is confirmed by the company, and none says how often the question is asked.</p>
      <ul className="fz-bank-reports">{question.reports.map(report => { const source = sourceById(report.sourceId); return <li key={`${report.company}${report.sourceId}${report.asked}`}>
        <div className="fz-bank-reports__head"><b>{companyName(report.company)}</b><span className={`fz-tag ${report.confidence === 'medium' ? 'is-accent' : 'is-warn'}`}>{report.confidence} confidence</span></div>
        <blockquote>“{report.asked}”</blockquote>
        {report.note && <p className="fz-brief__note">{report.note}</p>}
        {source && <p className="fz-bank-source"><a href={source.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={11} aria-hidden />{source.title} — {source.publisher}</a>
          <small>Source’s method: “{source.sourcing}” Checked on {source.checkedOn}. {source.dateNote}</small></p>}
      </li>; })}</ul></>}
    {question.modelledOn && <p className="fz-brief__note">Modelled on {question.modelledOn}: the public product the problem is based on. This is not a claim about that company’s interviews.</p>}
    <p className="fz-brief__note">Prominence: {PROMINENCE_LABELS[question.prominence]} — an editorial judgement of how central the problem is in public preparation material, not a measured frequency.</p>
  </section>;
}

/**
 * The structured problem brief and reference solution, built from the interview definition: requirements, scale
 * assumptions, APIs, data model, high-level design, deep dives, trade-offs and follow-up questions. Closed by default
 * because it contains the answers.
 */
export function StudyGuide({ definition, studied, onStudied }: { definition: InterviewDefinition; studied: boolean; onStudied: () => void }) {
  const specific = definition.followUps; const shared = followUpPool(definition).filter(entry => !specific.includes(entry));
  const list = (items: string[]) => <ul className="fz-prose__list">{items.map(item => <li key={item}>{item}</li>)}</ul>;
  return <details className="fz-bank-guide">
    <summary><b>Study guide and reference solution</b><span>Contains the answers. For realistic practice, start an interview first.</span></summary>
    <div className="fz-bank-guide__body">
      <section><h3>Requirements</h3>
        <div className="fz-guide__grid">
          <div><h4>Functional</h4>{list(definition.requirements.filter(entry => entry.kind === 'functional').map(entry => `${entry.label}${entry.critical ? ' (core)' : ''}`))}</div>
          <div><h4>Non-functional</h4>{list(definition.requirements.filter(entry => entry.kind === 'non-functional').map(entry => `${entry.label}${entry.critical ? ' (core)' : ''}`))}</div>
        </div>
        <h4>Clarifying questions and answers</h4>{list(definition.clarifications.map(entry => `${entry.question} — ${entry.answer}`))}</section>
      <section><h3>Scale assumptions</h3>
        <table className="fz-table fz-iv-table"><thead><tr><th scope="col">Quantity</th><th scope="col">Reference</th><th scope="col">Working</th></tr></thead>
          <tbody>{definition.estimates.map(quantity => <tr key={quantity.id}><th scope="row">{quantity.label}<small>{quantity.role}</small></th><td>{Math.round(quantity.reference * 10) / 10 >= 100 ? Math.round(quantity.reference).toLocaleString() : Math.round(quantity.reference * 10) / 10} {quantity.unit}</td><td className="is-text">{quantity.working.join(' ')}</td></tr>)}</tbody></table></section>
      <section><h3>Deep dives</h3><ol className="fz-bank-deep">{definition.deepDives.map(prompt => <li key={prompt.id}><b>{prompt.title}.</b> {prompt.question}{list(prompt.reference)}</li>)}</ol></section>
      <section><h3>Follow-up questions</h3>
        {specific.length > 0 && <>{list(specific.map(entry => `${entry.title}: ${entry.question}`))}</>}
        <p className="fz-brief__note">In an interview, follow-ups are chosen adaptively from your own design and answers, from {specific.length + shared.length} possible questions, for example: {shared.slice(0, 5).map(entry => entry.title).join(', ')}.</p></section>
      <ReferenceDesignView definition={definition} />
      <button className={`fz-btn fz-btn--small${studied ? '' : ' fz-btn--primary'}`} aria-pressed={studied} onClick={onStudied}>{studied ? 'Studied ✓ (undo)' : 'Mark as studied'}</button>
    </div>
  </details>;
}
