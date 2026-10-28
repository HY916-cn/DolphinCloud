import { useSyncExternalStore } from 'react';

// Whether the counter can reach the server (PHASE-1.md §7.7): the browser says it is offline, or the last call
// got no answer (lib/counter.ts call). The next successful call or the browser's online event clears it.
let failed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function setReachable(ok: boolean) {
  if (failed === !ok) return;
  failed = !ok;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const online = () => setReachable(true);
  window.addEventListener('online', online);
  window.addEventListener('offline', notify);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', online);
    window.removeEventListener('offline', notify);
  };
}

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine && !failed);
