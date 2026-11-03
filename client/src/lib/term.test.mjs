// node src/lib/term.test.mjs — checks the term's start and the balance's sea on the student home page.
import assert from 'node:assert/strict';
const { termStart, tide } = await import('./term.ts');
assert.equal(termStart(new Date('2026-11-03T04:00:00Z')), '2026-09-01');
assert.equal(termStart(new Date('2026-08-31T15:59:00Z')), '2026-02-01'); // 23:59 on 8月31日 in Shanghai
assert.equal(termStart(new Date('2026-08-31T16:00:00Z')), '2026-09-01'); // 00:00 on 9月1日 in Shanghai
assert.equal(termStart(new Date('2027-01-15T04:00:00Z')), '2026-09-01');

// 190 carried in, +270 −45 this term: the sea starts at 190 on 9月1日, peaks at 460 and ends at 415; the top is 575.
const now = new Date('2026-11-03T04:00:00Z');
const t = tide(415, [{ balance_delta: 270, created_at: '2026-10-01T04:00:00Z' }, { balance_delta: -45, created_at: '2026-10-20T04:00:00Z' }], '2026-09-01', now);
assert.deepEqual({ from: t.from, start: t.start, saved: t.saved, spent: t.spent }, { from: '9月1日', start: 190, saved: 270, spent: -45 });
assert.equal(t.start + t.saved + t.spent, 415);
assert.equal(t.points, '0,75.0 480.3,75.0 480.3,22.4 779.5,22.4 779.5,31.2 1000,31.2 1000,112 0,112');

// Opened this term: the sea starts at the first business, at 0.
const n = tide(50, [{ balance_delta: 50, created_at: '2026-10-08T02:00:00Z' }], '2026-09-01', now);
assert.equal(n.from, '10月8日');
assert.equal(n.points, '0,112.0 0.0,112.0 0.0,22.4 1000,22.4 1000,112 0,112');

// No business this term and no money: a flat, empty sea.
assert.equal(tide(0, [], '2026-09-01', now).points, '0,112.0 1000,112.0 1000,112 0,112');
console.log('term ok');
