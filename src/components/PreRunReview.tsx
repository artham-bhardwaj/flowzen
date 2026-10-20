import { useEffect, useRef } from 'react';
import { Play, ScanSearch, X } from 'lucide-react';
import type { Validation } from '../app/validation';
import { StatusIcon, statusLabels } from './status';

type Props = { validation: Validation; labels: Record<string, string>; onRun: () => void; onReview: () => void; onCancel: () => void };
const SHOWN = 6;

/** Shown before a run when the architecture has validation issues. Running anyway is the user's decision. */
export function PreRunReview({ validation, labels, onRun, onReview, onCancel }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Tab' && dialog.current) {
        const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button')]; const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [onCancel]);
  const dead = validation.issues.filter(issue => issue.severity === 'dead'); const warnings = validation.issues.filter(issue => issue.severity === 'warning');
  const describe = (list: typeof dead) => <ul>{list.slice(0, SHOWN).map((issue, i) => <li key={i}>{issue.nodeId && <b>{labels[issue.nodeId] ?? issue.nodeId}: </b>}{issue.message}</li>)}{list.length > SHOWN && <li className="fz-more">and {list.length - SHOWN} more</li>}</ul>;
  return <div className="fz-scrim" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <div className="fz-dialog" role="dialog" aria-modal="true" aria-labelledby="fz-review-title" ref={dialog}>
      <div className="fz-dialog__head"><h2 id="fz-review-title">Review architecture before running</h2><button className="fz-icon-btn" onClick={onCancel} aria-label="Close"><X size={15} /></button></div>
      <div className="fz-status-counts">{(['functional', 'warning', 'dead'] as const).map(status => <span key={status} className={`status-${status}`}><StatusIcon status={status} /><b>{validation.counts[status]}</b>{statusLabels[status]}</span>)}</div>
      {(dead.length > 0) && <section className="fz-dialog__section sev-dead">
        <h3>Dead components and paths</h3>
        <p>These parts cannot process traffic. Requests that reach them fail with the engine's actual cause (for example “no downstream connection”). They are never counted as successes, and components nothing reaches simply stay idle.</p>
        {describe(dead)}
      </section>}
      {warnings.length > 0 && <section className="fz-dialog__section sev-warning">
        <h3>Warnings</h3>
        <p>The simulation runs the architecture exactly as configured: bypassed connections carry no traffic, and misconfigured values use the engine's fallback or limits.</p>
        {describe(warnings)}
      </section>}
      <p className="fz-dialog__note">Validation is a static check of the design. Runtime failures (timeouts, rejections, rate limits) are reported separately in the results.</p>
      <div className="fz-dialog__actions">
        <button className="fz-btn" onClick={onReview}><ScanSearch size={14} />Review issues</button>
        <button className="fz-btn fz-btn--primary" onClick={onRun} data-autofocus><Play size={14} />Run anyway</button>
      </div>
    </div>
  </div>;
}
