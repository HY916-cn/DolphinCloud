// node src/lib/interest.test.mjs — the 利息 page's weeks and how 攒着的利息 adds up, on the design system's example
// (StudentInterestPage 示例数据).
import assert from 'node:assert/strict';
const { cnDay, dayTitle, interestWeeks, pageRange, pendingParts, weekOf, weekTitle } = await import('./interest.ts');

assert.equal(weekOf('2026-11-13'), '2026-11-09');
assert.equal(weekOf('2026-11-09'), '2026-11-09');
assert.equal(weekOf('2026-11-08'), '2026-11-02');
assert.equal(cnDay('2026-11-08T16:00:00Z'), '2026-11-09');
assert.equal(dayTitle('2026-11-13'), '11月13日 星期五');
assert.equal(dayTitle('2026-11-08'), '11月8日 星期日');
assert.equal(weekTitle('2026-11-09', '2026-11-09'), '本周');
assert.equal(weekTitle('2026-11-02', '2026-11-09'), '11月2日至11月8日');
assert.equal(weekTitle('2026-12-28', '2027-01-11'), '12月28日至1月3日');
// 4 weeks a page, newest first.
assert.deepEqual(pageRange('2026-11-09', 0), { from: '2026-10-19', to: null });
assert.deepEqual(pageRange('2026-11-09', 1), { from: '2026-09-21', to: '2026-10-19' });

const THIS = '2026-11-09';
const day = (d, balance, rate, centi, settled = null) => ({ day: d, balance, rate, centi, settled_txn: settled });
const days = [
  day('2026-11-13', 415, 2.13, 126), day('2026-11-12', 415, 2.13, 126), day('2026-11-11', 415, 2.13, 126),
  day('2026-11-10', 461, 2.13, 140), day('2026-11-09', 461, 2.13, 140),
  day('2026-11-08', 412, 2.08, 122, 't3'), day('2026-11-07', 432, 2.08, 128, 't3'), day('2026-11-06', 432, 2.08, 128, 't3'),
  day('2026-11-05', 432, 2.08, 128, 't3'), day('2026-11-04', 432, 2.08, 128, 't3'), day('2026-11-03', 432, 2.08, 128, 't3'),
  day('2026-11-02', 417, 2.08, 123, 't3'),
];
const correction = { day: '2026-11-08', txn_id: 'm1', balance: 452, centi: 12, settled_txn: null };
const settlements = [{ id: 't3', amount: 9, created_at: '2026-11-08T16:00:00Z' }];

const weeks = interestWeeks(days, [correction], settlements, THIS, '2026-10-19');
assert.deepEqual(weeks.map((w) => [w.title, w.total, w.paid, w.rows.length]), [['本周', 670, null, 6], ['11月2日至11月8日', 885, { amount: 9, day: '2026-11-09' }, 7]]);
// Newest day first, the correction last, as 11月8日的利息.
assert.deepEqual(weeks[0].rows.map((r) => (r.kind === 'day' ? r.title : `更正 ${r.day}`)),
  ['11月13日 星期五', '11月12日 星期四', '11月11日 星期三', '11月10日 星期二', '11月9日 星期一', '更正 11月8日']);
// Settled by the next Monday's 利息: listed with the week it settled, after that week's days.
const settledCorrection = { ...correction, settled_txn: 't4' };
const later = interestWeeks(days.slice(0, 5).map((d) => ({ ...d, settled_txn: 't4' })), [settledCorrection],
  [{ id: 't4', amount: 7, created_at: '2026-11-15T16:00:00Z' }], '2026-11-16', '2026-10-26');
assert.deepEqual(later.map((w) => [w.title, w.total, w.paid, w.rows.at(-1).kind]), [['11月9日至11月15日', 670, { amount: 7, day: '2026-11-16' }, 'adjust']]);
// A correction settled in a week older than those loaded waits for that page.
assert.deepEqual(interestWeeks([], [settledCorrection], [{ id: 't4', amount: 7, created_at: '2026-11-15T16:00:00Z' }], '2027-01-04', '2026-12-14'), []);
// Paused days are rows like any other, at 0.
const paused = interestWeeks([day('2026-11-13', 415, 0, 0), day('2026-11-09', 461, 2.13, 140)], [], [], THIS, THIS);
assert.deepEqual(paused[0].rows.map((r) => [r.rate, r.centi]), [[0, 0], [2.13, 140]]);
assert.equal(paused[0].total, 140);

// One 利息 of 1 HTB settles three weeks of 0.20, 0.30 and 0.60 (each under 1 HTB): its amount on the latest week only,
// the earlier two with its day, so it does not read as 3 HTB paid.
const low = [day('2026-11-11', 10, 2, 20, 't9'), day('2026-11-04', 15, 2, 30, 't9'), day('2026-10-28', 30, 2, 60, 't9'), day('2026-11-17', 10, 2, 3)];
const spread = interestWeeks(low, [], [{ id: 't9', amount: 1, created_at: '2026-11-15T16:00:00Z' }], '2026-11-16', '2026-10-26');
assert.deepEqual(spread.map((w) => [w.title, w.total, w.paid]), [
  ['本周', 3, null],
  ['11月9日至11月15日', 20, { amount: 1, day: '2026-11-16' }],
  ['11月2日至11月8日', 30, { amount: null, day: '2026-11-16' }],
  ['10月26日至11月1日', 60, { amount: null, day: '2026-11-16' }],
]);

// 6.80 = 0.10 left over + 6.58 this week + 0.12 corrections.
assert.deepEqual(pendingParts(680, days, [correction], THIS), { week: 658, corrections: 12, carry: 10 });
// No open correction: that row is left out; a negative one is kept.
assert.deepEqual(pendingParts(668, days, [], THIS), { week: 658, corrections: null, carry: 10 });
assert.deepEqual(pendingParts(663, days, [{ ...correction, centi: -5 }], THIS), { week: 658, corrections: -5, carry: 10 });
assert.deepEqual(pendingParts(302, [day('2026-11-11', 415, 0, 0), ...days.slice(3)], [correction], THIS), { week: 280, corrections: 12, carry: 10 });
console.log('interest ok');
