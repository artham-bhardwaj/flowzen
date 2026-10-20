import { Gauge, LoaderCircle, Moon, PanelLeft, PanelRight, Pause, Play, Redo2, RotateCcw, Sun, Timer, Undo2 } from 'lucide-react';
import { isMacPlatform } from '../app/history';
import type { HistoryControls } from '../app/useArchitectureHistory';
import type { ViewMode } from '../app/model';
import type { Theme } from '../app/theme';

export const SPEEDS = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 5, 10];
const views: Array<[ViewMode, string]> = [
  ['HLD', 'High-level design: components, connections and each component’s role in the system'],
  ['LLD', 'Low-level design: configuration on the canvas; classes, Java code and design principles in the inspector'],
  ['Unified', 'Live simulation detail on the canvas, with both the component role and its low-level design in the inspector'],
];

export type NavTarget = 'learn' | 'playground' | 'design' | 'challenges' | 'lab' | 'interview';
type Props = {
  page: 'learn' | 'design' | 'challenges' | 'challenge' | 'lab' | 'interview' | 'interview-design'; challengeTitle?: string;
  /** `playground` goes to the Playground mode used last (the lab or the free canvas). */
  onNavigate: (target: NavTarget) => void;
  /** In a challenge the benchmark fixes traffic and duration. */
  workloadLocked: boolean;
  projectName: string; onProjectName: (name: string) => void;
  view: ViewMode; onView: (view: ViewMode) => void; theme: Theme; onToggleTheme: () => void;
  traffic: number; onTraffic: (rps: number) => void; duration: number; onDuration: (seconds: number) => void; speed: number; onSpeed: (speed: number) => void;
  computing: boolean; hasResult: boolean; playing: boolean; atEnd: boolean; canRun: boolean;
  onRun: () => void; onPlayPause: () => void; onReset: () => void;
  libraryOpen: boolean; onToggleLibrary: () => void; inspectorOpen: boolean; onToggleInspector: () => void;
  /** Architecture edit history; absent on pages without a canvas. */
  history?: Pick<HistoryControls, 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel' | 'undo' | 'redo'>;
};

const MAC = isMacPlatform();
const UNDO_KEYS = MAC ? '⌘Z' : 'Ctrl+Z';
const REDO_KEYS = MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z or Ctrl+Y';

function HistoryButtons({ history }: { history: NonNullable<Props['history']> }) {
  const undoTitle = history.canUndo ? `Undo ${history.undoLabel} (${UNDO_KEYS})` : `Nothing to undo (${UNDO_KEYS})`;
  const redoTitle = history.canRedo ? `Redo ${history.redoLabel} (${REDO_KEYS})` : `Nothing to redo (${REDO_KEYS})`;
  return <div className="fz-history" role="group" aria-label="Edit history">
    {/* Tooltips sit on a wrapper because disabled buttons do not receive hover events. */}
    <span title={undoTitle}><button className="fz-icon-btn" onClick={history.undo} disabled={!history.canUndo} aria-label={undoTitle} aria-keyshortcuts={MAC ? 'Meta+Z' : 'Control+Z'}><Undo2 size={15} /></button></span>
    <span title={redoTitle}><button className="fz-icon-btn" onClick={history.redo} disabled={!history.canRedo} aria-label={redoTitle} aria-keyshortcuts={MAC ? 'Meta+Shift+Z' : 'Control+Shift+Z Control+Y'}><Redo2 size={15} /></button></span>
  </div>;
}

function Logo() {
  return <svg className="fz-logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
    <rect x="1.5" y="1.5" width="21" height="21" rx="6" className="fz-logo__bg" />
    <path d="M6.5 15.5c3.5 0 3.5-7 7-7h4" className="fz-logo__flow" />
    <circle cx="6.5" cy="15.5" r="2" className="fz-logo__dot" /><circle cx="17.5" cy="8.5" r="2" className="fz-logo__dot" />
  </svg>;
}

