// node src/lib/errors.test.mjs — a refusal reads as the counter shows it, with times on the school's clock.
import assert from 'node:assert/strict';
const { explain } = await import('./errors.ts');
assert.deepEqual(explain('STALE_DUTY', { started_at: '2026-11-08T23:45:00Z' }),
  { title: '上次上班还没下班', text: '这次上班从 11月9日 07:45 开始，已经跨天。请先下班，再重新上班办理业务。' });
assert.equal(explain('TERM_NOT_ENDED', { ends_on: '2027-01-20' }).text, '1月20日 之后才能结转。');
assert.equal(explain('TERM_OVERLAP', { term: '2026 学年第一学期' }).text, '和「2026 学年第一学期」的日期重叠，请调整开始日或结束日。');
assert.equal(explain('INVALID_INPUT', { field: 'starts_on' }).text, '请检查开始日。');

console.log('errors ok');
