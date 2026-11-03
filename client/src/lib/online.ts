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

// Registered once for every subscriber: a shared handler removed by one leaving would stop the others hearing it.
window.addEventListener('online', () => {
  failed = false;
  notify();
});
window.addEventListener('offline', notify);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine && !failed);
