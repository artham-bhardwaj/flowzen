import { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleCheck, CircleDashed, CircleDot, LayoutGrid, ListTree } from 'lucide-react';
import type { Kind } from '../../app/catalog';
import type { Progress as ChallengeProgress } from '../../challenges/progress';
import { LESSONS, MODULES, SUPPORT_LABELS, lessonById, moduleById } from '../../learn/curriculum';
import { lessonStatus, moduleProgress, trackProgress, type LessonStatus } from '../../learn/progress';
import type { LearnController } from '../../learn/useLearn';
import { isLesson, type BuildTask, type SectionId } from '../../learn/types';
import { ComponentGuideView, ComponentIndex } from './ComponentGuide';
import { LessonView } from './LessonView';
import { LearnCatalog } from './LearnCatalog';
import type { FooterTarget } from '../catalog/Shell';

export type LearnView =
  | { type: 'dashboard' } | { type: 'module'; id: string }
  | { type: 'lesson'; id: string; section: SectionId }
  | { type: 'components' } | { type: 'component'; kind: Kind; tab?: 'guide' | 'lld' };

type Props = {
  learn: LearnController; view: LearnView; onView: (view: LearnView) => void; challengeProgress: ChallengeProgress;
  onOpenExperiment: (id: string) => void; onOpenBuild: (lessonId: string, task: BuildTask) => void;
  onOpenChallenge: (id: string) => void; onOpenChallenges: () => void; onOpenPlayground: () => void;
  onOpenInterviews: () => void;
  onFooter: (target: FooterTarget) => void;
};

const StatusIcon = ({ status }: { status: LessonStatus | 'planned' }) => status === 'completed' ? <CircleCheck size={14} className="is-done" aria-label="Completed" />
  : status === 'in-progress' ? <CircleDot size={14} className="is-progress" aria-label="In progress" /> : status === 'planned' ? <CircleDashed size={14} className="is-planned" aria-label="Planned" /> : <span className="fz-dot" aria-label="Not started" />;

