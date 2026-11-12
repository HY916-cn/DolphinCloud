// node src/lib/errors.test.mjs — a refusal reads as the counter shows it, with times on the school's clock.
import assert from 'node:assert/strict';
const { explain } = await import('./errors.ts');
assert.deepEqual(explain('STALE_DUTY', { started_at: '2026-11-08T23:45:00Z' }),
  { title: '上次上班还没下班', text: '这次上班从 11月9日 07:45 开始，已经跨天。请先下班，再重新上班办理业务。' });
assert.equal(explain('TERM_NOT_ENDED', { ends_on: '2027-01-20' }).text, '1月20日 之后才能结转。');
assert.equal(explain('TERM_OVERLAP', { term: '2026 学年第一学期' }).text, '和「2026 学年第一学期」的日期重叠，请调整开始日或结束日。');
assert.equal(explain('INVALID_INPUT', { field: 'starts_on' }).text, '请检查开始日。');
assert.equal(explain('TERM_TOO_LONG', { ends_on: '2027-01-20', max_weeks: 4 }).text, '本学期 1月20日 结束，最长只能选 4 周。');
assert.equal(explain('TERM_TOO_LONG', { ends_on: '2027-01-20', max_weeks: null }).text, '本学期 1月20日 结束，已经放不下定期。');
assert.equal(explain('NO_TERM', { business: '开定期' }).text, '现在不在学期内，不能开定期。');

assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'term_open' }).text, '这笔定期已经到期或提前支取，不能再冲正。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'term_close' }).text, '已过到期日，不能再冲正这笔提前支取。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'deposit' }).text, '只能冲正本人今天办理的业务，其他情况请联系银行管理员。');

console.log('errors ok');
