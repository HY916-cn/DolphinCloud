// node src/lib/errors.test.mjs — a refusal reads as the counter shows it, with times on the school's clock.
import assert from 'node:assert/strict';
const { explain } = await import('./errors.ts');
assert.deepEqual(explain('STALE_DUTY', { started_at: '2026-11-08T23:45:00Z' }),
  { title: '上次上班还没下班', text: '这次上班从 11月9日 07:45 开始，已经跨天。请先下班，再重新上班办理业务。' });
assert.equal(explain('TERM_NOT_ENDED', { ends_on: '2027-01-20' }).text, '1月20日 之后才能结转。');
assert.equal(explain('TERM_OVERLAP', { term: '2026 学年第一学期' }).text, '和「2026 学年第一学期」的日期重叠，请调整开始日或结束日。');
assert.equal(explain('INVALID_INPUT', { field: 'starts_on' }).text, '请检查开始日。');
// Only loans: a 定期 opens in the holidays and past the term's end.
assert.deepEqual(explain('TERM_TOO_LONG', { ends_on: '2027-01-20', max_weeks: 4 }), { title: '期限超过学期末', text: '本学期 1月20日 结束，最长只能选 4 周。' });
assert.equal(explain('TERM_TOO_LONG', { ends_on: '2027-01-20', max_weeks: null }).text, '本学期 1月20日 结束，不到一周，不能贷款。');
assert.equal(explain('NO_TERM').text, '还没有登记当前学期，暂时不能办理贷款。');
assert.equal(explain('INVALID_INPUT', { field: 'term_rates' }).text, '请检查定期周利率。');

assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'term_open' }).text, '这笔定期已经到期或提前支取，不能再冲正。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'term_close' }).text, '已过到期日，不能再冲正这笔提前支取。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'deposit' }).text, '只能冲正本人今天办理的业务，其他情况请联系银行管理员。');

assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'loan' }).text, '这笔贷款已经开始还款，不能再冲正。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'repay' }).text, '只能冲正这笔贷款最近的一笔还款。');

assert.equal(explain('CREDIT_TOO_LOW', { score: 350, min_score: 400 }).text, '信用分 400 分以上才能贷款，现在是 350 分。');
assert.equal(explain('OVER_CREDIT_LIMIT', { limit: 165 }).text, '按现在的信用分，最多能贷 165 HTB。');
assert.equal(explain('REPAY_TOO_MUCH', { max: 100 }).text, '这笔贷款现在一共只需还 100 HTB。');
assert.equal(explain('INVALID_AMOUNT', { payoff: 100 }).text, '还清本金要连利息零头一起付，全部结清是 100 HTB。');
assert.equal(explain('INVALID_AMOUNT').text, '请输入正整数金额，并使用柜台列出的面额。');
assert.equal(explain('LOAN_OUTSTANDING').text, '先还清这笔贷款，才能办新贷款或新定期。');
assert.equal(explain('LOAN_OUTSTANDING', { student_no: '20260001', loan_no: 'DK2611120001', name: '张小明' }).text, '张小明 还有贷款没还清，结清后才能注销。');
assert.equal(explain('INVALID_INPUT', { field: 'purpose' }).text, '请检查用途。');
assert.equal(explain('INVALID_INPUT', { field: 'periods' }).text, '请检查期数。');
assert.equal(explain('INVALID_INPUT', { field: 'loan_id', status: 'closed' }).text, '这笔贷款已经结清。');
assert.equal(explain('INVALID_INPUT', { field: 'loan_id', status: 'reversed' }).text, '这笔贷款已经作废。');
assert.equal(explain('NO_TERM', { business: '贷款' }).text, '现在不在学期内，不能贷款。');

// 考勤与工资 (M18): the attendance pages pass `payroll`; the counter's refusals read as before.
assert.equal(explain('SELF_SERVICE_FORBIDDEN', { payroll: true }).title, '不能登记自己的班次');
assert.equal(explain('SELF_SERVICE_FORBIDDEN').title, '不能为自己办理');
assert.equal(explain('ATTENDANCE_REVIEWED', { payroll: true }).text, '这个班次已经作废。');
assert.equal(explain('ATTENDANCE_PAID').text, '这个班次的工资已经发放，不能作废。');
assert.equal(explain('ALREADY_EXISTS', { field: 'attendance' }).text, '这个班次已经有记录。');
assert.equal(explain('INVALID_INPUT', { field: 'rates', role: 'teller' }).text, '工资标准每格 1～10000 HTB。');
assert.equal(explain('INVALID_INPUT', { field: 'user_id', payroll: true }).text, '运维员不参与考勤。');
assert.equal(explain('INVALID_INPUT', { field: 'user_id' }).text, '请检查账号。');

console.log('errors ok');
