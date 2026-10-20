import { useState } from 'react';
import { CircleX, TriangleAlert, Wrench } from 'lucide-react';
import type { Fix, Issue } from '../app/validation';
import { useValidation } from '../app/validationContext';

/** A fix is only applied after the user confirms it; nothing changes the architecture on its own. */
function FixButton({ fix }: { fix: Fix }) {
  const { applyFix } = useValidation(); const [confirming, setConfirming] = useState(false);
  if (!confirming) return <button className="fz-btn fz-btn--small fz-fix" onClick={event => { event.stopPropagation(); setConfirming(true); }}><Wrench size={12} aria-hidden />{fix.label}</button>;
  return <span className="fz-fix-confirm" role="group" aria-label={`Confirm: ${fix.label}`}>
    <span>Apply “{fix.label}”?</span>
    <button className="fz-btn fz-btn--small fz-btn--primary" onClick={event => { event.stopPropagation(); applyFix(fix); setConfirming(false); }} autoFocus>Apply</button>
    <button className="fz-btn fz-btn--small" onClick={event => { event.stopPropagation(); setConfirming(false); }}>Cancel</button>
  </span>;
}

export function IssueList({ issues, labels, showComponent = false }: { issues: Issue[]; labels: Record<string, string>; showComponent?: boolean }) {
  const { selectNode } = useValidation();
  return <ul className="fz-issues">{issues.map((issue, i) => <li key={`${issue.code}-${issue.nodeId}-${i}`} className={`sev-${issue.severity}`}>
    <div className="fz-issue__head">
      {issue.severity === 'dead' ? <CircleX size={14} aria-label="Dead" /> : <TriangleAlert size={14} aria-label="Warning" />}
      <span>
        {showComponent && issue.nodeId && <button className="fz-issue__node" onClick={() => selectNode(issue.nodeId!)}>{labels[issue.nodeId] ?? issue.nodeId}</button>}
        {issue.message}
      </span>
    </div>
    {issue.fix && <FixButton fix={issue.fix} />}
  </li>)}</ul>;
}
