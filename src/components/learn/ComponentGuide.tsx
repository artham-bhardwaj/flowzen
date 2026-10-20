import { lazy, Suspense, useMemo, useState } from 'react';
import { ArrowRight, Code2, EyeOff, FlaskConical } from 'lucide-react';
import { byKind, categories, catalog, categoryOrder, type Kind } from '../../app/catalog';
import type { FlowNode } from '../../app/model';
import { componentKnowledge } from '../../learn/components';
import { EXPERIMENTS } from '../../learn/experiments';
import { ShapeGlyph } from '../shapes';

const LldPanel = lazy(() => import('../lld/LldPanel'));
const NO_NEIGHBORS = { upstream: [], downstream: [] };

type Props = { kind: Kind; onKind: (kind: Kind) => void; onLesson: (id: string) => void; onExperiment: (id: string) => void; initialTab?: 'guide' | 'lld' };

/** The full decision guide for one component, from the shared knowledge model, with its low-level design when one exists. */
export function ComponentGuideView({ kind, onKind, onLesson, onExperiment, initialTab = 'guide' }: Props) {
  const knowledge = componentKnowledge(kind); const { item, guide } = knowledge;
  const [tab, setTab] = useState<'guide' | 'lld'>(knowledge.lld ? initialTab : 'guide');
  // The LLD explorer works on a canvas node; a default-configured stand-in is used here.
  const node = useMemo<FlowNode>(() => ({ id: `guide-${kind}`, type: 'architecture', position: { x: 0, y: 0 }, data: { label: item.label, kind, config: { ...item.defaults } } }), [item, kind]);
  const experiments = EXPERIMENTS.filter(template => template.components.includes(kind));
  const list = (items: string[]) => <ul className="fz-prose__list">{items.map(entry => <li key={entry}>{entry}</li>)}</ul>;
  return <article className="fz-guide" aria-labelledby="fz-guide-title">
    <header className={`fz-guide__head fz-detail-hero cat-${item.category}`}>
      <ShapeGlyph kind={kind} size={48} />
      <div><span className="fz-eyebrow">Component guide · {categories[item.category].label}</span><h1 id="fz-guide-title">{item.label}</h1>
        <p>{item.description}</p>{!item.simulated && <span className="fz-tag"><EyeOff size={11} aria-hidden />Not simulated</span>}</div>
    </header>
    {knowledge.lld && <div className="fz-tabs fz-guide__tabs" role="tablist" aria-label="Guide sections">
      <button role="tab" aria-selected={tab === 'guide'} className={tab === 'guide' ? 'is-on' : ''} onClick={() => setTab('guide')}>Decision guide</button>
      <button role="tab" aria-selected={tab === 'lld'} className={tab === 'lld' ? 'is-on' : ''} onClick={() => setTab('lld')}><Code2 size={12} aria-hidden />Low-level design</button>
    </div>}
    {tab === 'lld' && knowledge.lld ? <div className="fz-guide__lld">
      <p className="fz-brief__note">How the {item.label}’s architectural responsibility could be implemented. The Java is illustrative: it is never executed, and changing it would not change any simulation result.</p>
      <Suspense fallback={<p className="fz-empty-note">Loading low-level design…</p>}><LldPanel node={node} neighbors={NO_NEIGHBORS} onSelectNode={() => undefined} standalone /></Suspense>
    </div> : <>
      <section className="fz-guide__why"><h2>Why use this?</h2><p>{guide.why}</p><p className="is-muted"><b>Problem it solves:</b> {guide.problem}</p></section>
      <div className="fz-guide__grid">
        <section><h3>Use it when</h3>{list(guide.useWhen)}</section>
        <section><h3>Avoid it when</h3>{list(guide.avoidWhen)}</section>
        <section><h3>Advantages</h3>{list(guide.pros)}</section>
        <section><h3>Disadvantages</h3>{list(guide.cons)}</section>
      </div>
      {guide.alternatives.length > 0 && <section><h2>Alternatives</h2><ul className="fz-guide__alts">{guide.alternatives.map(alternative => <li key={alternative.name}>
        {alternative.kind ? <button className="fz-link" onClick={() => onKind(alternative.kind!)}>{alternative.name}</button> : <b>{alternative.name}</b>}<span>{alternative.tradeoff}</span>
      </li>)}</ul></section>}
      <section><h2>Contract</h2><dl className="fz-contract"><dt>Inputs</dt><dd>{item.inputs}</dd><dt>Outputs</dt><dd>{item.outputs}</dd><dt>Dependencies</dt><dd>{guide.dependencies.join('; ')}</dd></dl></section>
      <section><h2>Configuration</h2>
        <table className="fz-table fz-guide__config"><thead><tr><th scope="col">Setting</th><th scope="col">Default</th><th scope="col">Simulated</th></tr></thead>
          <tbody>{item.fields.map(field => <tr key={field.key}><th scope="row">{field.label}{field.hint && <small>{field.hint}</small>}</th><td>{item.defaults[field.key] || '—'}{field.unit && field.simulated ? ` ${field.unit}` : ''}</td><td>{field.simulated ? 'Yes' : 'No, descriptive'}</td></tr>)}</tbody></table>
      </section>
      <div className="fz-guide__grid">
        <section><h3>Common failure modes</h3>{list(guide.failureModes)}</section>
        <section><h3>Operational considerations</h3>{list(guide.operations)}</section>
        <section><h3>Metrics to watch</h3>{list(guide.metrics)}</section>
        <section><h3>In Flowzen’s simulator</h3><p className="fz-prose__p">{item.behavior}</p>{list(guide.simulator.models)}<p className="fz-brief__note"><b>Not modelled:</b> {guide.simulator.limitations.join(' ')}</p></section>
      </div>
      <section><h2>Learn more</h2>
        <ul className="fz-guide__lessons">{knowledge.lessons.map(lesson => <li key={lesson.id}>{lesson.written ? <button className="fz-link" onClick={() => onLesson(lesson.id)}>{lesson.title} <ArrowRight size={12} aria-hidden /></button> : <span className="is-muted">{lesson.title} <em className="fz-tag">planned</em></span>}</li>)}</ul>
        {experiments.length > 0 && <><h3>Experiments with this component</h3><div className="fz-chips">{experiments.map(template => <button key={template.id} className="fz-chip" onClick={() => onExperiment(template.id)}><FlaskConical size={11} aria-hidden />{template.title}</button>)}</div></>}
        {knowledge.lld ? <button className="fz-btn fz-btn--small" onClick={() => setTab('lld')}><Code2 size={12} />Low-level design · {knowledge.lld.types} Java types</button> : <p className="fz-empty-note">No low-level design for {item.label} yet.</p>}
      </section>
    </>}
  </article>;
}

/** All components by category, each with its one-line "why". */
export function ComponentIndex({ onKind }: { onKind: (kind: Kind) => void }) {
  return <article className="fz-guide" aria-labelledby="fz-components-title">
    <header className="fz-guide__head fz-detail-hero"><div><span className="fz-eyebrow">Reference</span><h1 id="fz-components-title">Component guides</h1><p>What each component is for, when to use it and when not to, its alternatives, failure modes, and exactly what the simulator models.</p></div></header>
    {categoryOrder.map(category => <section key={category}><h2 className={`fz-library__cat cat-${category}`}><i aria-hidden />{categories[category].label}</h2>
      <ul className="fz-guide__index">{catalog.filter(entry => entry.category === category).map(entry => { return <li key={entry.kind}>
        <button className={`fz-guide__card cat-${entry.category}`} onClick={() => onKind(entry.kind)}><ShapeGlyph kind={entry.kind} size={30} /><b>{entry.label}</b><span>{componentKnowledge(entry.kind).guide.why}</span></button>
      </li>; })}</ul></section>)}
  </article>;
}
export const kindLabel = (kind: Kind) => byKind[kind].label;
