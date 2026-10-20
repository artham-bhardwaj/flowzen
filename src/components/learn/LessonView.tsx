import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, CircleCheck, Circle, Code2, ExternalLink, FlaskConical, Trophy } from 'lucide-react';
import { byKind, type Kind } from '../../app/catalog';
import { challengeById } from '../../challenges/definitions';
import { GUIDES } from '../../learn/components';
import { LESSONS, SUPPORT_LABELS, moduleById } from '../../learn/curriculum';
import { experimentById } from '../../learn/experiments';
import { requirements, type LearnState } from '../../learn/progress';
import type { LearnController } from '../../learn/useLearn';
import type { BuildTask, Lesson, SectionId } from '../../learn/types';
import { ExperimentPanel } from './ExperimentPanel';
import { ShapeGlyph } from '../shapes';
import { ExerciseView, KnowledgeCheck } from './Practice';
import { Blocks, DataTable, DiagramView, Inline } from './Rich';

export const SECTION_LABELS: Record<SectionId, string> = { concept: 'Concept', why: 'Why and when', alternatives: 'Alternatives', design: 'Design example', experiment: 'Experiment', check: 'Knowledge check', exercise: 'Exercise' };
export const sectionsOf = (lesson: Lesson): SectionId[] => ['concept', 'why', 'alternatives', 'design', 'experiment', 'check', ...(lesson.exercise ? ['exercise' as const] : [])];

type Props = {
  lesson: Lesson; section: SectionId; learn: LearnController; challengeSolved: (id: string) => boolean;
  onSection: (section: SectionId) => void; onLesson: (id: string) => void; onComponent: (kind: Kind, tab?: 'guide' | 'lld') => void;
  onOpenExperiment: (id: string) => void; onOpenBuild: (lessonId: string, task: BuildTask) => void; onOpenChallenge: (id: string) => void;
};

