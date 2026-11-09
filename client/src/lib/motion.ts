import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Play a one-shot CSS animation again: the class has to come off for one layout before it is put back.
export function replay(el: Element, name: string) {
  el.classList.remove(name);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(name);
}

// A ref for a number's element, which plays dc-bump each time the value changes after it first shows.
export function useBump<T extends Element>(value: unknown) {
  const ref = useRef<T>(null);
  const shown = useRef(value);
  useEffect(() => {
    if (shown.current === value) return;
    shown.current = value;
    if (ref.current) replay(ref.current, 'dc-bump');
  }, [value]);
  return ref;
}

// The amount to show: rolls from the old value to a new one in 600ms (motion.md); the first value shows as it is, and
// so does every value when the system asks for reduced motion.
export function useRolling(value: number) {
  const [shown, setShown] = useState(value);
  const at = useRef(value);
  useEffect(() => {
    const from = at.current;
    if (from === value) return;
    const start = performance.now();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const tick = (now: number) => {
      const p = still ? 1 : Math.min((now - start) / 600, 1);
      at.current = Math.round(from + (value - from) * (1 - (1 - p) ** 3));
      setShown(at.current);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return shown;
}

// In a newest-first list, the rows above the first one already seen; earlier pages added at the foot do not count, nor
// does a list with nothing in common with what was seen.
export function newRows(seen: ReadonlySet<string>, keys: string[]) {
  if (!seen.size) return keys;
  const top = keys.findIndex((k) => seen.has(k));
  return top > 0 ? keys.slice(0, top) : [];
}

// The rows of a newest-first dc-txns list that appeared after it loaded, for is-new. `keys` is undefined while loading;
// a new `scope` (the list's filter) starts again from what it then shows.
export function useNewRows(keys: readonly (string | number)[] | undefined, scope = ''): ReadonlySet<string> {
  const seen = useRef<{ scope: string; keys: Set<string> } | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const list = keys?.join('\n');
  useLayoutEffect(() => {
    if (list === undefined) return;
    const now = list ? list.split('\n') : [];
    const known = seen.current?.scope === scope ? seen.current.keys : null;
    setFresh(new Set(known ? newRows(known, now) : []));
    seen.current = { scope, keys: new Set([...(known ?? []), ...now]) };
  }, [list, scope]);
  return fresh;
}