/** The Learn experience: curriculum navigation, progress dashboard, lessons and component guides. */
export function LearnPage(props: Props) {
  const { learn, view, onView } = props;
  const main = useRef<HTMLElement>(null);
  const [navOpen, setNavOpen] = useState(false);
  const activeModule = view.type === 'lesson' ? lessonById(view.id)?.moduleId : view.type === 'module' ? view.id : undefined;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([activeModule ?? 'foundations']));
  useEffect(() => { if (activeModule) setExpanded(current => current.has(activeModule) ? current : new Set([...current, activeModule])); }, [activeModule]);
  // Each new page starts at the top.
  const key = view.type === 'lesson' ? `${view.id}` : view.type === 'component' ? `c-${view.kind}` : view.type === 'module' ? `m-${view.id}` : view.type;
  useEffect(() => { main.current?.scrollTo({ top: 0 }); setNavOpen(false); }, [key]);
  const track = trackProgress(learn.state);
  const navigate = (next: LearnView) => onView(next);
  // The overview is a catalog page like every other tab; lessons, modules and guides keep the curriculum sidebar.
  if (view.type === 'dashboard') return <LearnCatalog learn={learn} onView={onView} challengeProgress={props.challengeProgress} onOpenExperiment={props.onOpenExperiment}
    onOpenChallenge={props.onOpenChallenge} onOpenChallenges={props.onOpenChallenges} onOpenPlayground={props.onOpenPlayground} onOpenInterviews={props.onOpenInterviews} onFooter={props.onFooter} />;

  return <div className="fz-page fz-learn">
    <aside className={`fz-learn__nav${navOpen ? ' is-open' : ''}`} aria-label="Curriculum">
      <button className="fz-learn__navitem" onClick={() => navigate({ type: 'dashboard' })}><LayoutGrid size={14} aria-hidden />Overview</button>
      <button className={`fz-learn__navitem${view.type === 'components' || view.type === 'component' ? ' is-on' : ''}`} aria-current={view.type === 'components' ? 'page' : undefined} onClick={() => navigate({ type: 'components' })}><ListTree size={14} aria-hidden />Component guides</button>
      <div className="fz-learn__track"><span className="fz-eyebrow">System Design track</span><span className="fz-bar"><span style={{ width: `${track.completed / track.total * 100}%` }} /></span><small>{track.completed} of {track.total} written lessons completed</small></div>
      <ol className="fz-learn__modules">{MODULES.map(module => {
        const progress = moduleProgress(learn.state, module); const open = expanded.has(module.id);
        return <li key={module.id} className={activeModule === module.id ? 'is-active' : ''}>
          <div className="fz-learn__module">
            <button className="fz-learn__modtoggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} module ${module.number}`} onClick={() => setExpanded(current => { const next = new Set(current); if (next.has(module.id)) next.delete(module.id); else next.add(module.id); return next; })}><ChevronDown size={13} aria-hidden /></button>
            <button className={`fz-learn__modtitle${view.type === 'module' && view.id === module.id ? ' is-on' : ''}`} onClick={() => navigate({ type: 'module', id: module.id })}>
              <span>{module.number}. {module.title}</span><small>{progress.written ? `${progress.completed}/${progress.written}${progress.planned ? ` · ${progress.planned} planned` : ''}` : 'planned'}</small>
            </button>
          </div>
          {open && <ol className="fz-learn__lessons">{module.lessons.map(entry => isLesson(entry)
            ? <li key={entry.id}><button className={view.type === 'lesson' && view.id === entry.id ? 'is-on' : ''} aria-current={view.type === 'lesson' && view.id === entry.id ? 'page' : undefined} onClick={() => navigate({ type: 'lesson', id: entry.id, section: 'concept' })}><StatusIcon status={lessonStatus(learn.state, entry)} /><span>{entry.title}</span></button></li>
            : <li key={entry.id} className="is-planned"><span><StatusIcon status="planned" /><span>{entry.title}</span></span></li>)}</ol>}
        </li>;
      })}</ol>
    </aside>
    <main className="fz-learn__main" ref={main}>
      <button className="fz-btn fz-btn--small fz-learn__navtoggle" aria-expanded={navOpen} onClick={() => setNavOpen(open => !open)}><ListTree size={13} />Curriculum</button>
      {(learn.dropped.length > 0 || learn.saveFailed) && <div className="fz-learn__alerts">
        {learn.dropped.length > 0 && <div className="fz-alert is-warn"><span><b>Some saved learning progress could not be loaded</b>It was left out rather than replaced: {learn.dropped.join('; ')}.</span></div>}
        {learn.saveFailed && <div className="fz-alert is-bad"><span>Learning progress could not be saved in this browser (storage full or blocked). It is kept for this session only.</span></div>}
      </div>}
      {view.type === 'module' && moduleById(view.id) && <ModuleView id={view.id} {...props} />}
      {view.type === 'lesson' && lessonById(view.id) && <LessonView key={view.id} lesson={lessonById(view.id)!} section={view.section} learn={learn}
        challengeSolved={id => Boolean(props.challengeProgress.challenges[id]?.solved)}
        onSection={section => navigate({ type: 'lesson', id: view.id, section })} onLesson={id => navigate({ type: 'lesson', id, section: 'concept' })}
        onComponent={(kind, tab) => navigate({ type: 'component', kind, tab })} onOpenExperiment={props.onOpenExperiment} onOpenBuild={props.onOpenBuild} onOpenChallenge={props.onOpenChallenge} />}
      {view.type === 'components' && <ComponentIndex onKind={kind => navigate({ type: 'component', kind })} />}
      {view.type === 'component' && <ComponentGuideView key={`${view.kind}-${view.tab ?? 'guide'}`} kind={view.kind} initialTab={view.tab} onKind={kind => navigate({ type: 'component', kind })} onLesson={id => navigate({ type: 'lesson', id, section: 'concept' })} onExperiment={props.onOpenExperiment} />}
    </main>
  </div>;
}

function ModuleView({ id, learn, onView }: Props & { id: string }) {
  const module = moduleById(id)!; const progress = moduleProgress(learn.state, module);
  const written = LESSONS.filter(lesson => lesson.moduleId === id).length;
  return <article className="fz-guide" aria-labelledby="fz-module-title">
    <header className="fz-guide__head fz-detail-hero"><div><span className="fz-eyebrow">Module {module.number}</span><h1 id="fz-module-title">{module.title}</h1><p>{module.summary}</p>
      <p className="fz-brief__note">{written ? `${progress.completed} of ${written} written lessons completed.` : 'This module is planned: its lessons are listed so you can see where the track goes.'} {progress.planned > 0 && written > 0 && `${progress.planned} more lessons are planned.`}</p></div></header>
    <ol className="fz-modlessons">{module.lessons.map((entry, index) => <li key={entry.id} className={isLesson(entry) ? '' : 'is-planned'}>
      <span className="fz-modlessons__num">{index + 1}</span>
      <div>{isLesson(entry) ? <button className="fz-link" onClick={() => onView({ type: 'lesson', id: entry.id, section: 'concept' })}><b>{entry.title}</b></button> : <b>{entry.title}</b>}
        {isLesson(entry) ? <span>{entry.summary}</span> : <span>Planned. {SUPPORT_LABELS[entry.simulator].description}</span>}</div>
      <span className={`fz-support is-${entry.simulator}`}>{SUPPORT_LABELS[entry.simulator].label}</span>
      {isLesson(entry) ? <StatusIcon status={lessonStatus(learn.state, entry)} /> : <em className="fz-tag">planned</em>}
    </li>)}</ol>
  </article>;
}
