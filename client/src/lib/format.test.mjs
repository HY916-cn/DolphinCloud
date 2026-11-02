// node src/lib/format.test.mjs — checks the wording rules the screens rely on.
import assert from 'node:assert/strict';
const { formatAmount, formatSigned, formatTime, maskName, periodOf } = await import('./format.ts');
assert.equal(formatAmount(1280), '1,280');
assert.equal(formatSigned(50), '+50');
assert.equal(formatSigned(-20), '−20');
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
console.log('format ok');
