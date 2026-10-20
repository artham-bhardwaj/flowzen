import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addEdge, useEdgesState, useNodesState, useReactFlow, type Connection, type OnSelectionChangeFunc } from '@xyflow/react';
import { SimulationClock, type RequestRecord, type SimulationInput, type SimulationResult } from '../simulation/engine';
import { challengeById } from '../challenges/definitions';
import { benchmarkInput, grade, lockedConfig } from '../challenges/grading';
import { loadProgress, recordAttempt, saveDraft, saveProgress, type Draft } from '../challenges/progress';
import { buildAttemptRecord, parseAttemptRecord, snapshotArchitecture, snapshotToDraft, validateArchitectureSnapshot, type ArchitectureSnapshot, type AttemptRecord } from '../challenges/attempts';
import { labInput } from '../lab/lab';
import { useLab } from '../lab/useLab';
import { addReplica, insertCacheBefore } from '../lab/edits';
import { reconnectEdge } from './edges';
import type { AttemptsView } from '../components/AttemptsDialog';
import { gradeSubmission, prepareSubmission, type PreparedSubmission, type SubmissionOutcome } from '../challenges/submission';
import { nextRightTab, type PanelEvent, type RightTab } from './rightPanel';
import { starterArchitecture, toArchitecture, withLocks } from '../challenges/starter';
import { ChallengePanel, ChallengeStrip } from '../components/ChallengePanel';
import { useLearn } from '../learn/useLearn';
import { lessonById } from '../learn/curriculum';
import { lessonStatus, lessonsForChallenge, lessonsForCriterion } from '../learn/progress';
import { swapComponent } from '../learn/alternatives';
import { taskArchitecture } from '../learn/evaluate';
import type { BuildTask } from '../learn/types';
import type { LearnView } from '../components/learn/LearnPage';
import type { PlaygroundFocus } from '../components/learn/GuidedPanel';
import type { NavTarget } from '../components/Toolbar';
import { useInterviews } from '../interview/useInterviews';
import type { InterviewDefinition } from '../interview/types';
import { benchmarkInput as interviewBenchmarkInput } from '../interview/benchmark';
import { update as updateSession } from '../interview/session';
import type { Resource } from '../interview/types';
import type { InterviewView } from '../components/interview/InterviewPage';
import type { FooterTarget } from '../components/catalog/Shell';
// Challenge list and results are loaded on demand to keep the editor bundle small.
const ChallengesPage = lazy(() => import('../components/ChallengesPage').then(module => ({ default: module.ChallengesPage })));
const AttemptsDialog = lazy(() => import('../components/AttemptsDialog').then(module => ({ default: module.AttemptsDialog })));
const LabPanel = lazy(() => import('../components/lab/LabPanel').then(module => ({ default: module.LabPanel })));
const ResultsDialog = lazy(() => import('../components/ResultsDialog').then(module => ({ default: module.ResultsDialog })));
const InterviewPage = lazy(() => import('../components/interview/InterviewPage').then(module => ({ default: module.InterviewPage })));
const InterviewBrief = lazy(() => import('../components/interview/InterviewBrief'));
const LearnPage = lazy(() => import('../components/learn/LearnPage').then(module => ({ default: module.LearnPage })));
import type { PlaybackIndex } from '../simulation/playback';
import { BottomPanel, type BottomTab } from '../components/BottomPanel';
import { Canvas } from '../components/Canvas';
import { Inspector, type NodeTab } from '../components/Inspector';
import { Library } from '../components/Library';
import { RequestInspector } from '../components/RequestInspector';
import { Toolbar } from '../components/Toolbar';
import { byKind, type Kind } from './catalog';
import { validateArchitecture, type Fix, type Validation } from './validation';
import { ValidationContext, type ValidationContextValue } from './validationContext';
import { PreRunReview } from '../components/PreRunReview';
import { NODE_WIDTH, sampleEdges, sampleNodes, simulationInput, simulationKey, type ComponentData, type FlowEdge, type FlowNode, type ViewMode } from './model';
import { PlaybackContext, PlaybackStore, useMediaQuery, type PlaybackContextValue } from './playback';
import { useTheme } from './theme';
import { historyShortcut, isEditableTarget, isMacPlatform } from './history';
import { useArchitectureHistory } from './useArchitectureHistory';
import { useSimulationRunner } from './useSimulationRunner';

/** Wall-clock length of one particle trip and of the "recently failed" highlight. */
const TRAVEL_WALL_MS = 450;
const FAILURE_WALL_MS = 650;

/** A run keeps the validation state it was started with, so its results can disclose it. */
type Run = { result: SimulationResult; index: PlaybackIndex; key: string; input: SimulationInput; challengeId?: string; validation: Pick<Validation, 'counts' | 'issues'> };
type Page = { name: 'learn' } | { name: 'interview' } | { name: 'interview-design'; sessionId: string } | { name: 'design' } | { name: 'challenges' } | { name: 'challenge'; id: string } | { name: 'lab' };
/** A graded submission and its own benchmark run, kept apart from the interactive (practice) run. */
type GradeView = SubmissionOutcome & { challengeId: string; benchmark: Omit<Run, 'key'> };
/** Canvas nodes and edges from an architecture snapshot (a fresh, editable copy). */
const fromSnapshot = (snapshot: ArchitectureSnapshot): { nodes: FlowNode[]; edges: FlowEdge[] } => {
  const draft = snapshotToDraft(snapshot);
  return {
    nodes: draft.nodes.map(entry => ({ id: entry.id, type: 'architecture' as const, position: entry.position, data: { label: entry.label, kind: entry.kind, config: entry.config } })),
    edges: draft.edges.map(edge => ({ id: `${edge.source}-${edge.target}`, source: edge.source, target: edge.target, type: 'flow' })),
  };
};
const draftOf = (nodes: FlowNode[], edges: FlowEdge[]): Draft => ({
  nodes: nodes.map(node => ({ id: node.id, kind: node.data.kind, label: node.data.label, config: node.data.config, position: node.position })),
  edges: edges.map(edge => ({ source: edge.source, target: edge.target })),
});