export function LessonView({ lesson, section, learn, challengeSolved, onSection, onLesson, onComponent, onOpenExperiment, onOpenBuild, onOpenChallenge }: Props) {
  const { state } = learn; const progress = state.lessons[lesson.id];
  const sections = sectionsOf(lesson); const index = sections.indexOf(section);
  const module = moduleById(lesson.moduleId)!; const lessonNumber = module.lessons.findIndex(entry => entry.id === lesson.id) + 1;
  const position = LESSONS.findIndex(entry => entry.id === lesson.id); const following = LESSONS[position + 1];
  const top = useRef<HTMLDivElement>(null);
  const { visit } = learn;
  useEffect(() => { visit(lesson.id, section); }, [lesson.id, section, visit]);
  const go = (next: SectionId) => { onSection(next); top.current?.scrollIntoView({ block: 'start' }); };
  const reqs = requirements(state, lesson);
  const visited = new Set(progress?.visited ?? []);

  return <article className="fz-lessonview" aria-labelledby="fz-lesson-title">
    <div ref={top} />
    <header className="fz-lessonview__head fz-detail-hero">
      <nav className="fz-crumbs fz-crumbs--plain" aria-label="Breadcrumb"><span>Module {module.number} · {module.title}</span><span aria-hidden>/</span><span aria-current="page">Lesson {lessonNumber}</span></nav>
      <h1 id="fz-lesson-title">{lesson.title}</h1>
      <p className="fz-lessonview__summary">{lesson.summary}</p>
      <div className="fz-lessonview__meta"><span>About {lesson.minutes} min</span><span className={`fz-support is-${lesson.simulator}`} title={SUPPORT_LABELS[lesson.simulator].description}>{SUPPORT_LABELS[lesson.simulator].label}</span></div>
      <p className="fz-lessonview__simnote"><FlaskConical size={13} aria-hidden /><span>{lesson.simulatorNote}</span></p>
      <ul className="fz-checklist" aria-label="Completion">{reqs.map(req => <li key={req.id} className={req.done ? 'is-done' : ''}>{req.done ? <CircleCheck size={14} aria-hidden /> : <Circle size={14} aria-hidden />}<span>{req.label}</span><span className="fz-visually-hidden">{req.done ? ' (done)' : ' (not done)'}</span></li>)}</ul>
    </header>

    <nav className="fz-steps" aria-label="Lesson sections">
      {sections.map((id, i) => <button key={id} className={`${id === section ? 'is-on' : ''}${visited.has(id) ? ' is-visited' : ''}`} aria-current={id === section ? 'step' : undefined} onClick={() => go(id)}><span>{String.fromCharCode(65 + i)}</span>{SECTION_LABELS[id]}</button>)}
    </nav>

    <div className="fz-lessonview__body">
      {section === 'concept' && <ConceptSection lesson={lesson} />}
      {section === 'why' && <WhySection lesson={lesson} />}
      {section === 'alternatives' && <AlternativesSection lesson={lesson} onComponent={onComponent} />}
      {section === 'design' && <DesignSection lesson={lesson} />}
      {section === 'experiment' && <section aria-label="Practical experiment">
        <h2>Practical experiment</h2>
        {lesson.experiment && experimentById(lesson.experiment) ? <>
          <ExperimentPanel template={experimentById(lesson.experiment)!} records={state.experiments[lesson.experiment] ?? []} onRecord={learn.recordExperiment} />
          <div className="fz-brief__actions"><button className="fz-btn" onClick={() => onOpenExperiment(lesson.experiment!)}><ExternalLink size={13} />Open in the Playground</button><span className="fz-brief__note">Load any variant into the canvas, change it, and compare it with your own designs.</span></div>
        </> : <div className="fz-callout is-sim" role="note"><FlaskConical size={15} aria-hidden /><div><b>No simulated experiment for this lesson</b><p>{lesson.noExperimentReason}</p></div></div>}
      </section>}
      {section === 'check' && <><h2>Knowledge check</h2><KnowledgeCheck key={lesson.id} questions={lesson.quiz} progress={progress} onSubmit={(result, answers) => learn.recordQuiz(lesson.id, result, answers)} /></>}
      {section === 'exercise' && lesson.exercise && <><h2>Practical exercise · {lesson.exercise.title}</h2><ExerciseView key={lesson.id} exercise={lesson.exercise} progress={progress} onTaskPassed={taskId => learn.recordTask(lesson.id, taskId)} onOpenBuild={task => onOpenBuild(lesson.id, task)} /></>}
    </div>

    <nav className="fz-lessonview__pager" aria-label="Section navigation">
      {index > 0 ? <button className="fz-btn" onClick={() => go(sections[index - 1])}><ArrowLeft size={13} />{SECTION_LABELS[sections[index - 1]]}</button> : <span />}
      {index < sections.length - 1 ? <button className="fz-btn fz-btn--primary" onClick={() => go(sections[index + 1])}>{SECTION_LABELS[sections[index + 1]]}<ArrowRight size={13} /></button>
        : following ? <button className="fz-btn fz-btn--primary" onClick={() => onLesson(following.id)}>Next lesson: {following.title}<ArrowRight size={13} /></button> : <span />}
    </nav>

    <aside className="fz-lessonview__related" aria-label="Related">
      <h2>Related</h2>
      <h3>Components</h3>
      <ul className="fz-related-comps">{lesson.components.map(kind => <li key={kind}>
        <button className={`fz-related-comp cat-${byKind[kind].category}`} onClick={() => onComponent(kind)}><ShapeGlyph kind={kind} size={22} /><b>{byKind[kind].label}</b><span>{GUIDES[kind].why}</span></button></li>)}</ul>
      {lesson.lld.length > 0 && <><h3>Low-level designs <small>illustrative Java</small></h3><div className="fz-chips">{lesson.lld.map(kind => <button key={kind} className="fz-chip is-design" onClick={() => onComponent(kind, 'lld')}><Code2 size={11} aria-hidden />{byKind[kind].label}</button>)}</div></>}
      {lesson.challenges.length > 0 && <><h3>Optional practice <small>challenges</small></h3>
        <ul className="fz-related-challenges">{lesson.challenges.map(id => { const challenge = challengeById(id); return challenge && <li key={id}><button className="fz-link" onClick={() => onOpenChallenge(id)}><Trophy size={12} aria-hidden />{challenge.number}. {challenge.title}</button>{challengeSolved(id) && <span className="fz-cstatus is-solved"><CircleCheck size={11} aria-hidden />Solved</span>}</li>; })}</ul>
        <p className="fz-brief__note">Challenges are optional and never required to complete a lesson. Your learning progress is kept when you open one.</p></>}
    </aside>
  </article>;
}

