import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SimulationResult } from '../simulation/engine';
import type { PlaybackIndex } from '../simulation/playback';
import type { ViewMode } from './model';
import type { Validation } from './validation';

/** Holds the playhead in simulated milliseconds. Updated every animation frame without React renders. */
export class PlaybackStore {
  time = 0;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getTime = () => this.time;
  set(time: number) { if (time === this.time) return; this.time = time; this.listeners.forEach(listener => listener()); }
}

export type PlaybackContextValue = {
  store: PlaybackStore; result: SimulationResult | null; index: PlaybackIndex | null; labels: Record<string, string>;
  /** Validation state at the moment the current result's run started. */
  runValidation: Pick<Validation, 'counts' | 'issues'> | null;
  view: ViewMode; reducedMotion: boolean; selectedRequest: number | null; selectRequest: (id: number | null) => void;
  /** Visual travel window for particles and outcome markers, in simulated ms (a constant wall-clock duration). */
  travelWindowMs: number; failureWindowMs: number;
};
export const PlaybackContext = createContext<PlaybackContextValue | null>(null);
export function usePlayback() { const value = useContext(PlaybackContext); if (!value) throw new Error('PlaybackContext missing'); return value; }

/** Subscribes to a derived value of the playhead; re-renders only when `keyOf` changes. */
export function usePlaybackSelector<T>(select: (time: number) => T, keyOf: (value: T) => string): T {
  const { store } = usePlayback(); const cache = useRef<{ key: string; value: T } | null>(null);
  const snapshot = () => { const value = select(store.time); const key = keyOf(value); if (cache.current?.key === key) return cache.current.value; cache.current = { key, value }; return value; };
  return useSyncExternalStore(store.subscribe, snapshot);
}

/** Playhead for text-heavy panels, throttled so lists do not re-render every frame. */
export function useThrottledTime(interval = 150) {
  const { store } = usePlayback(); const [time, setTime] = useState(store.time);
  useEffect(() => {
    let last = 0; let timer: number | undefined;
    const update = () => {
      window.clearTimeout(timer); const now = performance.now();
      if (now - last >= interval) { last = now; setTime(store.time); }
      else timer = window.setTimeout(() => { last = performance.now(); setTime(store.time); }, interval - (now - last));
    };
    setTime(store.time); const unsubscribe = store.subscribe(update);
    return () => { unsubscribe(); window.clearTimeout(timer); };
  }, [store, interval]);
  return time;
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => { const media = window.matchMedia(query); const change = () => setMatches(media.matches); change(); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, [query]);
  return matches;
}
