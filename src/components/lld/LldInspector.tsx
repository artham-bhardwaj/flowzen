import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpLeft, Code2, FileCode2, Info, Network } from 'lucide-react';
import { byKind } from '../../app/catalog';
import type { FlowNode } from '../../app/model';
import type { Neighbor } from '../../app/neighbors';
import { PRINCIPLES, PRINCIPLE_DEFINITIONS } from '../../lld/principles';
import type { LldClass, LldModel, PrincipleId, RelationType } from '../../lld/types';
import { ClassDiagram, DiagramLegend } from './ClassDiagram';
import { CodeView } from './CodeView';

export type LldTab = 'overview' | 'classes' | 'code' | 'principles' | 'design';
const TABS: Array<[LldTab, string]> = [['overview', 'Overview'], ['classes', 'Classes'], ['code', 'Code'], ['principles', 'Principles'], ['design', 'Design']];
const RELATION_OUT: Record<RelationType, string> = { implements: 'implements', extends: 'extends', uses: 'uses', composes: 'owns', creates: 'creates' };
const RELATION_IN: Record<RelationType, string> = { implements: 'implemented by', extends: 'extended by', uses: 'used by', composes: 'owned by', creates: 'created by' };
const KIND_LABEL: Record<LldClass['kind'], string> = { interface: 'interface', abstract: 'abstract class', class: 'class', enum: 'enum', record: 'record' };

type Props = { node: FlowNode; model: LldModel; neighbors: { upstream: Neighbor[]; downstream: Neighbor[] }; onSelectNode: (id: string) => void;
  /** Shown outside the canvas (e.g. in a component guide): describes the role in general, with default settings. */
  standalone?: boolean };

