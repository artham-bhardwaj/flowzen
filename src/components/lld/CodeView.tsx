import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { tokenizeJava } from '../../lld/java';

type Props = {
  code: string; label: string;
  /** Model type names that become clickable links in the code. */
  links?: Set<string>; onLink?: (typeName: string) => void;
  tone?: 'default' | 'bad' | 'ok';
};

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select(); const ok = document.execCommand('copy'); area.remove(); return ok;
  } catch { return false; }
}

/** Read-only, syntax-highlighted Java with a copy button. */
export function CodeView({ code, label, links, onLink, tone = 'default' }: Props) {
  const tokens = useMemo(() => tokenizeJava(code), [code]);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const copy = async () => { setCopied(await copyText(code) ? 'done' : 'failed'); window.setTimeout(() => setCopied('idle'), 1600); };
  return <figure className={`fz-code tone-${tone}`}>
    <figcaption><span>{label}</span>
      <button className="fz-btn fz-btn--small" onClick={copy} aria-label={`Copy ${label}`}>
        {copied === 'done' ? <><Check size={12} />Copied</> : copied === 'failed' ? 'Copy failed' : <><Copy size={12} />Copy</>}
      </button>
    </figcaption>
    <pre tabIndex={0} aria-label={`${label} source`}><code>{tokens.map((token, index) => {
      if (token.kind === 'type' && links?.has(token.text) && onLink) return <button key={index} className="tk-link" onClick={() => onLink(token.text)} title={`Inspect ${token.text}`}>{token.text}</button>;
      return token.kind === 'plain' ? token.text : <span key={index} className={`tk-${token.kind}`}>{token.text}</span>;
    })}</code></pre>
  </figure>;
}