export function App() {
  const { theme, toggle: toggleTheme } = useTheme();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const flow = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(sampleNodes());
  const [edges, setEdges, onEdgesChange] = useEdgesState(sampleEdges());
  // Undo/redo of architecture edits only; selection, playback and results are never recorded.
  const history = useArchitectureHistory(nodes, edges, setNodes, setEdges);
  const [projectName, setProjectName] = useState('Checkout Platform');
  const [view, setView] = useState<ViewMode>('Unified');
  /** Which part of a selected component the inspector shows; HLD always shows the component itself. */
  const [nodeTab, setNodeTab] = useState<NodeTab>('component');
  const [traffic, setTraffic] = useState(400); const [duration, setDuration] = useState(10); const [speed, setSpeed] = useState(0.1);
  const [libraryOpen, setLibraryOpen] = useState(true); const [inspectorOpen, setInspectorOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(true); const [bottomTab, setBottomTab] = useState<BottomTab>('timeline');
  const [minimap, setMinimap] = useState(false);
  const [selection, setSelection] = useState<{ node?: string; edge?: string }>({});
  const selectionRef = useRef(selection); selectionRef.current = selection;
  const [selectedRequest, setSelectedRequest] = useState<number | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [playing, setPlaying] = useState(false); const [atEnd, setAtEnd] = useState(false);
  const store = useMemo(() => new PlaybackStore(), []);
  const speedRef = useRef(speed); speedRef.current = speed;
  const clock = useRef<SimulationClock | null>(null);
  const pending = useRef<{ key: string; input: SimulationInput; challengeId?: string; validation: Run['validation'] } | null>(null);
  /** The submission being graded; its run never replaces the interactive run. */
  const grading = useRef<PreparedSubmission | null>(null);
  // Learn is the entry point; the Playground (lab and free canvas) and Challenges are one click away.
  const [page, setPage] = useState<Page>({ name: 'learn' });
  const [learnView, setLearnView] = useState<LearnView>({ type: 'dashboard' });
  /** Learning progress, stored separately from challenges and the lab. */
  const learn = useLearn();
  /** What a lesson opened the Playground for (a guided experiment or a build exercise). */
  const [labFocus, setLabFocus] = useState<PlaygroundFocus | null>(null);
  /** Interview drafts and history, stored separately from challenges, the lab and learning progress. */
  const interviews = useInterviews();
  const [interviewView, setInterviewView] = useState<InterviewView>({ type: 'dashboard' });
  /** The Playground mode used last, so "Playground" returns to it. */
  const lastPlayground = useRef<'lab' | 'design'>('lab');
  const challenge = page.name === 'challenge' ? challengeById(page.id) ?? null : null;
  const isLab = page.name === 'lab';
  const interviewSession = page.name === 'interview-design' ? interviews.state.drafts.find(draft => draft.id === page.sessionId) ?? null : null;
  /** The open interview's definition, handed over by the lazily loaded Interview page with the session. */
  const [openDefinition, setOpenDefinition] = useState<InterviewDefinition | null>(null);
  const interviewDef = interviewSession && openDefinition?.id === interviewSession.definitionId ? openDefinition : null;
  /** Scaling Laboratory state (baseline, experiments, sweeps, variants), separate from challenges and practice runs. */
  const labCtl = useLab();
  const [progress, setProgress] = useState(() => loadProgress());
  const progressRef = useRef(progress); progressRef.current = progress;
  useEffect(() => { saveProgress(progress); }, [progress]);
  const [rightTab, setRightTab] = useState<RightTab>('challenge');
  /** All right-panel tab changes go through one policy (see rightPanel.ts). */
  const panel = useCallback((event: PanelEvent) => setRightTab(current => nextRightTab(current, event)), []);
  const [gradeView, setGradeView] = useState<GradeView | null>(null); const [resultsOpen, setResultsOpen] = useState(false);
  /** Review or comparison of retained attempts; read-only over the stored records. */
  const [attemptsView, setAttemptsView] = useState<AttemptsView | null>(null);
  /** The free-design canvas, kept while the user works on challenges. */
  const designStash = useRef<{ nodes: FlowNode[]; edges: typeof edges } | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [review, setReview] = useState(false);
  /** Issue signature the user already chose to run with; the review is shown again only if issues change. */
  const acknowledged = useRef<string | null>(null);

  // In a challenge, every run (practice or submission) uses the benchmark workload, never the toolbar settings.
  // In the lab, a practice run uses the lab benchmark; lab experiments themselves run separately (see useLab).
  const labSnapshot = useMemo(() => isLab ? snapshotArchitecture(nodes, edges) : null, [edges, isLab, nodes]);
  const interviewSnapshot = useMemo(() => interviewDef ? snapshotArchitecture(nodes, edges) : null, [edges, interviewDef, nodes]);
  // In an interview, practice runs use the problem's benchmark (with its forced settings) on the canvas.
  const input = useMemo(() => challenge ? benchmarkInput(challenge, toArchitecture(nodes, edges)) : interviewDef && interviewSnapshot ? interviewBenchmarkInput(interviewDef, interviewSnapshot) : labSnapshot ? labInput(labSnapshot, labCtl.lab.benchmark) : simulationInput(nodes, edges, traffic, duration * 1000), [challenge, interviewDef, interviewSnapshot, labSnapshot, labCtl.lab.benchmark, nodes, edges, traffic, duration]);
  const inputKey = useMemo(() => simulationKey(input), [input]);
  const labels = useMemo(() => Object.fromEntries(nodes.map(node => [node.id, node.data.label || byKind[node.data.kind].label])), [nodes]);
  // Recomputed on every change to components, connections or configuration.
  const validation = useMemo(() => validateArchitecture(input, labels), [input, labels]);
  const issueSignature = useMemo(() => JSON.stringify(validation.issues.map(issue => [issue.code, issue.nodeId, issue.edge?.source, issue.edge?.target])), [validation]);
  const jobsByParent = useMemo(() => {
    const map = new Map<number, RequestRecord[]>();
    for (const job of run?.result.jobs ?? []) map.set(job.parentId ?? -1, [...(map.get(job.parentId ?? -1) ?? []), job]);
    return map;
  }, [run]);

  // Playback loop: advances the existing SimulationClock from wall time; never re-runs the engine.
  useEffect(() => {
    if (!playing) return;
    let frame = 0; let last = performance.now();
    const step = (now: number) => {
      const current = clock.current; if (!current) return;
      const time = current.tick(Math.min(100, now - last)); last = now; store.set(time);
      if (!current.running) { setPlaying(false); setAtEnd(time >= current.durationMs); return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, store]);

  const { state: runner, run: startRun, dismiss } = useSimulationRunner(response => {
    const started = pending.current ?? { key: inputKey, input, challengeId: challenge?.id, validation: { counts: validation.counts, issues: validation.issues } };
    playRun({ result: response.result, index: response.index, key: started.key, input: started.input, challengeId: started.challengeId, validation: started.validation });
  });
  /** Loads a run into playback and starts it. Used for practice runs, and for a benchmark run only when the user asks. */
  const playRun = useCallback((next: Run) => {
    setRun(next); setSelectedRequest(null);
    clock.current = new SimulationClock(next.result.durationMs, speedRef.current); clock.current.run();
    store.set(0); setAtEnd(false); setPlaying(true);
  }, [store]);

  // Submissions run on their own runner and worker. The graded run is stored with the result and does not
  // replace the interactive run, its playback, or the visible metrics.
  const { state: gradeState, run: runBenchmark, dismiss: dismissGradeError } = useSimulationRunner(response => {
    const started = grading.current; grading.current = null;
    const target = started ? challengeById(started.challengeId) : undefined; if (!started || !target) return;
    const outcome = gradeSubmission(target, started, response.result, progressRef.current);
    const at = Date.now(); const snapshot = started.snapshot;
    // The record is built from what was captured at Submit time: snapshot, benchmark input and criteria.
    setProgress(current => recordAttempt(current, outcome.grade, at, snapshot ? number => buildAttemptRecord(target, snapshot, started.input, outcome.grade, number, at) : undefined));
    setGradeView({ ...outcome, challengeId: target.id, benchmark: { result: response.result, index: response.index, input: started.input, challengeId: target.id, validation: started.validation } });
    setResultsOpen(true);
  });

  const startSimulation = useCallback(() => {
    pending.current = { key: inputKey, input, challengeId: challenge?.id, validation: { counts: validation.counts, issues: validation.issues } };
    setReview(false); setPlaying(false); clock.current?.pause(); startRun(input);
  }, [challenge, input, inputKey, startRun, validation]);
  /** Submissions always run the benchmark and are graded; validation issues are part of the grade instead of a prompt. */
  const submitSolution = useCallback(() => {
    if (!challenge) return;
    grading.current = prepareSubmission(challenge, toArchitecture(nodes, edges), benchmark => validateArchitecture(benchmark, labels), snapshotArchitecture(nodes, edges));
    runBenchmark(grading.current.input);
  }, [challenge, edges, labels, nodes, runBenchmark]);
  /** Architecture issues are surfaced before running; the user decides whether to run with them. */
  const runSimulation = useCallback(() => {
    if (validation.issues.length && acknowledged.current !== issueSignature) { setReview(true); return; }
    startSimulation();
  }, [issueSignature, startSimulation, validation.issues.length]);
  const runAnyway = useCallback(() => { acknowledged.current = issueSignature; startSimulation(); }, [issueSignature, startSimulation]);
  const runPractice = useCallback(() => runSimulation(), [runSimulation]);
  const playPause = useCallback(() => {
    const current = clock.current; if (!current) return;
    if (current.running) { current.pause(); setPlaying(false); return; }
    if (current.elapsedMs >= current.durationMs) { current.reset(); store.set(0); }
    current.run(); setAtEnd(false); setPlaying(current.running);
  }, [store]);
  const reset = useCallback(() => { clock.current?.reset(); clock.current = null; setPlaying(false); setAtEnd(false); setRun(null); setSelectedRequest(null); store.set(0); }, [store]);
  const seek = useCallback((time: number) => {
    const current = clock.current; if (!current) return;
    current.elapsedMs = Math.max(0, Math.min(current.durationMs, time)); store.set(current.elapsedMs); setAtEnd(current.elapsedMs >= current.durationMs);
    if (current.elapsedMs >= current.durationMs) { current.pause(); setPlaying(false); }
  }, [store]);
  const changeSpeed = useCallback((next: number) => {
    setSpeed(next); const current = clock.current; if (!current) return;
    // SimulationClock's speed is fixed per instance, so carry the playhead into a new clock.
    const replacement = new SimulationClock(current.durationMs, next); replacement.elapsedMs = current.elapsedMs; if (current.running) replacement.run(); clock.current = replacement;
  }, []);

  const addNode = useCallback((kind: Kind, position?: { x: number; y: number }) => {
    const item = byKind[kind]; const id = `${kind}-${Date.now().toString(36)}`;
    let at = position;
    if (!at) {
      const bounds = document.querySelector('.fz-canvas')?.getBoundingClientRect();
      const center = bounds ? flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }) : { x: 0, y: 0 };
      const offset = (nodes.length % 5) * 24; at = { x: center.x - NODE_WIDTH / 2 + offset, y: center.y - 34 + offset };
    }
    const created: FlowNode = { id, type: 'architecture', position: at!, selected: true, data: { label: item.label, kind, config: { ...item.defaults } } };
    setNodes(current => [...current.map(node => node.selected ? { ...node, selected: false } : node), challenge ? withLocks(challenge, created) : created]);
    setEdges(current => current.map(edge => edge.selected ? { ...edge, selected: false } : edge));
    setSelectedRequest(null);
  }, [challenge, flow, nodes.length, setEdges, setNodes]);
  const updateNode = useCallback((id: string, patch: Partial<ComponentData>) => setNodes(current => current.map(node => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)), [setNodes]);
  // Given systems in a challenge cannot be deleted.
  const deleteNode = useCallback((id: string) => { if (nodes.find(node => node.id === id)?.data.fixture) return; setNodes(current => current.filter(node => node.id !== id)); setEdges(current => current.filter(edge => edge.source !== id && edge.target !== id)); }, [nodes, setEdges, setNodes]);
  const deleteEdge = useCallback((id: string) => setEdges(current => current.filter(edge => edge.id !== id)), [setEdges]);
  const selectNode = useCallback((id: string) => { setNodes(current => current.map(node => ({ ...node, selected: node.id === id }))); setEdges(current => current.map(edge => edge.selected ? { ...edge, selected: false } : edge)); setSelectedRequest(null); setInspectorOpen(true); panel({ type: 'select', changed: true, hasTarget: true }); }, [panel, setEdges, setNodes]);
  /** Applies a validation fix. Only called from an explicit, confirmed user action. */
  const applyFix = useCallback((fix: Fix) => {
    history.mark(fix.label);
    if (fix.type === 'remove-edge') setEdges(current => current.filter(edge => !(edge.source === fix.source && edge.target === fix.target)));
    else if (fix.type === 'remove-node') deleteNode(fix.nodeId);
    else if (fix.type === 'set-config') setNodes(current => current.map(node => node.id === fix.nodeId ? { ...node, data: { ...node.data, config: { ...node.data.config, [fix.key]: fix.value } } } : node));
    else {
      const source = nodes.find(node => node.id === fix.nodeId); if (!source) return;
      const item = byKind[fix.kind]; const id = `${fix.kind}-${Date.now().toString(36)}`;
      const created: FlowNode = { id, type: 'architecture', position: { x: source.position.x + 286, y: source.position.y + 40 }, selected: true, data: { label: item.label, kind: fix.kind, config: { ...item.defaults } } };
      setNodes(current => [...current.map(node => node.selected ? { ...node, selected: false } : node), challenge ? withLocks(challenge, created) : created]);
      setEdges(current => [...current, { id: `${fix.nodeId}-${id}`, source: fix.nodeId, target: id, type: 'flow' }]);
    }
  }, [challenge, deleteNode, history, nodes, setEdges, setNodes]);
  const validationContext = useMemo<ValidationContextValue>(() => ({ validation, showIssues, applyFix, selectNode }), [validation, showIssues, applyFix, selectNode]);
  const onConnect = useCallback((connection: Connection) => setEdges(current => addEdge({ ...connection, type: 'flow' }, current)), [setEdges]);
  const selectEdge = useCallback((id: string) => {
    setNodes(current => current.map(node => node.selected ? { ...node, selected: false } : node));
    setEdges(current => current.map(edge => edge.selected === (edge.id === id) ? edge : { ...edge, selected: edge.id === id }));
  }, [setEdges, setNodes]);
  /** Dragging an arrow's end: onto another handle moves the connection; anywhere else detaches it. One undoable edit either way. */
  const onReconnectEdge = useCallback((edge: FlowEdge, connection: Connection | null) => {
    const result = reconnectEdge(edges, edge, connection); if (result.change === 'unchanged') return;
    const name = (id: string) => nodes.find(node => node.id === id)?.data.label ?? id;
    history.mark(result.change === 'detached' ? `Disconnect ${name(edge.source)} → ${name(edge.target)}` : `Move connection ${name(edge.source)} → ${name(edge.target)} to ${name(connection!.source)} → ${name(connection!.target)}`);
    setEdges(result.edges);
  }, [edges, history, nodes, setEdges]);
  const onSelectionChange = useCallback<OnSelectionChangeFunc>(({ nodes: selectedNodes, edges: selectedEdges }) => {
    const next = { node: selectedNodes[0]?.id, edge: selectedNodes.length ? undefined : selectedEdges[0]?.id };
    // React Flow also reports an unchanged selection when nodes are replaced (e.g. by undo); only real changes count.
    const previous = selectionRef.current;
    if (previous.node === next.node && previous.edge === next.edge) return;
    selectionRef.current = next; setSelection(next);
    // The inspector is contextual: selecting something opens it.
    if (next.node || next.edge) { setSelectedRequest(null); setInspectorOpen(true); }
    panel({ type: 'select', changed: true, hasTarget: Boolean(next.node || next.edge) });
  }, [panel]);
  const loadSample = useCallback(() => { history.mark('Load sample architecture'); reset(); setNodes(sampleNodes()); setEdges(sampleEdges()); window.requestAnimationFrame(() => flow.fitView({ padding: 0.18, duration: 240 })); }, [flow, history, reset, setEdges, setNodes]);
  const clearCanvas = useCallback(() => { history.mark('Clear canvas'); reset(); setNodes([]); setEdges([]); }, [history, reset, setEdges, setNodes]);
  const selectRequest = useCallback((id: number | null) => { setSelectedRequest(id); if (id !== null) { setInspectorOpen(true); panel({ type: 'open-request' }); } }, [panel]);

  // ── Challenge mode ────────────────────────────────────────────────────────────────
  const fit = useCallback(() => window.requestAnimationFrame(() => flow.fitView({ padding: 0.2, duration: 240, maxZoom: 1 })), [flow]);
  const loadArchitecture = useCallback((next: { nodes: FlowNode[]; edges: typeof edges }) => { reset(); setSelection({}); setNodes(next.nodes); setEdges(next.edges); fit(); }, [fit, reset, setEdges, setNodes]);
  const openChallenge = useCallback((id: string) => {
    const target = challengeById(id); if (!target) return;
    if (page.name === 'design') designStash.current = { nodes, edges };
    const draft = progress.drafts[id];
    const next = draft ? {
      nodes: draft.nodes.map(entry => withLocks(target, { id: entry.id, type: 'architecture', position: entry.position, data: { label: entry.label, kind: entry.kind as FlowNode['data']['kind'], config: entry.config } })),
      edges: draft.edges.map(edge => ({ id: `${edge.source}-${edge.target}`, source: edge.source, target: edge.target, type: 'flow' })),
    } : starterArchitecture(target);
    // Each challenge has its own edit history, separate from the design canvas and from submitted attempts.
    history.switchTo(`challenge:${id}`, next); loadArchitecture(next);
    setPage({ name: 'challenge', id }); panel({ type: 'open-challenge' }); setInspectorOpen(true); setShowIssues(false);
  }, [edges, history, loadArchitecture, nodes, page.name, panel, progress.drafts]);
  // Leaving a challenge saves its draft immediately, so edits made within the autosave delay are never lost.
  const { edit: editInterview } = interviews;
  const flushDraft = useCallback(() => {
    if (challenge) setProgress(current => saveDraft(current, challenge.id, draftOf(nodes, edges)));
    // Leaving the interview canvas saves its architecture into the session immediately.
    if (page.name === 'interview-design') { const architecture = snapshotArchitecture(nodes, edges); editInterview(page.sessionId, current => JSON.stringify(current.architecture) === JSON.stringify(architecture) ? current : updateSession(current, { architecture }, Date.now())); }
  }, [challenge, editInterview, edges, nodes, page]);
  // Leaving the lab saves its experiment draft immediately, like a challenge draft.
  const flushLab = useCallback(() => { if (page.name === 'lab') labCtl.setDraft(snapshotArchitecture(nodes, edges)); }, [edges, labCtl, nodes, page.name]);
  const showChallenges = useCallback(() => { flushDraft(); flushLab(); if (page.name === 'design') designStash.current = { nodes, edges }; setPage({ name: 'challenges' }); }, [edges, flushDraft, flushLab, nodes, page.name]);
  /** The Interview section. Drafts are autosaved; leaving the canvas saves the interview architecture. */
  const showInterview = useCallback((next?: InterviewView) => {
    flushDraft(); flushLab(); if (page.name === 'design') designStash.current = { nodes, edges };
    if (next) setInterviewView(next); setPage({ name: 'interview' });
  }, [edges, flushDraft, flushLab, nodes, page.name]);
  /** Opens an interview's architecture on the canvas, with its own edit history. Nothing is pre-built except a client. */
  const openInterviewCanvas = useCallback((sessionId: string, definition: InterviewDefinition) => {
    const session = interviews.state.drafts.find(draft => draft.id === sessionId); if (!session) return;
    setOpenDefinition(definition);
    flushDraft(); flushLab(); if (page.name === 'design') designStash.current = { nodes, edges };
    const next = session.architecture?.nodes.length ? fromSnapshot(session.architecture) : { nodes: [{ id: 'users', type: 'architecture' as const, position: { x: 0, y: 120 }, data: { label: 'Users', kind: 'client' as const, config: { ...byKind.client.defaults } } }], edges: [] };
    history.switchTo(`interview:${sessionId}`, next); loadArchitecture(next);
    setPage({ name: 'interview-design', sessionId }); panel({ type: 'open-challenge' }); setInspectorOpen(true); setShowIssues(false);
  }, [edges, flushDraft, flushLab, history, interviews.state.drafts, loadArchitecture, nodes, page.name, panel]);
  /** Leaving for Learn keeps every draft: the challenge draft and lab draft are saved, the design canvas is stashed. */
  const showLearn = useCallback((next?: LearnView) => {
    flushDraft(); flushLab(); if (page.name === 'design') designStash.current = { nodes, edges };
    if (next) setLearnView(next); setPage({ name: 'learn' });
  }, [edges, flushDraft, flushLab, nodes, page.name]);
  const showLab = useCallback(() => {
    if (page.name === 'lab') return;
    flushDraft();
    if (page.name === 'design') designStash.current = { nodes, edges };
    const draft = labCtl.lab.draft;
    const next = draft ? fromSnapshot(draft) : designStash.current ?? { nodes: sampleNodes(), edges: sampleEdges() };
    // The lab has its own edit history, separate from the design canvas and every challenge.
    history.switchTo('lab', next); loadArchitecture(next);
    setPage({ name: 'lab' }); panel({ type: 'open-challenge' }); setInspectorOpen(true); setShowIssues(false); lastPlayground.current = 'lab';
  }, [edges, flushDraft, history, labCtl.lab.draft, loadArchitecture, nodes, page.name, panel]);
  const showDesign = useCallback(() => {
    flushDraft(); flushLab();
    if (page.name !== 'design') { const next = designStash.current ?? { nodes: sampleNodes(), edges: sampleEdges() }; history.switchTo('design', next); loadArchitecture(next); }
    setPage({ name: 'design' }); setInspectorOpen(false); lastPlayground.current = 'design';
  }, [flushDraft, flushLab, history, loadArchitecture, page.name]);
  const navigate = useCallback((target: NavTarget) => {
    const resolved = target === 'playground' ? lastPlayground.current : target;
    if (resolved === 'design') showDesign(); else if (resolved === 'lab') showLab(); else if (resolved === 'learn') showLearn(); else if (resolved === 'interview') showInterview(page.name === 'interview-design' ? { type: 'session', id: page.sessionId } : undefined); else showChallenges();
  }, [page, showChallenges, showDesign, showInterview, showLab, showLearn]);
  /** From a lesson: open the Playground's Guided tab on an experiment. */
  const openExperiment = useCallback((id: string) => { showLab(); setLabFocus({ tab: 'guided', experimentId: id, nonce: Date.now() }); panel({ type: 'tab', tab: 'challenge' }); setInspectorOpen(true); }, [panel, showLab]);
  /** From a lesson: load a build exercise's starting design into the Playground (one undoable edit) and show its checks. */
  const openBuild = useCallback((lessonId: string, task: BuildTask) => {
    const draft = labCtl.lab.draft;
    if (draft && draft.nodes.length && !window.confirm('Load this exercise’s starting design into the Playground?\n\nIt replaces the current Playground canvas; Undo restores it. Your baseline and saved variants are not affected.')) return;
    showLab();
    history.mark(`Load exercise: ${lessonById(lessonId)?.title ?? lessonId}`);
    loadArchitecture(fromSnapshot(taskArchitecture(task.starter, task.starterEdges, kind => byKind[kind].defaults)));
    setLabFocus({ tab: 'guided', exercise: { lessonId, taskId: task.id }, nonce: Date.now() }); panel({ type: 'tab', tab: 'challenge' }); setInspectorOpen(true);
  }, [history, labCtl.lab.draft, loadArchitecture, panel, showLab]);
  const openLesson = useCallback((id: string, section: 'concept' | 'exercise' | 'experiment' = 'concept') => showLearn({ type: 'lesson', id, section }), [showLearn]);
  const learnComponent = useCallback((kind: Kind) => showLearn({ type: 'component', kind }), [showLearn]);
  /** Footer links on catalog pages: every one navigates within Flowzen. */
  const footerNavigate = useCallback((target: FooterTarget) => {
    if (target === 'learn') showLearn({ type: 'dashboard' }); else if (target === 'guides') showLearn({ type: 'components' });
    else if (target === 'playground') navigate('playground'); else if (target === 'interview') showInterview({ type: 'dashboard' }); else showChallenges();
  }, [navigate, showChallenges, showInterview, showLearn]);
  /** Interview resources link into Learn, the Playground and other interviews; drafts are kept. */
  const openResource = useCallback((resource: Resource) => {
    if (resource.type === 'lesson') showLearn({ type: 'lesson', id: resource.id, section: 'concept' });
    else if (resource.type === 'component') showLearn({ type: 'component', kind: resource.kind });
    else if (resource.type === 'lld') showLearn({ type: 'component', kind: resource.kind, tab: 'lld' });
    else if (resource.type === 'experiment') openExperiment(resource.id);
    else showInterview({ type: 'problem', id: resource.id });
  }, [openExperiment, showInterview, showLearn]);
  // Restoring the starter is an undoable edit; it never touches recorded attempts.
  const restoreStarter = useCallback(() => {
    if (!challenge || !window.confirm('Replace your architecture with the starter architecture? You can undo this with Undo.')) return;
    history.mark('Restore starter architecture'); loadArchitecture(starterArchitecture(challenge));
  }, [challenge, history, loadArchitecture]);
  // Challenge designs are saved as drafts so leaving and returning (or reloading) keeps the work.
  useEffect(() => {
    if (!challenge) return;
    const timer = window.setTimeout(() => setProgress(current => saveDraft(current, challenge.id, draftOf(nodes, edges))), 400);
    return () => window.clearTimeout(timer);
  }, [challenge, nodes, edges]);
  const locksFor = useCallback((node: FlowNode) => challenge ? lockedConfig(challenge, { id: node.id, kind: node.data.kind }) : {}, [challenge]);
  const preview = useMemo(() => challenge && run?.challengeId === challenge.id ? grade(challenge, run.input, run.result, run.validation) : null, [challenge, run]);

  // Undo/redo shortcuts. Text fields keep the browser's own undo; dialogs and the challenge list disable them.
  // Results belong to the challenge they were graded for; switching challenges never shows another one's result.
  const currentGrade = challenge && gradeView?.challengeId === challenge.id ? gradeView : null;
  const shortcutsEnabled = page.name !== 'challenges' && !review && !(resultsOpen && currentGrade) && !attemptsView;
  const challengeHistory = challenge ? progress.challenges[challenge.id]?.history ?? [] : [];
  /** Opens the comparison of the two most recent attempts that have readable snapshots. */
  const compareLatest = useCallback(() => {
    const numbers = challengeHistory.map(entry => parseAttemptRecord(entry.record)).flatMap(parsed => parsed.status === 'ok' ? [parsed.record.number] : []);
    if (numbers.length >= 2) setAttemptsView({ mode: 'compare', a: numbers[numbers.length - 2], b: numbers[numbers.length - 1] });
  }, [challengeHistory]);
  /** Loads a historical snapshot as a new editable draft. The record is copied, never modified; Undo restores the previous draft. */
  const loadAttemptDraft = useCallback((record: AttemptRecord) => {
    if (!challenge || record.challengeId !== challenge.id) return;
    const draft = snapshotToDraft(record.architecture);
    history.mark(`Load attempt #${record.number} as draft`);
    loadArchitecture({
      nodes: draft.nodes.map(entry => withLocks(challenge, { id: entry.id, type: 'architecture', position: entry.position, data: { label: entry.label, kind: entry.kind, config: entry.config } })),
      edges: draft.edges.map(edge => ({ id: `${edge.source}-${edge.target}`, source: edge.source, target: edge.target, type: 'flow' })),
    });
    setAttemptsView(null);
  }, [challenge, history, loadArchitecture]);
  const matchesCurrent = useCallback((snapshot: ArchitectureSnapshot) => JSON.stringify(snapshotArchitecture(nodes, edges)) === JSON.stringify(snapshot), [edges, nodes]);
  const kindsOnCanvas = useMemo(() => new Set(nodes.map(node => node.data.kind)), [nodes]);

  // Interview canvas: autosaved into the session draft (positions included), separately from every other workspace.
  useEffect(() => {
    if (!interviewSnapshot || page.name !== 'interview-design') return;
    const id = page.sessionId;
    const timer = window.setTimeout(() => editInterview(id, current => JSON.stringify(current.architecture) === JSON.stringify(interviewSnapshot) ? current : updateSession(current, { architecture: interviewSnapshot }, Date.now())), 400);
    return () => window.clearTimeout(timer);
  }, [editInterview, interviewSnapshot, page]);

  // ── Scaling Laboratory ──────────────────────────────────────────────────────────
  // The lab canvas is the editable experiment; it is saved as the lab draft (never as the baseline or a variant).
  const { setDraft: setLabDraft } = labCtl;
  useEffect(() => {
    if (!labSnapshot) return;
    const timer = window.setTimeout(() => setLabDraft(labSnapshot), 400);
    return () => window.clearTimeout(timer);
  }, [labSnapshot, setLabDraft]);
  const setLabConfig = useCallback((id: string, key: string, value: string) => {
    const node = nodes.find(entry => entry.id === id); if (node) updateNode(id, { config: { ...node.data.config, [key]: value } });
  }, [nodes, updateNode]);
  const applyLabEdit = useCallback((label: string, next: { nodes: FlowNode[]; edges: FlowEdge[] } | null) => {
    if (!next) return; history.mark(label); setNodes(next.nodes); setEdges(next.edges);
  }, [history, setEdges, setNodes]);
  const labAddReplica = useCallback((id: string) => applyLabEdit(`Add replica of ${labels[id]}`, addReplica(nodes, edges, id, `${nodes.find(node => node.id === id)?.data.kind ?? 'node'}-${Date.now().toString(36)}`)), [applyLabEdit, edges, labels, nodes]);
  const labInsertCache = useCallback((id: string) => applyLabEdit(`Insert cache before ${labels[id]}`, insertCacheBefore(nodes, edges, id, `cache-${Date.now().toString(36)}`)), [applyLabEdit, edges, labels, nodes]);
  const labLoad = useCallback((snapshot: ArchitectureSnapshot, label: string) => { history.mark(`Load ${label}`); loadArchitecture(fromSnapshot(snapshot)); }, [history, loadArchitecture]);
  /**
   * "Try alternative" in the Playground: the current design is saved as a variant first, then one component is
   * swapped as a single undoable edit. If the variant cannot be saved, nothing changes.
   */
  const tryAlternative = useCallback((id: string, kind: Kind) => {
    const node = nodes.find(entry => entry.id === id); const swapped = swapComponent(nodes, edges, id, kind);
    if (!node || !swapped) return;
    const base = `Before ${byKind[kind].label} for ${node.data.label || byKind[node.data.kind].label}`.slice(0, 52);
    let name = base; for (let i = 2; labCtl.lab.variants.some(variant => variant.name.toLowerCase() === name.toLowerCase()); i++) name = `${base} (${i})`;
    if (!window.confirm(`Try ${byKind[kind].label} instead of ${node.data.label}?\n\nYour current design is saved first as the variant “${name}”. The swap is one undoable edit; nothing else changes.`)) return;
    if (!labCtl.saveAsVariant(name, snapshotArchitecture(nodes, edges))) { window.alert('The current design could not be saved as a variant (the limit may have been reached), so nothing was changed. Delete a variant in the Lab tab and try again.'); return; }
    history.mark(`Try ${byKind[kind].label} instead of ${node.data.label}`); setNodes(swapped.nodes); setEdges(swapped.edges);
  }, [edges, history, labCtl, nodes, setEdges, setNodes]);
  /** Designs the lab can start from: copies only, so the originals never change. */
  const labSources = useMemo(() => {
    if (!isLab) return null;
    const design = designStash.current ? snapshotArchitecture(designStash.current.nodes, designStash.current.edges) : null;
    const challengeDrafts = Object.entries(progress.drafts).flatMap(([id, draft]) => {
      const snapshot = { schema: 'flowzen.architecture' as const, version: 1 as const, nodes: draft.nodes as ArchitectureSnapshot['nodes'], edges: draft.edges };
      const entry = challengeById(id);
      return entry && !validateArchitectureSnapshot(snapshot) ? [{ id, title: entry.title, snapshot }] : [];
    });
    return { sample: snapshotArchitecture(sampleNodes(), sampleEdges()), design, challengeDrafts };
  }, [isLab, progress.drafts]);
  useEffect(() => {
    if (!shortcutsEnabled) return;
    const platform = isMacPlatform() ? 'mac' : 'other';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target as HTMLElement | null)) return;
      const command = historyShortcut(event, platform); if (!command) return;
      event.preventDefault(); if (command === 'undo') history.undo(); else history.redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [history, shortcutsEnabled]);

  const context = useMemo<PlaybackContextValue>(() => ({
    store, result: run?.result ?? null, index: run?.index ?? null, runValidation: run?.validation ?? null, labels, view, reducedMotion, selectedRequest, selectRequest,
    travelWindowMs: TRAVEL_WALL_MS * speed, failureWindowMs: FAILURE_WALL_MS * speed,
  }), [store, run, labels, view, reducedMotion, selectedRequest, selectRequest, speed]);

  // Switching views keeps the selection. LLD opens the selected component's design; HLD returns to its role.
  const changeView = useCallback((next: ViewMode) => {
    setView(next);
    // A view change never moves the right panel off the challenge brief (see rightPanel.ts).
    if (next === 'LLD') { setNodeTab('lld'); setInspectorOpen(true); if (selection.node) setSelectedRequest(null); }
    if (next === 'HLD') setNodeTab('component');
    panel({ type: 'view-change' });
  }, [panel, selection.node]);
  /** From the brief's "related designs": select a component of that kind and open its low-level design. */
  const openDesign = useCallback((kind: Kind) => {
    const target = nodes.find(node => node.data.kind === kind); if (!target) return;
    selectNode(target.id); changeView('LLD');
  }, [changeView, nodes, selectNode]);
  const openLld = useCallback(() => changeView('LLD'), [changeView]);

  const selectedNode = nodes.find(node => node.id === selection.node);
  const selectedEdge = edges.find(edge => edge.id === selection.edge);
  const stale = run !== null && run.key !== inputKey;

  const toolbarTraffic = challenge ? challenge.workload.rps : interviewDef ? interviewDef.benchmark.rps : isLab ? labCtl.lab.benchmark.rps : traffic;
  const toolbarDuration = challenge ? challenge.workload.durationMs / 1000 : interviewDef ? (interviewDef.benchmark.durationMs + interviewDef.benchmark.drainMs) / 1000 : isLab ? (labCtl.lab.benchmark.durationMs + labCtl.lab.benchmark.drainMs) / 1000 : duration;
  /** Challenges and the lab show a brief/lab tab beside the inspector. */
  const hasBrief = challenge !== null || isLab || interviewDef !== null;
  const showingNode = inspectorOpen && selectedNode !== undefined && selectedRequest === null && !(hasBrief && rightTab === 'challenge');
  const wideInspector = (showingNode && view !== 'HLD' && nodeTab === 'lld') || (isLab && inspectorOpen && rightTab === 'challenge');
  if (page.name === 'challenges' || page.name === 'learn' || page.name === 'interview') return <div className="fz-app is-page">
    <Toolbar page={page.name} onNavigate={navigate} projectName={projectName} onProjectName={setProjectName} view={view} onView={setView} theme={theme} onToggleTheme={toggleTheme}
      traffic={traffic} onTraffic={setTraffic} duration={duration} onDuration={setDuration} speed={speed} onSpeed={changeSpeed} workloadLocked={false}
      computing={false} hasResult={false} playing={false} atEnd={false} canRun={false} onRun={() => undefined} onPlayPause={() => undefined} onReset={() => undefined}
      libraryOpen={libraryOpen} onToggleLibrary={() => undefined} inspectorOpen={inspectorOpen} onToggleInspector={() => undefined} />
    {page.name === 'interview'
      ? <Suspense fallback={<div className="fz-page fz-bottom__empty"><span>Loading interviews…</span></div>}><InterviewPage ctl={interviews} view={interviewView} onView={setInterviewView} onOpenCanvas={openInterviewCanvas} onResource={openResource} onFooter={footerNavigate} /></Suspense>
      : page.name === 'learn'
      ? <Suspense fallback={<div className="fz-page fz-bottom__empty"><span>Loading lessons…</span></div>}><LearnPage learn={learn} view={learnView} onView={setLearnView} challengeProgress={progress}
        onOpenExperiment={openExperiment} onOpenBuild={openBuild} onOpenChallenge={openChallenge} onOpenChallenges={showChallenges} onOpenPlayground={() => navigate('playground')} onOpenInterviews={() => showInterview({ type: 'dashboard' })} onFooter={footerNavigate} /></Suspense>
      : <Suspense fallback={<div className="fz-page fz-bottom__empty"><span>Loading challenges…</span></div>}><ChallengesPage progress={progress} onOpen={openChallenge} onClose={() => showLearn()} onOpenLab={showLab} onOpenLearn={() => showLearn({ type: 'dashboard' })} onOpenInterview={() => showInterview({ type: 'dashboard' })} onFooter={footerNavigate} /></Suspense>}
  </div>;

  return <PlaybackContext.Provider value={context}><ValidationContext.Provider value={validationContext}>
    <div className={`fz-app${libraryOpen ? '' : ' no-library'}${inspectorOpen ? '' : ' no-inspector'}${bottomOpen ? '' : ' no-bottom'}${wideInspector ? ' has-wide-inspector' : ''}`}>
      <Toolbar page={challenge ? 'challenge' : isLab ? 'lab' : interviewDef ? 'interview-design' : 'design'} challengeTitle={challenge?.title ?? (interviewDef ? `Interview: ${interviewDef.title}` : undefined)} onNavigate={navigate}
        projectName={projectName} onProjectName={setProjectName} view={view} onView={changeView} theme={theme} onToggleTheme={toggleTheme}
        traffic={toolbarTraffic} onTraffic={setTraffic} duration={toolbarDuration} onDuration={setDuration} speed={speed} onSpeed={changeSpeed} workloadLocked={hasBrief}
        computing={runner.status === 'running'} hasResult={run !== null} playing={playing} atEnd={atEnd} canRun={nodes.length > 0}
        onRun={runPractice} onPlayPause={playPause} onReset={reset} history={history}
        libraryOpen={libraryOpen} onToggleLibrary={() => setLibraryOpen(open => !open)} inspectorOpen={inspectorOpen} onToggleInspector={() => setInspectorOpen(open => !open)} />
      {libraryOpen && <Library onAdd={addNode} onLearn={learnComponent} />}
      <main className="fz-main">
        <Canvas nodes={nodes} edges={edges} theme={theme} view={view} hasResult={run !== null} stale={stale} minimap={minimap}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onSelectionChange={onSelectionChange}
          onDropKind={addNode} onLoadSample={loadSample} onRun={runPractice} onToggleMinimap={() => setMinimap(open => !open)} onClear={clearCanvas}
          challengeMode={challenge !== null} onRestoreStarter={restoreStarter} onReconnectEdge={onReconnectEdge} onSelectEdge={selectEdge}
          showIssues={showIssues} onToggleIssues={() => { setShowIssues(on => !on); setInspectorOpen(true); }} />
      </main>
      {inspectorOpen && <aside className="fz-panel fz-inspector" aria-label={challenge ? 'Challenge and inspector' : isLab ? 'Laboratory and inspector' : interviewDef ? 'Interview and inspector' : 'Inspector'}>
        {hasBrief && <div className="fz-tabs fz-rtabs" role="tablist" aria-label="Right panel">
          <button role="tab" aria-selected={rightTab === 'challenge'} className={rightTab === 'challenge' ? 'is-on' : ''} onClick={() => panel({ type: 'tab', tab: 'challenge' })}>{isLab ? 'Lab' : interviewDef ? 'Interview' : 'Challenge'}</button>
          <button role="tab" aria-selected={rightTab === 'inspector'} className={rightTab === 'inspector' ? 'is-on' : ''} onClick={() => panel({ type: 'tab', tab: 'inspector' })}>Inspector</button>
        </div>}
        {challenge && rightTab === 'inspector' && <ChallengeStrip challenge={challenge} preview={preview} previewStale={stale} grading={gradeState.status === 'running'} onOpenBrief={() => panel({ type: 'tab', tab: 'challenge' })} />}
        {isLab && rightTab === 'inspector' && <div className="fz-cstrip" role="region" aria-label="Scaling Laboratory">
          <span className="fz-cstrip__title">Scaling Laboratory</span><span className="fz-cstrip__state">{labCtl.runner.status === 'running' ? `${labCtl.runner.label}…` : labCtl.lab.baseline ? 'Baseline set' : 'No baseline yet'}</span>
          <button className="fz-btn fz-btn--small" onClick={() => panel({ type: 'tab', tab: 'challenge' })}>Lab</button></div>}
        {interviewDef && interviewSession && rightTab === 'inspector' && <div className="fz-cstrip" role="region" aria-label="Current interview">
          <span className="fz-cstrip__title">{interviewDef.title}</span><span className="fz-cstrip__state">{interviewSession.mode} interview</span>
          <button className="fz-btn fz-btn--small" onClick={() => panel({ type: 'tab', tab: 'challenge' })}>Interview</button></div>}
        {interviewDef && interviewSession && rightTab === 'challenge'
          ? <Suspense fallback={<div className="fz-inspector__body"><p className="fz-empty-note">Loading…</p></div>}><InterviewBrief definition={interviewDef} session={interviewSession} ctl={interviews} nodes={nodes} selectedId={selection.node}
            onBack={() => showInterview({ type: 'session', id: interviewSession.id })} onSelect={selectNode} /></Suspense>
          : isLab && rightTab === 'challenge' && labSnapshot && labSources
          ? <Suspense fallback={<div className="fz-inspector__body"><p className="fz-empty-note">Loading the laboratory…</p></div>}><LabPanel lab={labCtl} theme={theme} snapshot={labSnapshot} labels={labels} nodes={nodes} edges={edges}
            onSetConfig={setLabConfig} onAddReplica={labAddReplica} onInsertCache={labInsertCache} onLoad={labLoad} sources={labSources}
            learn={learn} focus={labFocus} onOpenLesson={openLesson} /></Suspense>
          : challenge && rightTab === 'challenge'
          ? <ChallengePanel key={challenge.id} challenge={challenge} entry={progress.challenges[challenge.id]} preview={preview} previewStale={stale}
            grading={gradeState.status === 'running'} gradingError={gradeState.status === 'error' ? gradeState.message : null} onDismissError={dismissGradeError}
            onSubmit={submitSolution} hasResult={currentGrade !== null} onShowResult={() => setResultsOpen(true)} onBack={showChallenges}
            kindsOnCanvas={kindsOnCanvas} onOpenDesign={openDesign} onReviewAttempt={number => setAttemptsView({ mode: 'review', number })} onCompareAttempts={compareLatest}
            lessons={lessonsForChallenge(challenge.id).map(lesson => ({ id: lesson.id, title: lesson.title, status: lessonStatus(learn.state, lesson) }))} onOpenLesson={id => openLesson(id)} />
          : selectedRequest !== null && run
          ? <RequestInspector id={selectedRequest} labels={labels} jobs={jobsByParent.get(selectedRequest) ?? []} onSeek={seek} onClose={() => setSelectedRequest(null)} />
          : <Inspector nodes={nodes} edges={edges} selectedNode={selectedNode} selectedEdge={selectedEdge} labels={labels} locksFor={locksFor}
            onUpdateNode={updateNode} onDeleteNode={deleteNode} onDeleteEdge={deleteEdge}
            view={view} nodeTab={nodeTab} onNodeTab={setNodeTab} onOpenLld={openLld} onLearn={learnComponent} onTryAlternative={isLab ? tryAlternative : undefined} />}
      </aside>}
      <BottomPanel open={bottomOpen} onToggle={() => setBottomOpen(open => !open)} tab={bottomTab} onTab={setBottomTab} theme={theme} labels={labels}
        durationMs={duration * 1000} onSeek={seek} error={runner.status === 'error' ? runner.message : null} onDismissError={dismiss} />
      {review && <PreRunReview validation={validation} labels={labels} onRun={runAnyway} onCancel={() => setReview(false)}
        onReview={() => { setReview(false); setShowIssues(true); setSelection({}); setNodes(current => current.map(node => node.selected ? { ...node, selected: false } : node)); setSelectedRequest(null); setInspectorOpen(true); panel({ type: 'review-issues' }); }} />}
      {challenge && currentGrade && resultsOpen && <Suspense fallback={null}><ResultsDialog challenge={challenge} grade={currentGrade.grade} previous={currentGrade.previous} best={currentGrade.best} newlySolved={currentGrade.newlySolved}
        onClose={() => setResultsOpen(false)} onBackToList={showChallenges}
        attemptNumber={progress.challenges[challenge.id]?.last?.number} canCompare={challengeHistory.filter(entry => parseAttemptRecord(entry.record).status === 'ok').length >= 2}
        onReview={number => { setResultsOpen(false); setAttemptsView({ mode: 'review', number }); }} onCompare={() => { setResultsOpen(false); compareLatest(); }}
        lessonsFor={id => { const criterion = challenge.criteria.find(entry => entry.id === id); return criterion ? lessonsForCriterion(challenge, criterion) : []; }}
        onOpenLesson={id => { setResultsOpen(false); openLesson(id); }}
        // Only on request: the graded run replaces the practice run in playback and metrics.
        onInspect={() => { setResultsOpen(false); playRun({ ...currentGrade.benchmark, key: simulationKey(currentGrade.benchmark.input) }); setBottomOpen(true); setBottomTab('metrics'); }} /></Suspense>}
      {challenge && attemptsView && <Suspense fallback={null}><AttemptsDialog challenge={challenge} history={challengeHistory} view={attemptsView} onView={setAttemptsView}
        onClose={() => setAttemptsView(null)} onLoadDraft={loadAttemptDraft} matchesCurrent={matchesCurrent} /></Suspense>}
    </div>
  </ValidationContext.Provider></PlaybackContext.Provider>;
}
