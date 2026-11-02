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

// What a back-office filter (流水, 报表) narrows to, found with the counter's search: a 学部, a class or one student.
export type Scope =
  | { kind: 'division'; division: 'primary' | 'junior'; label: string; note: string }
  | { kind: 'class'; division: 'primary' | 'junior'; cohort: number; class_no: number; label: string; note: string }
  | { kind: 'student'; student_no: string; label: string; note: string };
type ScopeRow = Searchable & { division: 'primary' | 'junior'; cohort: number };
const DIVISIONS = [['primary', '小学部', 'xxb'], ['junior', '初中部', 'czb']] as const;

// The 学部 and classes whose names match the query (as 搜索 matches a class), then the students searchRoster finds.
export function findScopes<T extends ScopeRow>(index: Indexed<T>[], query: string, limit = 8): Scope[] {
  const q = norm(query);
  if (!q) return [];
  const count = (match: (r: T) => boolean) => `${index.filter(({ row }) => match(row)).length} 人`;
  const divisions: Scope[] = DIVISIONS.filter(([, label, initials]) => label.includes(q) || initials.startsWith(q))
    .map(([division, label]) => ({ kind: 'division', division, label, note: count((r) => r.division === division) }));
  const classes = new Map<string, Scope>();
  for (const { row } of index) {
    const label = row.class_label ?? `${row.cohort} 届 ${row.class_no} 班`;
    const key = `${row.division}-${row.cohort}-${row.class_no}`;
    if (classes.size < limit && !classes.has(key) && norm(label).includes(q)) {
      classes.set(key, { kind: 'class', division: row.division, cohort: row.cohort, class_no: row.class_no, label,
        note: count((r) => r.division === row.division && r.cohort === row.cohort && r.class_no === row.class_no) });
    }
  }
  const students: Scope[] = searchRoster(index, query, limit).map((r) => ({
    kind: 'student', student_no: r.student_no, label: r.name, note: `${r.class_label ?? `${r.class_no}班`} · 学号 ${r.student_no}`,
  }));
  return [...divisions, ...classes.values(), ...students];
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
