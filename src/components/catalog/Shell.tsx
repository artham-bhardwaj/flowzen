import { useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, Lock, Search, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import type { Kind } from '../../app/catalog';
import { ShapeGlyph } from '../shapes';

/**
 * The shared catalog page system used by every top-level tab (Learn, Interview, Challenges): a hero band with
 * breadcrumb, heading, "Tell me more" and related topics; a filter sidebar of checkbox facets; a results bar with
 * count, clear and sort; a grid of cards; related resources; and a footer. Detail pages use `DetailHero`.
 */
export type Crumb = { label: string; onClick?: () => void };
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return <nav className="fz-crumbs" aria-label="Breadcrumb">{crumbs.map((crumb, i) => <span key={crumb.label} className="fz-crumbs__item">
    {i > 0 && <span aria-hidden>/</span>}
    {crumb.onClick && i < crumbs.length - 1 ? <button onClick={crumb.onClick}>{crumb.label}</button> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>}
  </span>)}</nav>;
}

export function CatalogHero({ id, crumbs, title, intro, more, topics, aside, children }: {
  id: string; crumbs: Crumb[]; title: string; intro: ReactNode; more?: string[];
  topics?: Array<{ label: string; onClick: () => void }>; aside?: ReactNode; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <section className="fz-hero" aria-labelledby={id}>
    <div className="fz-hero__inner">
      <div className="fz-hero__intro">
        <Breadcrumbs crumbs={crumbs} />
        <h1 id={id}>{title}</h1>
        <p>{intro}</p>
        {more && <><button className="fz-hero__more" aria-expanded={open} onClick={() => setOpen(value => !value)}>Tell me more <ChevronDown size={14} aria-hidden /></button>
          {open && <ul className="fz-hero__about">{more.map(item => <li key={item}>{item}</li>)}</ul>}</>}
        {topics && topics.length > 0 && <div className="fz-hero__topics"><span>Related topics</span><ul>{topics.map(topic => <li key={topic.label}><button onClick={topic.onClick}>{topic.label}</button></li>)}</ul></div>}
        {children}
      </div>
      {aside}
    </div>
  </section>;
}

/** A compact hero band for detail pages, so every page opens the same way. */
export function DetailHero({ crumbs, eyebrow, title, summary, id, children }: { crumbs: Crumb[]; eyebrow?: ReactNode; title: string; summary?: ReactNode; id?: string; children?: ReactNode }) {
  return <header className="fz-detail-hero">
    <Breadcrumbs crumbs={crumbs} />
    {eyebrow && <span className="fz-detail-hero__eyebrow">{eyebrow}</span>}
    <h1 id={id}>{title}</h1>
    {summary && <p>{summary}</p>}
    {children}
  </header>;
}

/** One facet of the filter sidebar: a checkbox list with result counts. */
export function Facet<T extends string>({ title, values, labels, counts, selected, onToggle }: { title: string; values: readonly T[]; labels: (value: T) => string; counts: Record<T, number>; selected: T[]; onToggle: (value: T) => void }) {
  return <fieldset className="fz-facet">
    <legend>{title}</legend>
    {values.map(value => <label key={value} className={counts[value] === 0 && !selected.includes(value) ? 'is-empty' : ''}>
      <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
      <span className="fz-facet__box" aria-hidden>{selected.includes(value) && <Check size={11} strokeWidth={3} />}</span>
      <span className="fz-facet__label">{labels(value)}</span><span className="fz-facet__count">{counts[value]}</span>
    </label>)}
  </fieldset>;
}

/** Sidebar with search and facets; collapses behind a "Filters" button on narrow screens. */
export function FilterSidebar({ open, active, onClear, query, onQuery, placeholder, children }: { open: boolean; active: number; onClear: () => void; query: string; onQuery: (value: string) => void; placeholder: string; children: ReactNode }) {
  return <aside className={`fz-filters${open ? ' is-open' : ''}`} aria-label="Filters">
    <div className="fz-filters__head"><b>Filters</b>{active > 0 && <button className="fz-link" onClick={onClear}>Clear filters</button>}</div>
    <label className="fz-search fz-catalog__search">
      <Search size={14} aria-hidden />
      <input type="search" placeholder={placeholder} aria-label={placeholder} value={query} onChange={event => onQuery(event.target.value)} />
      {query && <button className="fz-search__clear" onClick={() => onQuery('')} aria-label="Clear search"><X size={13} /></button>}
    </label>
    {children}
  </aside>;
}

export function ResultsBar<S extends string>({ count, active, filtersOpen, onToggleFilters, sort, sorts, onSort, sortLabel }: { count: number; active: number; filtersOpen: boolean; onToggleFilters: () => void; sort: S; sorts: Array<[S, string]>; onSort: (value: S) => void; sortLabel: string }) {
  return <div className="fz-results-bar">
    <h2><b>{count}</b> {count === 1 ? 'result' : 'results'}</h2>
    <button className="fz-btn fz-btn--small fz-filters__toggle" aria-expanded={filtersOpen} onClick={onToggleFilters}><SlidersHorizontal size={13} />Filters{active ? ` (${active})` : ''}</button>
    <label className="fz-sort"><span>Sort by</span>
      <select value={sort} onChange={event => onSort(event.target.value as S)} aria-label={sortLabel}>{sorts.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    </label>
  </div>;
}

export type CardMeta = { icon: LucideIcon; text: string };
/** A catalog card: patterned art band with the component's shape, type label, title, description, metadata and action. */
export function CatalogCard({ tone, kind, number, type, status, title, description, meta, topics, note, cta, className = '' }: {
  tone: string; kind: Kind; number?: string | number; type: string; status?: ReactNode; title: string; description: string;
  meta: CardMeta[]; topics?: string[]; note?: ReactNode;
  cta: { label: string; ariaLabel?: string; onClick: () => void; disabled?: boolean; secondary?: boolean };
  className?: string;
}) {
  return <article className={`fz-ccard ${tone} ${className}`}>
    <div className="fz-ccard__art" aria-hidden><ShapeGlyph kind={kind} size={44} />{number !== undefined && <span>{typeof number === 'number' ? String(number).padStart(2, '0') : number}</span>}</div>
    <div className="fz-ccard__body">
      <div className="fz-ccard__type"><span>{type}</span>{status}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      <ul className="fz-ccard__meta">{meta.map(({ icon: Icon, text }) => <li key={text}><Icon size={13} aria-hidden />{text}</li>)}</ul>
      {topics && topics.length > 0 && <div className="fz-ccard__topics">{topics.map(topic => <span key={topic}>{topic}</span>)}</div>}
      {note}
    </div>
    <button className={`fz-ccard__cta${cta.secondary ? ' is-secondary' : ''}`} disabled={cta.disabled} onClick={cta.onClick} aria-label={cta.ariaLabel}>
      {cta.disabled ? <Lock size={13} aria-hidden /> : null}{cta.label}{!cta.disabled && <ArrowRight size={14} aria-hidden />}
    </button>
  </article>;
}

export type Related = { icon: LucideIcon; type: string; title: string; text: string; onClick: () => void };
export function RelatedResources({ id, title = 'Related resources', items }: { id: string; title?: string; items: Related[] }) {
  return <section className="fz-related" aria-labelledby={id}>
    <h2 id={id}>{title}</h2>
    <div className="fz-related__grid">{items.map(({ icon: Icon, type, title: cardTitle, text, onClick }) => <button key={cardTitle} className="fz-related__card" onClick={onClick}>
      <Icon size={22} aria-hidden /><span className="fz-ccard__type"><span>{type}</span></span><b>{cardTitle}</b><span>{text}</span>
    </button>)}</div>
  </section>;
}

export type FooterTarget = 'learn' | 'guides' | 'playground' | 'interview' | 'challenges';
/** Site footer: every link navigates within Flowzen. */
export function SiteFooter({ onNavigate }: { onNavigate: (target: FooterTarget) => void }) {
  const column = (title: string, links: Array<[FooterTarget, string]>) => <div><h2>{title}</h2><ul>{links.map(([target, label]) => <li key={label}><button onClick={() => onNavigate(target)}>{label}</button></li>)}</ul></div>;
  return <footer className="fz-footer">
    <div className="fz-footer__inner">
      <div className="fz-footer__brand"><b>Flowzen</b><p>Learn system design by building, simulating and measuring architectures. Everything runs in your browser.</p></div>
      {column('Learn', [['learn', 'Learning track'], ['guides', 'Component guides']])}
      {column('Practice', [['playground', 'Playground'], ['interview', 'Interview preparation'], ['challenges', 'Challenges']])}
    </div>
    <p className="fz-footer__legal">Progress, drafts and history are stored locally in this browser.</p>
  </footer>;
}

/** Applies the catalog body layout: filter sidebar on the left, results on the right. */
export function CatalogBody({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return <div className="fz-catalog__body">{sidebar}<main className="fz-results-area">{children}</main></div>;
}