export function Toolbar(props: Props) {
  const playground = props.page === 'design' || props.page === 'lab';
  const pageMode = props.page === 'challenges' || props.page === 'learn' || props.page === 'interview';
  const interview = props.page === 'interview' || props.page === 'interview-design';
  const clampInt = (value: string, min: number, max: number, fallback: number) => { const parsed = Math.round(Number(value)); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; };
  return <header className={`fz-toolbar${pageMode ? ' is-page' : ''}`}>
    <div className="fz-toolbar__group">
      <span className="fz-brand"><Logo /><span>Flowzen</span></span>
      <span className="fz-divider" aria-hidden />
      <nav className="fz-segmented fz-nav" aria-label="Main">
        <button className={props.page === 'learn' ? 'is-on' : ''} aria-current={props.page === 'learn' ? 'page' : undefined} onClick={() => props.onNavigate('learn')} title="Learning track: lessons, experiments and exercises">Learn</button>
        <button className={playground ? 'is-on' : ''} aria-current={playground ? 'page' : undefined} onClick={() => props.onNavigate('playground')} title="Build, experiment and compare designs">Playground</button>
        <button className={interview ? 'is-on' : ''} aria-current={interview ? 'page' : undefined} onClick={() => props.onNavigate('interview')} title="System design interview preparation">Interview</button>
        <button className={props.page === 'challenges' || props.page === 'challenge' ? 'is-on' : ''} aria-current={props.page === 'challenges' || props.page === 'challenge' ? 'page' : undefined} onClick={() => props.onNavigate('challenges')} title="Optional graded practice">Challenges</button>
      </nav>
      {playground && <div className="fz-segmented fz-subnav" role="group" aria-label="Playground mode">
        <button className={props.page === 'lab' ? 'is-on' : ''} aria-pressed={props.page === 'lab'} onClick={() => props.onNavigate('lab')} title="Scaling Laboratory: guided experiments, baselines, variants and sweeps">Lab</button>
        <button className={props.page === 'design' ? 'is-on' : ''} aria-pressed={props.page === 'design'} onClick={() => props.onNavigate('design')} title="Free design canvas: sketch and simulate any traffic">Canvas</button>
      </div>}
      {props.page === 'design' && <label className="fz-project"><span className="fz-visually-hidden">Project name</span>
        <input value={props.projectName} onChange={event => props.onProjectName(event.target.value)} spellCheck={false} />
      </label>}
      {(props.page === 'challenge' || props.page === 'interview-design') && <span className="fz-challenge-name" title={props.challengeTitle}>{props.challengeTitle}</span>}
      {!pageMode && <button className="fz-icon-btn" onClick={props.onToggleLibrary} aria-pressed={props.libraryOpen} aria-label="Toggle component library" title="Component library"><PanelLeft size={15} /></button>}
      {!pageMode && props.history && <HistoryButtons history={props.history} />}
    </div>

    {!pageMode && <div className="fz-segmented" role="radiogroup" aria-label="Design view">
      {views.map(([view, title]) => <button key={view} role="radio" aria-checked={props.view === view} className={props.view === view ? 'is-on' : ''} onClick={() => props.onView(view)} title={title}>{view}</button>)}
    </div>}

    {pageMode ? <div className="fz-toolbar__group">
      <button className="fz-icon-btn" onClick={props.onToggleTheme} aria-label={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} theme`}>
        {props.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </div> : <div className="fz-toolbar__group fz-toolbar__sim">
      <fieldset className="fz-workload" disabled={props.workloadLocked} title={props.workloadLocked ? 'Fixed by the benchmark' : undefined}>
      <legend className="fz-visually-hidden">Workload{props.workloadLocked ? ' (fixed by the benchmark)' : ''}</legend>
      <label className="fz-control fz-control--traffic" title={props.workloadLocked ? 'Fixed by the benchmark' : 'Total offered traffic, split round-robin across clients'}>
        <Gauge size={14} aria-hidden /><span className="fz-visually-hidden">Traffic in requests per second</span>
        <input type="range" min={10} max={10000} step={10} value={props.traffic} onChange={event => props.onTraffic(Number(event.target.value))} aria-label="Traffic" aria-valuetext={`${props.traffic} requests per second`} />
        <input type="number" className="fz-num" min={1} max={10000} value={props.traffic} onChange={event => props.onTraffic(clampInt(event.target.value, 1, 10000, props.traffic))} aria-label="Traffic in requests per second" />
        <span className="fz-unit">rps</span>
      </label>
      <label className="fz-control" title="Simulated duration">
        <Timer size={14} aria-hidden />
        <input type="number" className="fz-num fz-num--short" min={1} max={60} value={props.duration} onChange={event => props.onDuration(clampInt(event.target.value, 1, 60, props.duration))} aria-label="Simulated duration in seconds" />
        <span className="fz-unit">s</span>
      </label>
      </fieldset>
      <label className="fz-control" title="Playback speed: simulated time per wall-clock second">
        <span className="fz-visually-hidden">Playback speed</span>
        <select value={props.speed} onChange={event => props.onSpeed(Number(event.target.value))} aria-label="Playback speed">
          {SPEEDS.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
        </select>
      </label>
      <span className="fz-divider" aria-hidden />
      <button className="fz-btn fz-btn--primary" onClick={props.onRun} disabled={!props.canRun || props.computing} aria-busy={props.computing}>
        {props.computing ? <LoaderCircle size={14} className="fz-spin" /> : <Play size={14} />}{props.computing ? 'Simulating…' : props.page === 'challenge' ? 'Practice run' : props.hasResult ? 'Run again' : 'Run'}
      </button>
      <button className="fz-btn" onClick={props.onPlayPause} disabled={!props.hasResult || props.computing}>
        {props.playing ? <><Pause size={14} /><span className="fz-btn__label">Pause</span></> : <><Play size={14} /><span className="fz-btn__label">{props.atEnd ? 'Replay' : 'Resume'}</span></>}
      </button>
      <button className="fz-btn" onClick={props.onReset} disabled={!props.hasResult || props.computing} title="Clear simulation results and return to design mode"><RotateCcw size={14} /><span className="fz-btn__label">Reset</span></button>
      <span className="fz-divider" aria-hidden />
      <button className="fz-icon-btn" onClick={props.onToggleTheme} aria-label={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} theme`}>
        {props.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button className="fz-icon-btn" onClick={props.onToggleInspector} aria-pressed={props.inspectorOpen} aria-label="Toggle inspector" title="Inspector"><PanelRight size={15} /></button>
    </div>}
  </header>;
}
