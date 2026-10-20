import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'flowzen-theme';

function saved(): Theme | null {
  try { const value = localStorage.getItem(STORAGE_KEY); return value === 'light' || value === 'dark' ? value : null; } catch { return null; }
}
const system = (): Theme => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
function apply(theme: Theme) { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; }

/** Saved preference wins; otherwise the system theme is followed until the user picks one. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => { const initial = saved() ?? system(); apply(initial); return initial; });
  useEffect(() => {
    if (saved()) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => { if (saved()) return; const next = media.matches ? 'dark' : 'light'; apply(next); setTheme(next); };
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  const toggle = useCallback(() => setTheme(current => {
    const next: Theme = current === 'dark' ? 'light' : 'dark'; apply(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable: theme still applies for this session */ }
    return next;
  }), []);
  return { theme, toggle };
}

/** Reads resolved design-token colors for libraries that need literal values (charts). */
export function readTokens<K extends string>(names: readonly K[]): Record<K, string> {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(names.map(name => [name, style.getPropertyValue(`--${name}`).trim()])) as Record<K, string>;
}
