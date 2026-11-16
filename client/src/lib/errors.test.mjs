// node src/lib/errors.test.mjs — a refusal reads as the counter shows it, with times on the school's clock.
import assert from 'node:assert/strict';
const { explain } = await import('./errors.ts');
assert.deepEqual(explain('STALE_DUTY', { started_at: '2026-11-08T23:45:00Z' }),
  { title: '上次上班还没下班', text: '这次上班从 11月9日 07:45 开始，已经跨天。请先下班，再重新上班办理业务。' });
assert.equal(explain('TERM_NOT_ENDED', { ends_on: '2027-01-20' }).text, '1月20日 之后才能结转。');
assert.equal(explain('TERM_OVERLAP', { term: '2026 学年第一学期' }).text, '和「2026 学年第一学期」的日期重叠，请调整开始日或结束日。');
assert.equal(explain('INVALID_INPUT', { field: 'starts_on' }).text, '请检查开始日。');
assert.equal(explain('INVALID_INPUT', { field: 'term_rates' }).text, '请检查定期周利率。');

assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'term_open' }).text, '这笔定期已经到期或提前支取，不能再冲正。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'term_close' }).text, '已过到期日，不能再冲正这笔提前支取。');
// 理财 (design system Invest).
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'wealth_buy' }).text, '这笔理财已经开始计收益或已转回，不能再冲正。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'wealth_close' }).text, '已过到期日，不能再冲正这笔赎回。');
assert.equal(explain('INVALID_INPUT', { field: 'tier' }).text, '请选择档位。');
assert.equal(explain('INVALID_INPUT', { field: 'holding_id', status: 'matured' }).text, '这笔理财已经到期或冲正，不能赎回。');
assert.equal(explain('INVALID_INPUT', { field: 'change' }).text, '指数涨跌要在 −50% 到 50% 之间，最多 4 位小数。');
assert.equal(explain('INVALID_INPUT', { field: 'day', wealth: true }).text, '只能登记已经过去的工作日。');
assert.equal(explain('INVALID_INPUT', { field: 'note', wealth: true }).text, '请写明数据从哪里来，最多 200 字。');
assert.equal(explain('INVALID_INPUT', { field: 'day' }).text, '请检查日期。');
assert.equal(explain('INVALID_INPUT', { field: 'wealth_params' }).text, '请检查理财参数。');
assert.equal(explain('ALREADY_EXISTS', { field: 'day', wealth: true }).text, '这一天已经有行情，不能再登记。');
assert.equal(explain('LOAN_OUTSTANDING', { wealth: true }).text, '先还清这笔贷款，才能买理财。');
assert.equal(explain('LOAN_OUTSTANDING').text, '先还清这笔贷款，才能办新贷款或新定期。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'deposit' }).text, '只能冲正本人今天办理的业务，其他情况请联系银行管理员。');

assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'loan' }).text, '这笔贷款已经开始还款，不能再冲正。');
assert.equal(explain('REVERSAL_NOT_ALLOWED', { type: 'repay' }).text, '只能冲正这笔贷款最近的一笔还款。');
// 补录 and 编辑 (PHASE-2.md §10.11).
assert.deepEqual(explain('REVERSAL_NOT_ALLOWED', { type: 'deposit', edit: true }), { title: '不能编辑这笔流水', text: '这笔流水已经冲正或编辑过，不能再编辑。' });
assert.deepEqual(explain('OCCURRED_OUT_OF_RANGE', { from: '2026-10-31T16:00:00+00:00', to: '2026-11-15T07:30:00+00:00' }),
  { title: '时间不在补录范围内', text: '只能补录 11月1日 00:00 开户以后到现在之间发生的业务。' });
assert.equal(explain('INSUFFICIENT_BALANCE', { balance: 10, short: 30, at: '2026-11-12T06:20:00+00:00' }).text, '补录后，11月12日 14:20 起活期会不够，差 30 HTB。');
assert.equal(explain('INSUFFICIENT_BALANCE', { balance: 10, short: 30 }).text, '可用余额 10 HTB，还差 30 HTB，请减少金额。');

assert.deepEqual(explain('CREDIT_DISABLED'), { title: '信用分已暂停', text: '暂停期间所有学生按 600 分计，不能调整。重新开启后再调整。' });
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

// 考勤与工资 (M18): the attendance pages pass `payroll`; the counter's refusals read as before.
assert.equal(explain('SELF_SERVICE_FORBIDDEN', { payroll: true }).title, '不能登记自己的班次');
assert.equal(explain('SELF_SERVICE_FORBIDDEN').title, '不能为自己办理');
assert.equal(explain('ATTENDANCE_REVIEWED', { payroll: true }).text, '这个班次已经作废。');
assert.equal(explain('ATTENDANCE_PAID').text, '这个班次的工资已经发放，不能作废。');
assert.equal(explain('ALREADY_EXISTS', { field: 'attendance' }).text, '这个班次已经有记录。');
assert.equal(explain('INVALID_INPUT', { field: 'rates', role: 'teller' }).text, '工资标准每格 1～10000 HTB。');
assert.equal(explain('INVALID_INPUT', { field: 'user_id', payroll: true }).text, '运维员不参与考勤。');
assert.equal(explain('INVALID_INPUT', { field: 'user_id' }).text, '请检查账号。');

// 轧账 (M12): the pages pass `cash` (end, review, force).
assert.equal(explain('NOTE_REQUIRED', { diff: { 10: -1 }, cash: 'end' }).text, '现金和应有不一致，写明原因后才能下班。');
assert.equal(explain('NOTE_REQUIRED', { diff: { 10: -1 }, cash: 'review' }).text, '点出的现金和应有不一致，写明原因后才能复核通过。');
assert.equal(explain('NOTE_REQUIRED', { cash: 'review' }).title, '请写明原因');
assert.equal(explain('INVALID_INPUT', { field: 'note', cash: 'end' }).text, '原因最多 200 字。');
assert.equal(explain('INVALID_INPUT', { field: 'reason', cash: 'force' }).text, '请写明强制下班的原因，最多 200 字。');
assert.equal(explain('INVALID_INPUT', { field: 'reason' }).text, '请检查冲正原因。');
assert.equal(explain('INVALID_INPUT', { field: 'count', cash: 'review' }).text, '这次上班没有柜员实点，请录入点出的各面额张数。');
assert.equal(explain('INVALID_INPUT', { field: 'duty_id', status: 'done', cash: 'review' }).text, '这次上班已经复核过了。');
assert.equal(explain('INVALID_INPUT', { field: 'duty_id', status: 'open', cash: 'review' }).text, '柜员还在上班，下班后才能复核。');
assert.equal(explain('INVALID_INPUT', { field: 'duty_id', status: 'forced', cash: 'force' }).text, '这位柜员已经下班了。');
assert.equal(explain('INVALID_INPUT', { field: 'duty_id', status: 'pending', cash: 'force' }).text, '这位柜员已经下班了。');
assert.equal(explain('INVALID_INPUT', { field: 'duty_id', cash: 'force' }).text, '找不到这次上班，请刷新后再试。');
assert.equal(explain('INVALID_AMOUNT', { cash: 'end' }).text, '实点张数不对，请检查各面额。');
assert.equal(explain('OFF_DUTY').text, '请先在「考勤」点「上班」，再办理业务。');

console.log('errors ok');
