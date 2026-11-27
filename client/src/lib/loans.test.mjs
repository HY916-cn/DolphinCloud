// node src/lib/loans.test.mjs — 贷款 as the counter, 我的贷款 and the back office write them.
import assert from 'node:assert/strict';
const {
  amountHint, byUrgency, closedLine, homeLoanLine, lastDue, myLoanLine, nextPayment, openLoan, overdueText, periodLines, planText, repayProblem, repaySplit,
} = await import('./loans.ts');

assert.equal(planText('installment', 4), '分 4 期，每周一期');
assert.equal(planText('bullet', 4), '一次还清，4 周后');
assert.equal(planText('installment', 4, true), '分 4 期');
assert.equal(planText('bullet', 4, true), '一次还清 4 周');


assert.deepEqual(amountHint(0, 165), { text: '1 HTB 起，最多 165 HTB', error: false });
assert.deepEqual(amountHint(165, 165), { text: '1 HTB 起，最多 165 HTB', error: false });
assert.deepEqual(amountHint(166, 165), { text: '超过贷款额度：按现在的信用分最多能贷 165 HTB', error: true });

assert.equal(lastDue('2026-11-12', 4), '12月10日');
assert.equal(lastDue('2026-11-12', 8), '1月7日');

const period = (seq, due_on, principal, paid = 0, overdue_at = null) => ({ seq, due_on, principal, paid, overdue_at });
const plan = [
  period(1, '2026-11-10', 32, 32), period(2, '2026-11-17', 32, 12, '2026-11-18T00:00:00+08:00'),
  period(3, '2026-11-24', 32), period(4, '2026-12-01', 34),
];
assert.deepEqual(periodLines(plan, 'installment').map((l) => [l.title, l.note, l.tag]), [
  ['第 1 期 · 11月10日 应还本金 32 HTB', '已还清', 'paid'],
  ['第 2 期 · 11月17日 应还本金 32 HTB', '已还 12 HTB，还差 20 HTB', 'overdue'],
  ['第 3 期 · 11月24日 应还本金 32 HTB', '还没还', 'current'],
  ['第 4 期 · 12月1日 应还本金 34 HTB', '还没还', 'waiting'],
]);
// Paying more spreads over the later periods; one left at 0 HTB is paid.
assert.equal(periodLines([period(1, '2026-11-19', 0), period(2, '2026-11-26', 20)], 'installment')[0].tag, 'paid');
assert.deepEqual(periodLines([period(1, '2026-12-10', 130)], 'bullet')[0].title, '12月10日 应还本金 130 HTB');

assert.deepEqual(overdueText(plan), { short: 20, text: '11月17日 那期还差 20 HTB' });
assert.deepEqual(overdueText([...plan.slice(0, 2), { ...plan[2], overdue_at: 'x' }]), { short: 52, text: '11月17日 起 2 期共还差 52 HTB' });
assert.equal(overdueText(plan.slice(0, 1)), null);

// Interest's whole HTB first; the payment that settles it all pays it rounded up (payoff = 98 + 2).
const open = { remaining: 98, interest_centi: 137, payoff: 100 };
assert.deepEqual(repaySplit(open, 33), { interest: 1, principal: 32 });
assert.deepEqual(repaySplit(open, 1), { interest: 1, principal: 0 });
assert.deepEqual(repaySplit({ ...open, interest_centi: 37 }, 10), { interest: 0, principal: 10 });
assert.deepEqual(repaySplit(open, 100), { interest: 2, principal: 98 });

assert.equal(repayProblem(open, 101, 'cash', 0), '这笔贷款现在一共只需还 100 HTB。');
assert.equal(repayProblem(open, 33, 'account', 20), '余额不足：活期余额 20 HTB，还差 13 HTB');
assert.equal(repayProblem(open, 33, 'cash', 20), null);
assert.equal(repayProblem(open, 33, 'account', 33), null);
// The principal and the interest's whole HTB (98 + 1) but not its 零头: the server takes 98, so it asks for 100 or at most 98.
assert.equal(repayProblem(open, 99, 'cash', 0), '还清需要 100 HTB；不还清时最多还 98 HTB。');
assert.equal(repayProblem(open, 99, 'account', 500), '还清需要 100 HTB；不还清时最多还 98 HTB。');
assert.equal(repayProblem(open, 98, 'account', 500), null);
assert.equal(repayProblem(open, 100, 'account', 500), null);
assert.deepEqual(repaySplit(open, 98), { interest: 1, principal: 97 });
// Interest with no 零头: 98 + 2 is the payoff itself.
assert.equal(repayProblem({ remaining: 98, interest_centi: 200, payoff: 100 }, 100, 'cash', 0), null);
assert.equal(repayProblem({ remaining: 98, interest_centi: 200, payoff: 100 }, 99, 'cash', 0), null);

const loan = {
  id: 'l', loan_no: 'DK2611030001', student_no: '20260001', principal: 130, remaining: 86, rate: 5.89, score: 680, plan: 'installment', periods: 4,
  purpose: '买文具', disbursed_via: 'account', interest_centi: 137, status: 'overdue', opened_on: '2026-11-03', closed_on: null,
  terminated_at: null, terminated_by: null, terminate_reason: null, loan_periods: plan,
};
assert.deepEqual(nextPayment(loan), { due_on: '2026-11-17', principal: 20, interest: 1, amount: 21 });
assert.deepEqual(nextPayment(loan, true), { due_on: '2026-11-24', principal: 32, interest: 1, amount: 33 });
// The last period is the rest of it: the interest rounded up, as payoff.
assert.deepEqual(nextPayment({ ...loan, remaining: 34, loan_periods: [period(4, '2026-12-01', 34)] }), { due_on: '2026-12-01', principal: 34, interest: 1, amount: 36 });
assert.equal(nextPayment({ ...loan, loan_periods: [period(1, '2026-11-10', 32, 32)] }), null);

assert.deepEqual(myLoanLine(loan), { lead: '借了 130 HTB，还剩 ', amount: '86 HTB', note: '下次 11月24日 还本金 32 HTB，利息约 1 HTB · 5.89%/周' });
assert.equal(myLoanLine({ ...loan, loan_periods: plan.slice(0, 2) }).note, '5.89%/周');

assert.deepEqual(homeLoanLine(loan), { text: '已逾期 · 应还 20 HTB', note: null, danger: true });
assert.deepEqual(homeLoanLine({ ...loan, status: 'active', loan_periods: [plan[0], { ...plan[1], paid: 32, overdue_at: null }, plan[2], plan[3]] }),
  { text: '剩余 86 HTB', note: '11月24日 应还 33 HTB', danger: false });
assert.deepEqual(homeLoanLine(null), { text: '没有', note: null, danger: false });

assert.deepEqual(closedLine({ ...loan, principal: 60, purpose: '买书', status: 'closed', closed_on: '2026-10-13',
  loan_payments: [{ interest: 2, txns: { status: 'normal' } }, { interest: 1, txns: { status: 'normal' } }, { interest: 5, txns: { status: 'reversed' } }] }),
{ title: '贷款 60 HTB · 用途 买书', note: '10月13日 已结清 · 共付利息 3 HTB' });

const a = { status: 'closed', opened_on: '2026-11-10', loan_no: 'DK2611100003' };
const b = { status: 'overdue', opened_on: '2026-10-01', loan_no: 'DK2610010001' };
const c = { status: 'active', opened_on: '2026-11-10', loan_no: 'DK2611100004' };
assert.deepEqual(byUrgency([a, b, c]), [b, c, a]);
assert.equal(openLoan([a, c]), c);
assert.equal(openLoan([a]), null);

console.log('loans ok');
