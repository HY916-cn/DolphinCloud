import { pinyin } from 'pinyin-pro';

// Finding a student at the counter (PHASE-1.md §7.5): by student number, name, full pinyin, pinyin initials or class.
// Each roster entry is indexed once; a query matches when it starts or appears in one of these keys.
export type Searchable = { student_no: string; name: string; class_label: string | null; class_no: number };
export type Indexed<T> = { row: T; keys: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[\s()（）·]/g, '');

export function indexRoster<T extends Searchable>(rows: T[]): Indexed<T>[] {
  return rows.map((row) => {
    const syllables = pinyin(row.name, { toneType: 'none', type: 'array', surname: 'head' });
    return {
      row,
      // Order is rank: number, name, initials, pinyin, class.
      keys: [row.student_no, row.name, syllables.map((s) => s[0]).join(''), syllables.join(''),
        norm(row.class_label ?? `${row.class_no}班`)].map(norm),
    };
  });
}

// Best matches first: a key that starts with the query beats one that only contains it; earlier keys beat later ones.
export function searchRoster<T>(index: Indexed<T>[], query: string, limit = 20): T[] {
  const q = norm(query);
  if (!q) return [];
  const scored: [number, T][] = [];
  for (const { row, keys } of index) {
    let best = Infinity;
    keys.forEach((k, i) => {
      if (k.startsWith(q)) best = Math.min(best, i);
      else if (k.includes(q)) best = Math.min(best, keys.length + i);
    });
    if (best < Infinity) scored.push([best, row]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, row]) => row);
}
