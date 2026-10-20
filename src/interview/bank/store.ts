import { useCallback, useEffect, useState } from 'react';

/**
 * Question-bank preferences, saved in this browser under their own key (`flowzen-question-bank-v1`), apart from
 * interview drafts and records. Progress (in progress / completed) is not stored here: it is derived from interview
 * drafts and completed records, so it can never disagree with them.
 */
export const BANK_STORAGE_KEY = 'flowzen-question-bank-v1';
export type BankPrefs = { version: 1; bookmarks: string[]; studied: Record<string, number> };
export const emptyPrefs = (): BankPrefs => ({ version: 1, bookmarks: [], studied: {} });
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStorage = () => typeof localStorage === 'undefined' ? undefined : localStorage;

/** Loads preferences; anything malformed is ignored entry by entry (unknown ids are kept so nothing is lost). */
export function loadPrefs(storage: StorageLike | undefined = defaultStorage()): BankPrefs {
  try {
    const raw = JSON.parse(storage?.getItem(BANK_STORAGE_KEY) ?? 'null') as Partial<BankPrefs> | null;
    if (!raw || raw.version !== 1) return emptyPrefs();
    const bookmarks = Array.isArray(raw.bookmarks) ? [...new Set(raw.bookmarks.filter((id): id is string => typeof id === 'string'))] : [];
    const studied = raw.studied && typeof raw.studied === 'object' ? Object.fromEntries(Object.entries(raw.studied).filter(([, at]) => typeof at === 'number' && Number.isFinite(at))) : {};
    return { version: 1, bookmarks, studied };
  } catch { return emptyPrefs(); }
}
export function savePrefs(prefs: BankPrefs, storage: StorageLike | undefined = defaultStorage()): boolean {
  try { storage?.setItem(BANK_STORAGE_KEY, JSON.stringify(prefs)); return true; } catch { return false; }
}
export const toggleBookmark = (prefs: BankPrefs, id: string): BankPrefs => ({ ...prefs, bookmarks: prefs.bookmarks.includes(id) ? prefs.bookmarks.filter(entry => entry !== id) : [...prefs.bookmarks, id] });
export const toggleStudied = (prefs: BankPrefs, id: string, at: number): BankPrefs => {
  const studied = { ...prefs.studied }; if (studied[id]) delete studied[id]; else studied[id] = at;
  return { ...prefs, studied };
};

export function useBankPrefs() {
  const [prefs, setPrefs] = useState<BankPrefs>(() => loadPrefs());
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => { setSaveFailed(!savePrefs(prefs)); }, [prefs]);
  return {
    prefs, saveFailed,
    bookmark: useCallback((id: string) => setPrefs(current => toggleBookmark(current, id)), []),
    study: useCallback((id: string) => setPrefs(current => toggleStudied(current, id, Date.now())), []),
  };
}
export type BankPrefsController = ReturnType<typeof useBankPrefs>;
