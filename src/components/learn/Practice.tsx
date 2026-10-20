import { useState } from 'react';
import { ArrowRight, CircleCheck, CircleX, Lock, RotateCcw } from 'lucide-react';
import { gradeClassify, gradeNumeric, gradeQuiz, QUIZ_PASS_PERCENT, type QuizAnswers, type QuizResult } from '../../learn/evaluate';
import type { LessonProgress } from '../../learn/progress';
import type { BuildTask, ClassifyTask, Exercise, NumericTask, Question } from '../../learn/types';
import { Inline } from './Rich';

const SKILL_LABELS: Record<Question['skill'], string> = { why: 'Why', when: 'When', 'trade-off': 'Trade-off', failure: 'Failure', estimate: 'Estimate', concept: 'Concept' };

/** Knowledge check: answer every question, then see what was right, why, and the explanation. Retakes keep the best result. */
export function KnowledgeCheck({ questions, progress, onSubmit }: { questions: Question[]; progress: LessonProgress | undefined; onSubmit: (result: QuizResult, answers: QuizAnswers) => void }) {
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const answered = questions.filter(question => (answers[question.id] ?? []).length > 0).length;
  const toggle = (question: Question, option: string) => setAnswers(current => {
    if (result) return current;
    const chosen = current[question.id] ?? [];
    return { ...current, [question.id]: question.mode === 'single' ? [option] : chosen.includes(option) ? chosen.filter(id => id !== option) : [...chosen, option] };
  });
  const submit = () => { const graded = gradeQuiz(questions, answers); setResult(graded); onSubmit(graded, answers); };
  const best = progress?.quiz?.best;
  return <section className="fz-quiz" aria-label="Knowledge check">
    <p className="fz-brief__note">Answer all {questions.length} questions, then check. {QUIZ_PASS_PERCENT}% or more completes this part. {best && <>Best so far: <b>{best.score}/{best.total}</b>{best.passed ? ' (passed)' : ''} over {progress!.quiz!.attempts} attempt{progress!.quiz!.attempts === 1 ? '' : 's'}.</>}</p>
    <ol className="fz-quiz__list">{questions.map((question, index) => {
      const graded = result?.questions.find(entry => entry.id === question.id);
      return <li key={question.id} className={`fz-quiz__q${graded ? graded.correct ? ' is-correct' : ' is-wrong' : ''}`}>
        <fieldset>
          <legend><span className="fz-quiz__skill">{SKILL_LABELS[question.skill]}</span><span className="fz-visually-hidden">Question {index + 1}. </span><Inline text={question.prompt} />{question.mode === 'multi' && <em> Select all that apply.</em>}</legend>
          {question.options.map(option => {
            const chosen = (answers[question.id] ?? []).includes(option.id);
            const isCorrect = question.correct.includes(option.id);
            return <label key={option.id} className={`fz-quiz__opt${graded && isCorrect ? ' is-key' : ''}${graded && chosen && !isCorrect ? ' is-miss' : ''}`}>
              <input type={question.mode === 'single' ? 'radio' : 'checkbox'} name={`q-${question.id}`} checked={chosen} disabled={Boolean(result)} onChange={() => toggle(question, option.id)} />
              <span><Inline text={option.text} />{graded && chosen && option.feedback && <small>{option.feedback}</small>}</span>
              {graded && isCorrect && <CircleCheck size={13} aria-label="Correct answer" />}{graded && chosen && !isCorrect && <CircleX size={13} aria-label="Not correct" />}
            </label>;
          })}
        </fieldset>
        {graded && <div className="fz-quiz__why"><b>{graded.correct ? 'Correct.' : graded.answered ? 'Not quite.' : 'Not answered.'}</b> <Inline text={question.explanation} /></div>}
      </li>;
    })}</ol>
    {result ? <div className={`fz-alert ${result.passed ? 'is-ok' : 'is-warn'}`} role="status"><span><b>{result.score} of {result.total} correct ({result.percent}%)</b>{result.passed ? 'Knowledge check passed.' : `You need ${QUIZ_PASS_PERCENT}% to complete it. Read the explanations, then try again.`}</span>
      <button className="fz-btn fz-btn--small" onClick={() => { setResult(null); setAnswers({}); }}><RotateCcw size={12} />Retake</button></div>
      : <div className="fz-brief__actions"><button className="fz-btn fz-btn--primary" disabled={answered < questions.length} onClick={submit}>Check answers</button><span className="fz-brief__note">{answered}/{questions.length} answered</span></div>}
  </section>;
}

type ExerciseProps = { exercise: Exercise; progress: LessonProgress | undefined; onTaskPassed: (taskId: string) => void; onOpenBuild: (task: BuildTask) => void };
/** The practical exercise: calculations and classifications are checked here; build tasks are checked by simulation in the Playground. */
export function ExerciseView({ exercise, progress, onTaskPassed, onOpenBuild }: ExerciseProps) {
  return <section className="fz-exercise" aria-label="Practical exercise">
    <p className="fz-prose__p">{exercise.brief}</p>
    <ol className="fz-exercise__tasks">{exercise.tasks.map((task, index) => {
      const done = Boolean(progress?.tasks?.[task.id]);
      return <li key={task.id} className={`fz-task${done ? ' is-done' : ''}`}>
        <div className="fz-task__head"><span>Task {index + 1} · {task.type === 'build' ? 'Build and measure' : task.type === 'numeric' ? 'Calculate' : 'Classify'}</span>{done && <span className="fz-cstatus is-solved"><CircleCheck size={12} aria-hidden />Completed</span>}</div>
        {task.type === 'numeric' ? <NumericTaskView task={task} onPassed={() => onTaskPassed(task.id)} />
          : task.type === 'classify' ? <ClassifyTaskView task={task} onPassed={() => onTaskPassed(task.id)} />
          : <BuildTaskView task={task} done={done} onOpen={() => onOpenBuild(task)} />}
      </li>;
    })}</ol>
  </section>;
}

