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
const { boardView, roll, ROLL_WAIT } = await import('./public.ts');
const NAMES = [['bond', '国债'], ['gold', '黄金'], ['csi300', '沪深 300'], ['chinext', '创业板指'], ['hsi', '恒生指数'], ['ndx', '纳斯达克 100']];
const TODAY = '2026-11-25';
const products = (rows) => NAMES.map(([key, name], i) => ({ key, name, day: TODAY, rate: null, closed: false, ...rows[i] }));
const rates = (wealth, scores, savings = true) => ({
  today: TODAY, credit_enabled: !!scores, savings_enabled: savings, current: savings ? 2 : 0,
  scores: scores ?? [{ score: 600, loan: 6.2667 }],
  term: { 12: 3, 2: 2.5, 48: 3.5, 4: 2.75, 24: 3.25 },
  wealth,
});
const shown = (c) => `${c.text}${c.pct ? '%' : ''}${c.trend ? ` ${c.trend}` : ''}`;
const FULL = [{ score: 600, loan: 6.2667 }, { score: 750, loan: 5.5667 }, { score: 900, loan: null }, { score: 1000, loan: 4.4 }];

// Normal: 活期 one rate, loans by score (— where none), terms by weeks, the six products signed in red or green, 0 plain.
let v = boardView(rates(products([{ rate: 0.6214 }, { rate: -0.6666 }, { rate: 1.4 }, { rate: -0.2891 }, { rate: 0.0012 },
  { rate: 2.7612, day: '2026-11-24' }]), FULL));
assert.equal(shown(v.current), '2%');
assert.equal(v.paused, false);
assert.equal(v.flat, false);
assert.deepEqual(v.loans.map((l) => `${l.label} ${shown(l.cell)}`), ['600 分 6.27%', '750 分 5.57%', '900 分 —', '1000 分 4.4%']);
assert.deepEqual(v.terms.map((t) => `${t.label} ${shown(t.cell)}`), ['2 周 2.5%', '4 周 2.75%', '12 周 3%', '24 周 3.25%', '48 周 3.5%']);
assert.deepEqual(v.wealth.map((w) => `${w.name}|${w.day}|${shown(w.cell)}`), [
  '国债||+0.62% is-up', '黄金||−0.67% is-down', '沪深 300||+1.4% is-up', '创业板指||−0.29% is-down', '恒生指数||0%',
  '纳斯达克 100|11月24日|+2.76% is-up',
]);

// Closed: 休市 under the name, the rate as given; a day not today too: both. No net value yet: —.
v = boardView(rates(products([{ closed: true, rate: 0.32 }, { closed: true, day: '2026-11-24', rate: 0.32 }, { day: null }]), FULL));
assert.deepEqual(v.wealth.slice(0, 3).map((w) => `${w.day}|${shown(w.cell)}`), ['休市|+0.32% is-up', '11月24日 · 休市|+0.32% is-up', '|—']);

// Credit paused: only the 600 row, flat; 活期 paused: by savings_enabled.
v = boardView(rates(products([]), undefined, false));
assert.deepEqual(v.loans.map((l) => `${l.label} ${shown(l.cell)}`), ['600 分 6.27%']);
assert.equal(v.flat, true);
assert.equal(v.paused, true);

// 自动滚动: wait 5 s at the top, down at the speed, wait 5 s at the bottom, back up, wait again.
let r = { phase: 'top', since: 0, pos: 0 };
assert.equal(roll(r, ROLL_WAIT - 1, 600, 100, 0), r);
r = roll(r, ROLL_WAIT, 600, 100, 0);
assert.deepEqual(r, { phase: 'down', since: ROLL_WAIT, pos: 0 });
r = roll(r, ROLL_WAIT + 1000, 600, 100, 0);
assert.deepEqual(r, { phase: 'down', since: ROLL_WAIT + 1000, pos: 100 });
r = roll(r, ROLL_WAIT + 7000, 600, 100, 100);
assert.deepEqual(r, { phase: 'bottom', since: ROLL_WAIT + 7000, pos: 600 });
assert.equal(roll(r, ROLL_WAIT + 7000 + ROLL_WAIT - 1, 600, 100, 600), r);
r = roll(r, ROLL_WAIT * 2 + 7000, 600, 100, 600);
assert.equal(r.phase, 'up');
assert.equal(roll(r, r.since + 500, 600, 100, 300), r);
assert.deepEqual(roll(r, r.since + 600, 600, 100, 0), { phase: 'top', since: r.since + 600, pos: 0 });
// A board that fits stays at the top; one that grew shorter goes on from its new bottom.
assert.deepEqual(roll({ phase: 'down', since: 0, pos: 300 }, 10, 1, 100, 300), { phase: 'top', since: 10, pos: 0 });
assert.deepEqual(roll({ phase: 'down', since: 0, pos: 500 }, 10, 400, 100, 400), { phase: 'bottom', since: 10, pos: 400 });
// Going on from where someone left it after a pause: down from scrollTop.
assert.deepEqual(roll({ phase: 'top', since: 0, pos: 0 }, ROLL_WAIT, 600, 100, 250), { phase: 'down', since: ROLL_WAIT, pos: 250 });

// The upload's progress: files left, the one under way counted, bytes sent rounded down.
const { remaining, sendProgress } = await import('./public.ts');
const item = (size, status, progress = 0) => ({ size, status, progress });
assert.deepEqual(sendProgress([item(2_516_582, 'done', 100), item(19_608_371, 'uploading', 45), item(3_670_016, 'waiting')]),
  { left: 2, sent: 2_516_582 + 8_823_766, total: 25_794_969, percent: 43 });
assert.deepEqual(sendProgress([item(0, 'done', 100), item(0, 'done', 100)]), { left: 0, sent: 0, total: 0, percent: 100 });
assert.deepEqual(sendProgress([item(0, 'waiting')]), { left: 1, sent: 0, total: 0, percent: 0 });

// 剩余时间, rounded down.
const NOW = Date.parse('2026-11-20T06:30:00Z');
const at = (min) => new Date(NOW + min * 60_000 + 30_000).toISOString();
assert.equal(remaining(at(7 * 1440 - 60), NOW), '还剩 6 天 23 小时');
assert.equal(remaining(at(6 * 1440), NOW), '还剩 6 天');
assert.equal(remaining(at(6 * 1440 + 59), NOW), '还剩 6 天');
assert.equal(remaining(at(5 * 60 + 20), NOW), '还剩 5 小时 20 分');
assert.equal(remaining(at(5 * 60), NOW), '还剩 5 小时');
assert.equal(remaining(at(12), NOW), '还剩 12 分钟');
assert.equal(remaining(at(0), NOW), '还剩 0 分钟');
assert.equal(remaining(new Date(NOW).toISOString(), NOW), '已到期');
console.log('public ok');
