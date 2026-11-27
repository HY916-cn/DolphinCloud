// node src/lib/batches.test.mjs — reading by many ids in batches, put back together as one query returns them.
import assert from 'node:assert/strict';
const { inBatches, mergePage, newestFirst } = await import('./batches.ts');

assert.deepEqual(inBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.equal(inBatches(Array.from({ length: 500 }, (_, i) => i)).length, 5);
assert.deepEqual(inBatches([]), []);

// To the microsecond, whatever digits Postgres printed, then by seq.
const row = (id, created_at, seq) => ({ id, created_at, seq });
assert.ok(newestFirst(row('a', '2026-11-26T01:05:00.5+00:00', 1), row('b', '2026-11-26T01:05:00.49+00:00', 2)) < 0);
assert.ok(newestFirst(row('a', '2026-11-26T01:05:00+00:00', 1), row('b', '2026-11-26T01:05:00.000001+00:00', 2)) > 0);
assert.ok(newestFirst(row('a', '2026-11-26T01:05:00.1+00:00', 1), row('b', '2026-11-26T01:05:00.100000+00:00', 2)) > 0);

// 240 matches by product (3 batches of 100) and some by 交易号, a few found by both: every page equals the same page of
// the whole list ordered as one query orders it.
const base = Date.parse('2026-09-01T00:00:00Z');
const all = Array.from({ length: 260 }, (_, i) => row(`t${i}`, new Date(base + Math.floor(i / 3) * 60_000).toISOString().replace('Z', '+00:00'), i));
const byName = all.slice(0, 240);
const byNo = all.filter((r) => r.seq % 13 === 0); // some within the 240, some after
const whole = [...new Map([...byName, ...byNo].map((r) => [r.id, r])).values()].sort(newestFirst);
const batches = inBatches(byName.map((r) => r.id));
assert.equal(batches.length, 3);
for (let page = 0; page * 30 < whole.length + 30; page++) {
  const from = page * 30;
  const to = from + 29;
  // Each request: its batch's ids or a matching 交易号, newest first, rows 0 to `to`.
  const answers = batches.map((ids) => all.filter((r) => ids.includes(r.id) || byNo.includes(r)).sort(newestFirst).slice(0, to + 1));
  assert.deepEqual(mergePage(answers, from, to), whole.slice(from, to + 1), `page ${page}`);
}
console.log('batches ok');
