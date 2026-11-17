// node src/lib/format.test.mjs — checks the wording rules the screens rely on.
import assert from 'node:assert/strict';
const { formatAmount, formatCenti, formatPercent, formatNet, formatPoints, formatRate, formatSigned, formatTime, maskName, periodOf, shanghai, shiftAt, shiftDay, signClass, trendClass } = await import('./format.ts');
assert.equal(formatAmount(1280), '1,280');
assert.equal(formatSigned(50), '+50');
assert.equal(formatSigned(-20), '−20');
assert.equal(formatNet(-20), '−20');
assert.equal(formatNet(1280), '1,280');
assert.equal(formatNet(0), '0');
// 红涨绿跌: + red, − green, 0 uncoloured.
assert.deepEqual([50, -20, 0].map(signClass), ['is-in', 'is-out', '']);
assert.deepEqual([0.25, -0.5, 0].map(trendClass), ['is-up', 'is-down', '']);
assert.equal(formatTime('2026-10-27T06:20:00Z', new Date('2026-12-01T00:00:00Z')), '10月27日 14:20');
assert.equal(formatTime('2025-01-02T01:05:00Z', new Date('2026-12-01T00:00:00Z')), '2025年1月2日 09:05');
assert.equal(maskName('张小明'), '张*明');
assert.equal(maskName('李四'), '李*');
assert.equal(maskName('欧阳小明'), '欧**明');
assert.equal(maskName('王'), '王');
assert.deepEqual(periodOf('day', '2026-11-04'), ['2026-11-04', '2026-11-04']);
assert.deepEqual(periodOf('week', '2026-11-04'), ['2026-11-02', '2026-11-04']); // a Wednesday; the week starts on Monday
assert.deepEqual(periodOf('week', '2026-11-08'), ['2026-11-02', '2026-11-08']); // Sunday
assert.deepEqual(periodOf('month', '2026-11-04'), ['2026-11-01', '2026-11-04']);
assert.deepEqual(periodOf('last-month', '2026-03-15'), ['2026-02-01', '2026-02-28']);
assert.deepEqual(periodOf('last-month', '2026-01-10'), ['2025-12-01', '2025-12-31']);
assert.equal(shiftDay('2026-11-01', -1), '2026-10-31');
assert.equal(shiftAt(new Date('2026-11-02T05:29:59Z')), 'am'); // 13:29:59 in Shanghai
assert.equal(shiftAt(new Date('2026-11-02T05:30:00Z')), 'pm');
assert.equal(shiftAt(new Date('2026-11-02T16:00:00Z')), 'am'); // 00:00 the next day
assert.deepEqual((({ year, month, day, hour, minute }) => [year, month, day, hour, minute])(shanghai(new Date('2026-08-31T16:05:00Z'))), ['2026', '9', '1', '00', '05']); // past midnight in Shanghai

console.log('format ok');

// 利率 without trailing zeros, at most 4 decimals; 待入账利息 always with two.
assert.equal(formatRate(2.08), '2.08%');
assert.equal(formatRate(2), '2%');
assert.equal(formatRate(6.2667), '6.2667%');
assert.equal(formatRate(2.6), '2.6%');
assert.equal(formatRate(1.23456), '1.2346%');
assert.equal(formatCenti(37), '0.37');
assert.equal(formatCenti(0), '0.00');
assert.equal(formatCenti(105), '1.05');
assert.equal(formatCenti(123456), '1,234.56');
assert.equal(formatCenti(-12), '−0.12');
assert.equal(formatCenti(-120), '−1.20');
assert.equal(formatPoints(0.25), '+0.25');
assert.equal(formatPoints(-0.5), '−0.50');
assert.equal(formatPoints(0), '0.00');
assert.equal(formatPercent(40), '40.0%');
assert.equal(formatPercent(2.3456, true), '+2.3%');
assert.equal(formatPercent(-1.25, true), '−1.3%');

// 轧账: a duty's span and the businesses reversed after it.
{
  const { dutySpan, reversedNote } = await import('./format.ts');
  const now = new Date('2026-11-16T04:00:00Z');
  assert.equal(dutySpan('2026-11-12T23:45:00Z', '2026-11-13T04:30:00Z', now), '11月13日 07:45 – 12:30');
  assert.equal(dutySpan('2026-11-12T23:45:00Z', '2026-11-13T16:10:00Z', now), '11月13日 07:45 – 11月14日 00:10');
  assert.equal(dutySpan('2026-11-15T23:45:00Z', null, now), '11月16日 07:45 起');
  assert.equal(reversedNote([], '2026-11-13T04:30:00Z', now), '');
  assert.equal(reversedNote([{ reversed_at: '2026-11-13T06:05:00Z' }, { reversed_at: '2026-11-13T06:05:00Z' }], '2026-11-13T04:30:00Z', now),
    '其中 2 笔已于 14:05 冲正');
  assert.equal(reversedNote([{ reversed_at: '2026-11-13T06:05:00Z' }, { reversed_at: '2026-11-17T01:10:00Z' }], '2026-11-13T04:30:00Z', now),
    '其中 2 笔已于 14:05、11月17日 09:10 冲正');
}