function NumericTaskView({ task, onPassed }: { task: NumericTask; onPassed: () => void }) {
  const [text, setText] = useState(''); const [checked, setChecked] = useState<ReturnType<typeof gradeNumeric> | null>(null);
  const check = () => { const graded = gradeNumeric(task, text); setChecked(graded); if (graded.correct) onPassed(); };
  return <>
    <p className="fz-task__prompt"><Inline text={task.prompt} /></p>
    <form className="fz-labrow" onSubmit={event => { event.preventDefault(); check(); }}>
      <input value={text} onChange={event => { setText(event.target.value); setChecked(null); }} inputMode="decimal" aria-label={`Answer in ${task.unit}`} placeholder="Your answer" />
      <span className="fz-unit">{task.unit}</span><button className="fz-btn fz-btn--small" type="submit" disabled={!text.trim()}>Check</button>
    </form>
    {checked && <div className={`fz-alert ${checked.correct ? 'is-ok' : 'is-warn'}`} role="status"><span><b>{checked.value === null ? 'Enter a number.' : checked.correct ? 'Correct.' : 'Not within tolerance.'}</b>{checked.value !== null && <>Expected about {task.answer.toLocaleString()} {task.unit} (±{task.tolerancePct}%).</>}</span></div>}
    {checked && checked.value !== null && <details className="fz-task__working" open={checked.correct}><summary>Working</summary><ol>{task.working.map(step => <li key={step}>{step}</li>)}</ol></details>}
  </>;
}

function ClassifyTaskView({ task, onPassed }: { task: ClassifyTask; onPassed: () => void }) {
  const [choices, setChoices] = useState<Record<string, string>>({}); const [checked, setChecked] = useState<ReturnType<typeof gradeClassify> | null>(null);
  const check = () => { const graded = gradeClassify(task, choices); setChecked(graded); if (graded.correct) onPassed(); };
  return <>
    <p className="fz-task__prompt"><Inline text={task.prompt} /></p>
    <ul className="fz-classify">{task.items.map(item => { const graded = checked?.items.find(entry => entry.id === item.id); return <li key={item.id} className={graded ? graded.correct ? 'is-correct' : 'is-wrong' : ''}>
      <span>{item.text}</span>
      <select value={choices[item.id] ?? ''} aria-label={`Category for: ${item.text}`} onChange={event => { setChoices(current => ({ ...current, [item.id]: event.target.value })); setChecked(null); }}>
        <option value="" disabled>Choose…</option>{task.categories.map(category => <option key={category} value={category}>{category}</option>)}
      </select>
      {graded && <small>{graded.correct ? 'Correct. ' : `Answer: ${item.category}. `}{item.why}</small>}
    </li>; })}</ul>
    <div className="fz-brief__actions"><button className="fz-btn fz-btn--small" disabled={Object.keys(choices).length < task.items.length} onClick={check}>Check</button>
      {checked && <span className={checked.correct ? 'fz-ok-text' : 'fz-warn-text'} role="status">{checked.correct ? 'All correct.' : `${checked.items.filter(entry => entry.correct).length} of ${task.items.length} correct.`}</span>}</div>
  </>;
}

function BuildTaskView({ task, done, onOpen }: { task: BuildTask; done: boolean; onOpen: () => void }) {
  return <>
    <p className="fz-task__prompt"><Inline text={task.prompt} /></p>
    <dl className="fz-facts"><dt>Workload</dt><dd>{task.benchmark.rps.toLocaleString()} req/s for {task.benchmark.durationMs / 1000} s, then {task.benchmark.drainMs / 1000} s to drain · seed {task.benchmark.seed}</dd></dl>
    <ul className="fz-crit">{task.checks.map(check => <li key={check.label} className={done ? 'is-pass' : 'is-pending'}>{done ? <CircleCheck size={14} aria-label="Met" /> : <span className="fz-crit__dot" aria-hidden />}<span>{check.label}</span><b /></li>)}</ul>
    {task.overrides.length > 0 && <ul className="fz-brief__fixed">{task.overrides.map(override => <li key={override.reason}><Lock size={11} aria-hidden />{override.reason}</li>)}</ul>}
    <div className="fz-brief__actions"><button className="fz-btn fz-btn--primary" onClick={onOpen}>{done ? 'Open again in the Playground' : 'Build it in the Playground'} <ArrowRight size={13} aria-hidden /></button></div>
    <p className="fz-brief__note">The Playground loads a starting design (a copy; Undo restores your previous canvas). “Check my design” simulates this workload on whatever you build, so any design that meets the checks passes.</p>
    {done && <details className="fz-task__working"><summary>One possible solution</summary><p>{task.solution.note}</p></details>}
  </>;
}