function List({ title, items }: { title: string; items: string[] }) {
  return <section><h3>{title}</h3><ul className="fz-prose__list">{items.map(item => <li key={item}><Inline text={item} /></li>)}</ul></section>;
}

function ConceptSection({ lesson }: { lesson: Lesson }) {
  const { concept } = lesson;
  return <section aria-label="Concept">
    <h2>Concept</h2>
    <p className="fz-definition"><Inline text={concept.definition} /></p>
    <h3>The problem it solves</h3><Blocks blocks={concept.problem} />
    <h3>Why that problem occurs</h3><Blocks blocks={concept.whyItOccurs} />
    <h3>How it works</h3><Blocks blocks={concept.howItWorks} />
    {concept.diagrams.map(diagram => <DiagramView key={diagram.id} diagram={diagram} />)}
    {concept.deeper && <details className="fz-deeper"><summary>Go deeper</summary><Blocks blocks={concept.deeper} /></details>}
    <h3>Terminology</h3>
    <dl className="fz-terms">{concept.terms.map(term => <div key={term.term}><dt>{term.term}</dt><dd><Inline text={term.definition} /></dd></div>)}</dl>
    <div className="fz-example"><b>Real-world example · {concept.example.title}</b><Blocks blocks={concept.example.blocks} /></div>
    <div className="fz-guide__grid"><List title="Advantages" items={concept.advantages} /><List title="Limitations" items={concept.limitations} /></div>
  </section>;
}

function WhySection({ lesson }: { lesson: Lesson }) {
  const { whyWhen } = lesson;
  return <section aria-label="Why and when to use it">
    <h2>Why and when</h2>
    <p className="fz-definition"><Inline text={whyWhen.justification} /></p>
    <div className="fz-guide__grid">
      <List title="Useful when" items={whyWhen.usefulWhen} /><List title="Unnecessary when" items={whyWhen.unnecessaryWhen} />
      <List title="Can make things worse when" items={whyWhen.makesWorse} /><List title="Operational complexity" items={whyWhen.complexity} />
      <List title="Failure modes to consider" items={whyWhen.failureModes} /><List title="Evidence that justifies it" items={whyWhen.evidence} />
    </div>
  </section>;
}

function AlternativesSection({ lesson, onComponent }: { lesson: Lesson; onComponent: (kind: Kind) => void }) {
  const { alternatives } = lesson;
  return <section aria-label="Alternatives and trade-offs">
    <h2>Alternatives and trade-offs</h2>
    <p className="fz-prose__p"><Inline text={alternatives.intro} /></p>
    <DataTable caption={alternatives.table.caption} columns={alternatives.table.columns} rows={alternatives.table.rows} />
    <h3>When each fits</h3>
    <ul className="fz-guide__alts">{alternatives.options.map(option => <li key={option.name}>
      {option.kind ? <button className="fz-link" onClick={() => onComponent(option.kind!)}>{option.name}</button> : <b>{option.name}</b>}<span><Inline text={option.chooseWhen} /></span>
    </li>)}</ul>
    <p className="fz-brief__note">No option is best in every situation. Choose from the workload, the requirements and what you can operate.</p>
  </section>;
}

function DesignSection({ lesson }: { lesson: Lesson }) {
  const { design } = lesson;
  return <section aria-label="Design example">
    <h2>Design example</h2>
    <p className="fz-prose__p">{design.summary}</p>
    <DiagramView diagram={design.diagram} />
    <div className="fz-guide__grid">
      <List title="Upstream" items={design.upstream} /><List title="Downstream" items={design.downstream} />
      <List title="Request and data flow" items={design.flow} /><List title="Configuration decisions" items={design.configuration} />
      <List title="Bottlenecks introduced or removed" items={design.bottlenecks} /><List title="When it fails" items={design.failure} />
    </div>
  </section>;
}
export type { LearnState };
