// Reading by a long list of ids in batches, so no request's address gets too long (a PostgREST `in` filter is in the
// URL: 100 uuids are about 3.7 KB), and putting the answers back together as one query would have returned them.

// `list` in runs of `size`.
export const inBatches = <T>(list: T[], size = 100) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// Rows ordered by created_at, then seq, newest first, as Postgres orders them: to the microsecond, which Date.parse drops.
type Stamped = { id: string; created_at: string; seq: number };
const parts = (iso: string) => [Date.parse(iso.replace(/\.\d+/, '')), Number((iso.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(0, 6))];
export function newestFirst(a: Stamped, b: Stamped) {
  const [x, y] = [parts(a.created_at), parts(b.created_at)];
  return y[0] - x[0] || y[1] - x[1] || b.seq - a.seq;
}

// Rows `from` to `to` (inclusive, as range) of the answers to several queries taken as one: each answer holds its own
// first `to + 1` rows; a row more than one of them found counts once.
export function mergePage<T extends Stamped>(answers: T[][], from: number, to: number) {
  const rows = new Map<string, T>();
  for (const answer of answers) for (const r of answer) rows.set(r.id, r);
  return [...rows.values()].sort(newestFirst).slice(from, to + 1);
}
