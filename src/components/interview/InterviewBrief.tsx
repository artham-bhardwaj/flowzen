import { useState } from 'react';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { byKind } from '../../app/catalog';
import type { FlowNode } from '../../app/model';
import { update, type InterviewSession } from '../../interview/session';
import { tick } from '../../interview/workflow';
import { STAGE_LABELS, type InterviewDefinition } from '../../interview/types';
import type { InterviewController } from '../../interview/useInterviews';
import { SessionClock } from './shared';

/** The interview panel beside the canvas: problem, stage, timer and a decision note for every component. */
export default function InterviewBrief({ definition, session, ctl, nodes, selectedId, onBack, onSelect }: { definition: InterviewDefinition; session: InterviewSession; ctl: InterviewController; nodes: FlowNode[]; selectedId?: string; onBack: () => void; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const edit = (change: (current: InterviewSession) => InterviewSession) => ctl.edit(session.id, change);
  const components = nodes.filter(node => node.data.kind !== 'client').sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  return <div className="fz-inspector__body fz-iv-brief">
    <div className="fz-panel__head"><button className="fz-btn fz-btn--small" onClick={onBack}><ArrowLeft size={12} />Back to the interview</button><span className="fz-tag">{session.mode}</span></div>
    <h2 className="fz-brief__title">{definition.title}</h2>
    <p className="fz-brief__meta">Stage: {STAGE_LABELS[session.stage]}</p>
    <SessionClock session={session} onCommit={(ms, stage) => edit(current => tick(current, ms, stage, Date.now()))} />
    <button className="fz-iv-statement__toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}><ChevronDown size={13} aria-hidden />Problem statement</button>
    {open && <p className="fz-brief__text">{definition.statement}</p>}
    <p className="fz-brief__note">Your canvas is saved into this interview as you edit; it has its own undo history. Run plays the interview benchmark ({definition.benchmark.rps.toLocaleString()} req/s) as practice and records nothing. The measured benchmark used for evaluation is run from the interview’s design stage.</p>
    <h3 className="fz-section-title">Why each component?</h3>
    {!components.length ? <p className="fz-empty-note">Add components from the library. Nothing is pre-built.</p> : <ul className="fz-iv-decisions is-compact">{components.map(node => <li key={node.id} className={node.id === selectedId ? 'is-selected' : ''}>
      <label><span><button className="fz-link" onClick={() => onSelect(node.id)}>{node.data.label || byKind[node.data.kind].label}</button><em>{byKind[node.data.kind].label}</em></span>
        <textarea rows={2} value={session.decisions[node.id] ?? ''} placeholder="Why is this here?" onChange={event => edit(current => update(current, { decisions: { ...current.decisions, [node.id]: event.target.value } }, Date.now()))} /></label></li>)}</ul>}
    <p className="fz-brief__note">Select a component and open the Inspector tab to see its purpose, alternatives and trade-offs, and its low-level design in the LLD view.</p>
  </div>;
}
