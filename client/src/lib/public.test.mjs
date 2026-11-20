// node src/lib/public.test.mjs — the wording and arithmetic of 利率看板, 大屏时间 and 文件传输.
import assert from 'node:assert/strict';
const { boardRate, clockFace, clockOffset, codeDigits, formatSize, tooLarge, MAX_FILE } = await import('./public.ts');

// Sizes in steps of 1024, one decimal, no trailing .0; under 1 KB reads 1 KB.
assert.equal(formatSize(0), '1 KB');
assert.equal(formatSize(500), '1 KB');
assert.equal(formatSize(839_680), '820 KB');
assert.equal(formatSize(13_002_342), '12.4 MB');
assert.equal(formatSize(104_857_600), '100 MB');
assert.equal(formatSize(1_288_490_188), '1.2 GB');
assert.equal(formatSize(1_048_575), '1 MB'); // 1023.999 KB rounds up into the next unit

// Board rates: 2 decimals without trailing zeros; 理财 signed, 0 without a sign.
assert.equal(boardRate(2.1333), '2.13');
assert.equal(boardRate(4.5), '4.5');
assert.equal(boardRate(3), '3');
assert.equal(boardRate(6.2667), '6.27');
assert.equal(boardRate(1.36, true), '+1.36');
assert.equal(boardRate(-0.5, true), '−0.5');
assert.equal(boardRate(0, true), '0');
assert.equal(boardRate(-0.001, true), '0');

// Limits: count first, then each file, then the total.
const files = (n, size) => Array.from({ length: n }, (_, i) => ({ name: `${i}.txt`, size }));
assert.equal(tooLarge(files(20, 1)), null);
assert.deepEqual(tooLarge(files(23, 1)), { field: 'count', max: 20, count: 23 });
assert.deepEqual(tooLarge([{ name: '视频.mp4', size: MAX_FILE + 1 }, { name: 'a', size: 1 }]),
  { field: 'file', max: MAX_FILE, files: [{ name: '视频.mp4', size: MAX_FILE + 1 }] });
assert.equal(tooLarge([{ name: 'a', size: MAX_FILE }]), null);
assert.deepEqual(tooLarge(files(3, MAX_FILE)), { field: 'total', max: 209_715_200, total: 3 * MAX_FILE });
assert.equal(tooLarge([{ name: 'empty', size: 0 }]), null);

// Pickup codes: digits only, at most 4.
assert.equal(codeDigits(' 08-27 '), '0827');
assert.equal(codeDigits('123456'), '1234');
assert.equal(codeDigits('ab'), '');

// 授时: the shortest round trip wins; offset = server + rtt/2 − local time on receipt.
assert.equal(clockOffset([]), null);
assert.equal(clockOffset([
  { sent: 1000, received: 1300, server: 5000 },
  { sent: 2000, received: 2040, server: 6000 },
  { sent: 3000, received: 3100, server: 7000 },
]), 6000 + 20 - 2040);

// Shanghai time, 24 hours, two digits; the date and weekday turn over with it at midnight.
assert.deepEqual(clockFace(Date.parse('2026-11-20T06:30:05Z')), { time: '14:30:05', date: '11月20日 星期五' });
assert.deepEqual(clockFace(Date.parse('2026-11-20T16:00:00Z')), { time: '00:00:00', date: '11月21日 星期六' });

// 利率看板: what each tile shows of public_rates().
const { boardView } = await import('./public.ts');
const tiers = (rates) => ['steady', 'balanced', 'bold'].map((key, i) => ({ key, name: ['稳健', '平衡', '进取'][i], multiplier: [1, 2, 4][i], rate: rates[i] }));
const rates = (wealth, scores) => ({
  credit_enabled: !!scores, current: 2,
  scores: scores ?? [{ score: 600, loan: 6.2667 }],
  term: { 12: 3, 2: 2.5, 48: 3.5, 4: 2.75, 24: 3.25 },
  wealth: { name: '沪深 300', weeks: 12, ...wealth },
});
const shown = (c) => `${c.text}${c.pct ? '%' : ''}${c.trend ? ` ${c.trend}` : ''}`;
const FULL = [{ score: 600, loan: 6.2667 }, { score: 750, loan: 5.5667 }, { score: 900, loan: null }, { score: 1000, loan: 4.4 }];

// Normal: 活期 one rate, loans by score (— where none), terms by weeks, the index and tiers signed in red or green.
let v = boardView(rates({ day: '2026-11-19', change: 0.42, closed: false, tiers: tiers([1.3553, -2.1953, 0]) }, FULL));
assert.equal(shown(v.current), '2%');
assert.deepEqual(v.loans.map((l) => `${l.label} ${shown(l.cell)}`), ['600 分 6.27%', '750 分 5.57%', '900 分 —', '1000 分 4.4%']);
assert.deepEqual(v.terms.map((t) => `${t.label} ${shown(t.cell)}`), ['2 周 2.5%', '4 周 2.75%', '12 周 3%', '24 周 3.25%', '48 周 3.5%']);
assert.equal(`${v.index.label} ${shown(v.index.cell)}`, '沪深 300 +0.42% is-up');
assert.deepEqual(v.tiers.map((t) => `${t.name}×${t.multiplier} ${shown(t.cell)}`), ['稳健×1 +1.36% is-up', '平衡×2 −2.2% is-down', '进取×4 0%']);

// Closed today: the index reads 休市, the tiers their bases.
v = boardView(rates({ day: '2026-11-21', change: 0, closed: true, tiers: tiers([0.5153, 0.5153, 0.5153]) }, FULL));
assert.equal(shown(v.index.cell), '休市');
assert.deepEqual(v.tiers.map((t) => shown(t.cell)), ['+0.52% is-up', '+0.52% is-up', '+0.52% is-up']);

// No quote yet: — for the index and every tier.
v = boardView(rates({ day: null, change: null, closed: false, tiers: tiers([null, null, null]) }, FULL));
assert.equal(shown(v.index.cell), '—');
assert.deepEqual(v.tiers.map((t) => shown(t.cell)), ['—', '—', '—']);

// The latest trading day is not today: the numbers are that day's, shown as they come.
v = boardView(rates({ day: '2026-11-14', change: -0.8, closed: false, tiers: tiers([-1.1, -2.2, -4.4]) }, FULL));
assert.equal(shown(v.index.cell), '−0.8% is-down');
assert.deepEqual(v.tiers.map((t) => shown(t.cell)), ['−1.1% is-down', '−2.2% is-down', '−4.4% is-down']);

// Credit paused: only the 600 row, not padded to four.
v = boardView(rates({ day: '2026-11-19', change: 0.42, closed: false, tiers: tiers([1, 2, 3]) }));
assert.deepEqual(v.loans.map((l) => `${l.label} ${shown(l.cell)}`), ['600 分 6.27%']);
console.log('public ok');