/** The low-level design of the selected component: overview, class diagram, code, principles and design choices. */
export function LldInspector({ node, model, neighbors, onSelectNode, standalone = false }: Props) {
  const [tab, setTab] = useState<LldTab>('overview');
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [fileName, setFileName] = useState(model.files[0].name);
  const [showSupport, setShowSupport] = useState(false);
  const [openPrinciple, setOpenPrinciple] = useState<PrincipleId | null>(null);
  const classByName = useMemo(() => new Map(model.classes.map(entry => [entry.name, entry])), [model]);
  const typeNames = useMemo(() => new Set(classByName.keys()), [classByName]);

  const selectClass = (id: string) => {
    setSelectedClass(id); const entry = model.classes.find(item => item.id === id);
    if (entry?.support) setShowSupport(true);
  };
  const openCode = (id: string) => { const entry = model.classes.find(item => item.id === id); if (!entry) return; setSelectedClass(id); setFileName(entry.file); setTab('code'); };
  const showClass = (id: string) => { selectClass(id); setTab('classes'); };
  const showPrinciple = (id: PrincipleId) => { setOpenPrinciple(id); setTab('principles'); };

  return <div className="fz-lld">
    <div className="fz-lld__head">
      <span className="fz-eyebrow">Low-level design</span>
      <h2>{model.title}</h2>
      <p className="fz-lld__disclaimer"><Info size={13} aria-hidden /><span>Illustrative Java: one possible implementation of this component’s responsibility, not production code. It is never executed, and Flowzen’s simulator does not read it.</span></p>
    </div>
    <div className="fz-tabs fz-lld__tabs" role="tablist" aria-label="Low-level design sections">
      {TABS.map(([id, label]) => <button key={id} role="tab" id={`lld-tab-${id}`} aria-selected={tab === id} aria-controls="lld-panel" className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div className="fz-lld__body" role="tabpanel" id="lld-panel" aria-labelledby={`lld-tab-${tab}`}>
      {tab === 'overview' && <Overview node={node} model={model} neighbors={neighbors} onSelectNode={onSelectNode} onClass={showClass} standalone={standalone} />}
      {tab === 'classes' && <Classes model={model} selected={selectedClass} onSelect={selectClass} showSupport={showSupport} onToggleSupport={() => setShowSupport(on => !on)} onCode={openCode} onPrinciple={showPrinciple} />}
      {tab === 'code' && <>
        <div className="fz-lld__files" role="listbox" aria-label="Files">
          {model.files.map(file => <button key={file.name} role="option" aria-selected={file.name === fileName} className={file.name === fileName ? 'is-on' : ''} onClick={() => { setFileName(file.name); const owner = model.classes.find(entry => entry.file === file.name); if (owner) setSelectedClass(owner.id); }}><FileCode2 size={12} aria-hidden />{file.name}</button>)}
        </div>
        {(() => { const owner = model.classes.find(entry => entry.file === fileName); return owner && <p className="fz-lld__owner"><b>{owner.name}</b> · {owner.responsibility} <button className="fz-link" onClick={() => showClass(owner.id)}>Show in diagram</button></p>; })()}
        <CodeView code={model.files.find(file => file.name === fileName)?.code ?? ''} label={fileName} links={typeNames} onLink={name => { const entry = classByName.get(name); if (entry) openCode(entry.id); }} />
        <p className="fz-empty-note">Click a highlighted type name to follow the dependency to its file.</p>
      </>}
      {tab === 'principles' && <Principles model={model} open={openPrinciple} onToggle={id => setOpenPrinciple(current => current === id ? null : id)} onClass={showClass} />}
      {tab === 'design' && <Design node={node} model={model} />}
    </div>
  </div>;
}

function ClassChip({ model, id, onClick }: { model: LldModel; id: string; onClick: (id: string) => void }) {
  const entry = model.classes.find(item => item.id === id); if (!entry) return null;
  return <button className={`fz-chip kind-${entry.kind}`} onClick={() => onClick(id)} title={entry.responsibility}>{entry.name}</button>;
}

function NeighborList({ items, onSelectNode, empty }: { items: Neighbor[]; onSelectNode: (id: string) => void; empty: string }) {
  if (!items.length) return <p className="fz-empty-note">{empty}</p>;
  return <ul className="fz-neighbors">{items.map(item => <li key={item.id} className={item.edgeStatus === 'used' ? '' : 'is-muted'}>
    <button className="fz-link" onClick={() => onSelectNode(item.id)}>{item.label}</button><span>{item.kindLabel}</span>
    {item.edgeStatus === 'unused' && <em title={item.reason}>not used by the simulator{item.reason ? `: ${item.reason}` : ''}</em>}
    {(item.edgeStatus === 'telemetry' || item.edgeStatus === 'dead-letter') && <em>{item.edgeStatus}</em>}
  </li>)}</ul>;
}

function Overview({ node, model, neighbors, onSelectNode, onClass, standalone }: { node: FlowNode; model: LldModel; neighbors: Props['neighbors']; onSelectNode: (id: string) => void; onClass: (id: string) => void ; standalone: boolean }) {
  const { overview } = model; const fields = new Map(byKind[node.data.kind].fields.map(field => [field.key, field]));
  const list = (items: string[]) => <ul className="fz-lld__list">{items.map(item => <li key={item}>{item}</li>)}</ul>;
  return <>
    <p className="fz-desc">{overview.responsibility}</p>
    <dl className="fz-lld__facts">
      <dt>Inputs</dt><dd>{list(overview.inputs)}</dd>
      <dt>Outputs</dt><dd>{list(overview.outputs)}</dd>
      <dt>Collaborators</dt><dd>{list(overview.collaborators)}</dd>
      <dt>State</dt><dd>{list(overview.state)}</dd>
      {overview.behavior.length > 0 && <><dt>Behavior</dt><dd>{list(overview.behavior)}</dd></>}
    </dl>

    <h3 className="fz-section-title"><span><Network size={13} aria-hidden /> {standalone ? 'In an architecture' : 'On your canvas'}</span><small>{node.data.label}</small></h3>
    <div className="fz-lld__role">
      <h4><ArrowUpLeft size={13} aria-hidden />Upstream</h4><p>{model.canvasRole.upstream}</p>
      {!standalone && <NeighborList items={neighbors.upstream} onSelectNode={onSelectNode} empty="Nothing sends to this component yet." />}
      <h4><ArrowDownRight size={13} aria-hidden />Downstream</h4><p>{model.canvasRole.downstream}</p>
      {!standalone && <NeighborList items={neighbors.downstream} onSelectNode={onSelectNode} empty="No downstream connection." />}
    </div>

    {model.bindings.length > 0 && <>
      <h3 className="fz-section-title">Configuration → code <small>{standalone ? 'default values' : 'current values'}</small></h3>
      <table className="fz-bindings">
        <thead><tr><th scope="col">Setting</th><th scope="col">Value</th><th scope="col">In the code</th></tr></thead>
        <tbody>{model.bindings.map(binding => {
          const field = fields.get(binding.key);
          return <tr key={binding.key}>
            <th scope="row">{field?.label ?? binding.key}{field && !field.simulated && <em> descriptive</em>}</th>
            <td>{node.data.config[binding.key] || '—'}{field?.unit && node.data.config[binding.key] ? ` ${field.unit}` : ''}</td>
            <td><button className="fz-link" onClick={() => onClass(binding.classId)}>{binding.target}</button><small>{binding.note}</small></td>
          </tr>;
        })}</tbody>
      </table>
    </>}

    <h3 className="fz-section-title">What Flowzen simulates</h3>
    <div className="fz-alert is-ok"><span>{model.simulation}</span></div>
  </>;
}

function Classes({ model, selected, onSelect, showSupport, onToggleSupport, onCode, onPrinciple }: {
  model: LldModel; selected: string | null; onSelect: (id: string) => void; showSupport: boolean; onToggleSupport: () => void; onCode: (id: string) => void; onPrinciple: (id: PrincipleId) => void;
}) {
  const entry = model.classes.find(item => item.id === selected) ?? null;
  const hidden = model.classes.filter(item => item.support).length;
  const out = entry ? model.relations.filter(relation => relation.from === entry.id) : [];
  const incoming = entry ? model.relations.filter(relation => relation.to === entry.id) : [];
  const principles = entry ? model.principles.filter(claim => claim.classes.includes(entry.id)) : [];
  return <>
    <div className="fz-lld__diagram-head">
      <span>{model.classes.length - (showSupport ? 0 : hidden)} of {model.classes.length} types</span>
      {hidden > 0 && <label className="fz-check"><input type="checkbox" checked={showSupport} onChange={onToggleSupport} />Show value types ({hidden})</label>}
    </div>
    <div className="fz-lld__diagram"><ClassDiagram model={model} selected={selected} onSelect={onSelect} showSupport={showSupport} /></div>
    <DiagramLegend />
    {!entry ? <p className="fz-empty-note">Select a class or interface to see its responsibility and follow its dependencies.</p> : <section className="fz-classcard" aria-label={`${entry.name} details`}>
      <div className="fz-classcard__head"><span className={`fz-kind kind-${entry.kind}`}>{KIND_LABEL[entry.kind]}</span><h3>{entry.name}</h3>
        <button className="fz-btn fz-btn--small" onClick={() => onCode(entry.id)}><Code2 size={12} />View code</button></div>
      <p>{entry.responsibility}</p>
      {entry.members.length > 0 && <ul className="fz-members">{entry.members.map(member => <li key={member}><code>{member}</code></li>)}</ul>}
      {out.length > 0 && <><h4 className="fz-subtitle">Depends on</h4><ul className="fz-rels">{out.map((relation, index) => <li key={index}><span>{RELATION_OUT[relation.type]}</span><ClassChip model={model} id={relation.to} onClick={onSelect} />{relation.label && <em>{relation.label}</em>}</li>)}</ul></>}
      {incoming.length > 0 && <><h4 className="fz-subtitle">Referenced by</h4><ul className="fz-rels">{incoming.map((relation, index) => <li key={index}><span>{RELATION_IN[relation.type]}</span><ClassChip model={model} id={relation.from} onClick={onSelect} /></li>)}</ul></>}
      {principles.length > 0 && <><h4 className="fz-subtitle">Demonstrates</h4><div className="fz-chips">{principles.map(claim => <button key={claim.principle} className="fz-chip is-principle" onClick={() => onPrinciple(claim.principle)}>{PRINCIPLES[claim.principle].name}</button>)}</div></>}
    </section>}
  </>;
}

function Principles({ model, open, onToggle, onClass }: { model: LldModel; open: PrincipleId | null; onToggle: (id: PrincipleId) => void; onClass: (id: string) => void }) {
  const refactoring = model.refactoring;
  return <>
    <p className="fz-empty-note">Only the principles this code actually demonstrates are listed. Expand one to see where and why.</p>
    <ul className="fz-principles">{model.principles.map(claim => {
      const info = PRINCIPLES[claim.principle]; const expanded = open === claim.principle;
      return <li key={claim.principle} className={expanded ? 'is-open' : ''}>
        <button className="fz-principle__head" aria-expanded={expanded} onClick={() => onToggle(claim.principle)}>
          <span className={`fz-pbadge group-${info.group.toLowerCase()}`}>{info.short}</span><b>{info.name}</b><span className="fz-principle__chev" aria-hidden>{expanded ? '−' : '+'}</span>
        </button>
        <p className="fz-principle__meaning">{claim.meaning}</p>
        {expanded && <div className="fz-principle__body">
          <p className="fz-principle__def"><i>{PRINCIPLE_DEFINITIONS[claim.principle]}</i></p>
          <h4>Where in the code</h4><div className="fz-chips">{claim.classes.map(id => <ClassChip key={id} model={model} id={id} onClick={onClass} />)}</div><p>{claim.evidence}</p>
          <h4>Why it helps</h4><p>{claim.benefit}</p>
          <h4>What a violation looks like</h4><p>{claim.violation}</p>
          <h4>Trade-off</h4><p>{claim.tradeoff}</p>
          {refactoring?.principle === claim.principle && <p className="fz-empty-note">See the before/after refactoring below.</p>}
        </div>}
      </li>;
    })}</ul>
    {refactoring && <section className="fz-refactor" aria-label="Refactoring example">
      <h3 className="fz-section-title">Refactoring example <small>{PRINCIPLES[refactoring.principle].name}</small></h3>
      <p className="fz-refactor__title"><b>{refactoring.title}</b></p>
      <p>{refactoring.problem}</p>
      <CodeView code={refactoring.before} label="Before: violation" tone="bad" />
      <CodeView code={refactoring.after} label="After: refactored" tone="ok" />
      <p>{refactoring.explanation}</p>
    </section>}
  </>;
}

function Design({ node, model }: { node: FlowNode; model: LldModel }) {
  const matched = (choice: LldModel['choices'][number]) => choice.configKey ? choice.matchConfig?.[(node.data.config[choice.configKey] ?? '').trim().toLowerCase()] : undefined;
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(model.choices.map(choice => [choice.id, matched(choice) ?? choice.defaultOption])));
  return <>
    <h3 className="fz-section-title">Design decisions</h3>
    <ul className="fz-decisions">{model.decisions.map(decision => <li key={decision.title}>
      <b>{decision.title}</b><p>{decision.decision} {decision.why}</p>
      <ul>{decision.alternatives.map(alternative => <li key={alternative.name}><span>Alternative: {alternative.name}</span> — preferable when {alternative.when.charAt(0).toLowerCase()}{alternative.when.slice(1)}</li>)}</ul>
    </li>)}</ul>
    {model.choices.map(choice => {
      const option = choice.options.find(entry => entry.id === picked[choice.id]) ?? choice.options[0]; const fromConfig = matched(choice);
      const field = choice.configKey ? byKind[node.data.kind].fields.find(entry => entry.key === choice.configKey) : undefined;
      return <section key={choice.id} className="fz-choice" aria-label={choice.title}>
        <h3 className="fz-section-title">What if… <small>{choice.title}</small></h3>
        <p>{choice.question}</p>
        <div className="fz-segmented fz-choice__options" role="radiogroup" aria-label={choice.title}>
          {choice.options.map(entry => <button key={entry.id} role="radio" aria-checked={entry.id === option.id} className={entry.id === option.id ? 'is-on' : ''} onClick={() => setPicked(current => ({ ...current, [choice.id]: entry.id }))}>{entry.label}</button>)}
        </div>
        <div className="fz-choice__tags">
          {option.id === choice.defaultOption && <span className="fz-tag">Shown in the Code tab</span>}
          {fromConfig === option.id && field && <span className="fz-tag is-accent">Matches this component’s “{field.label}” setting</span>}
        </div>
        <p><b>{option.summary}</b> {option.effect}</p>
        <p className="fz-choice__changes">Changes: {option.changes.join(', ')}</p>
        <CodeView code={option.code} label={`${option.label}`} />
      </section>;
    })}
    <p className="fz-empty-note">Design choices show how the implementation would change. They do not change the simulation.</p>
  </>;
}
