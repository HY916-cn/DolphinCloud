// lib/format's and lib/term's writing, copied so this file loads on its own, as the unit tests load it: 1,280; 0.37; 5.89%;
// 2026-12-10 → 12月10日.
const formatAmount = (n: number) => Math.abs(n).toLocaleString('en-US');
const formatCenti = (c: number) => `${formatAmount(Math.trunc(c / 100))}.${String(c % 100).padStart(2, '0')}`;
const formatRate = (r: number) => `${Number(r.toFixed(4))}%`;
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// 贷款 (PHASE-2.md §10.3–10.9; design system Loan): a loans row with its plan and payments, the counter's loan_quote and
// loan_preview, and how the counter, 我的贷款 and the back office write them. What a payment pays (next.amount, payoff,
// interest_centi) comes from the server; dates are YYYY-MM-DD and compare as strings.
export type LoanStatus = 'active' | 'overdue' | 'closed' | 'reversed';
export type LoanPlan = 'installment' | 'bullet';
export type LoanPeriod = { seq: number; due_on: string; principal: number; paid: number; overdue_at: string | null };
export type Loan = {
  id: string; loan_no: string; student_no: string; principal: number; remaining: number; rate: number; score: number;
  plan: LoanPlan; periods: number; purpose: string; disbursed_via: 'account' | 'cash'; interest_centi: number; status: LoanStatus;
  opened_on: string; closed_on: string | null; terminated_at: string | null; terminated_by: string | null; terminate_reason: string | null;
};
export type LoanDetail = Loan & {
  penalty_rate: number; payoff: number | null; next: { seq: number; due_on: string; amount: number } | null; schedule: LoanPeriod[];
  payments: { txn_id: string; txn_no: string; created_at: string; amount: number; interest: number; principal: number; auto: boolean; payment: 'account' | 'cash'; status: 'normal' | 'reversed' }[];
};
export type LoanQuote = {
  student_no: string; score: number; limit: number | null; rate: number; penalty_rate: number; max_weeks: number; max_periods: number;
  term: { id: string; name: string; ends_on: string } | null; balance: number;
  blocked: 'STUDENT_INACTIVE' | 'LOAN_OUTSTANDING' | 'CREDIT_TOO_LOW' | null; loan: LoanDetail | null;
};
export type LoanPreview = {
  rate: number; penalty_rate: number; interest: number; interest_centi: number;
  schedule: { seq: number; due_on: string; principal: number; interest_centi: number; interest: number }[];
};

// "分 4 期，每周一期", "一次还清，4 周后"; `brief` as the 流水 says it: "分 4 期", "一次还清 4 周".
export const planText = (plan: LoanPlan, n: number, brief = false) =>
  plan === 'installment' ? (brief ? `分 ${n} 期` : `分 ${n} 期，每周一期`) : brief ? `一次还清 ${n} 周` : `一次还清，${n} 周后`;
export const rateText = (r: number) => `${formatRate(r)}/周`;

// The new loan's amount field: the range, or over the limit.
export const amountHint = (amount: number, limit: number) => (amount > limit
  ? { text: `超过贷款额度：按现在的信用分最多能贷 ${formatAmount(limit)} HTB`, error: true }
  : { text: `1 HTB 起，最多 ${formatAmount(limit)} HTB`, error: false });

// The stepper's last due day, a week a period from today: 12月10日.
export const lastDue = (today: string, n: number) => monthDay(shiftDay(today, 7 * n));

const unpaid = (p: LoanPeriod) => p.paid < p.principal;

// The plan, a line a period: "第 2 期 · 11月24日 应还本金 32 HTB" (one 一次还清 line has no number), how far it is paid, and
// its tag: paid (a 0 HTB period too), overdue, the first one still to pay (current), or waiting.
export function periodLines(schedule: LoanPeriod[], plan: LoanPlan) {
  const current = schedule.find((p) => unpaid(p) && !p.overdue_at)?.seq;
  return [...schedule].sort((a, b) => a.seq - b.seq).map((p) => ({
    seq: p.seq,
    title: `${plan === 'installment' ? `第 ${p.seq} 期 · ` : ''}${monthDay(p.due_on)} 应还本金 ${formatAmount(p.principal)} HTB`,
    note: !unpaid(p) ? '已还清' : p.paid ? `已还 ${formatAmount(p.paid)} HTB，还差 ${formatAmount(p.principal - p.paid)} HTB` : '还没还',
    tag: !unpaid(p) ? 'paid' as const : p.overdue_at ? 'overdue' as const : p.seq === current ? 'current' as const : 'waiting' as const,
  }));
}

// What is overdue: "11月17日 那期还差 20 HTB", or from the first of several; null when nothing is.
export function overdueText(schedule: LoanPeriod[]) {
  const late = schedule.filter((p) => p.overdue_at && unpaid(p)).sort((a, b) => a.seq - b.seq);
  if (!late.length) return null;
  const short = late.reduce((s, p) => s + p.principal - p.paid, 0);
  return { short, text: late.length === 1 ? `${monthDay(late[0].due_on)} 那期还差 ${formatAmount(short)} HTB`
    : `${monthDay(late[0].due_on)} 起 ${late.length} 期共还差 ${formatAmount(short)} HTB` };
}

// How a repayment of `amount` splits as the server pays it (§10.4): the interest's whole HTB first, then the principal;
// the payment that settles it all (payoff) pays the interest rounded up.
export function repaySplit(loan: Pick<LoanDetail, 'remaining' | 'interest_centi' | 'payoff'>, amount: number) {
  const interest = loan.payoff !== null && amount >= loan.payoff ? loan.payoff - loan.remaining : Math.min(amount, Math.floor(loan.interest_centi / 100));
  return { interest, principal: amount - interest };
}

// The repayment field's problem, if any: more than settles it all; the principal and the interest's whole HTB but not its
// 零头, which the server refuses (loan_take: paying the principal off takes the interest rounded up), with the most a
// partial payment can be; or more than 活期 when paid from the account.
export function repayProblem(loan: Pick<LoanDetail, 'remaining' | 'interest_centi'> & { payoff: number }, amount: number, payment: 'account' | 'cash', balance: number) {
  const { payoff } = loan;
  if (amount > payoff) return `这笔贷款现在一共只需还 ${formatAmount(payoff)} HTB。`;
  const gap = loan.remaining + Math.floor(loan.interest_centi / 100);
  if (amount === gap && loan.interest_centi % 100 > 0) return `还清需要 ${formatAmount(payoff)} HTB；不还清时最多还 ${formatAmount(gap - 1)} HTB。`;
  if (payment === 'account' && amount > balance) return `余额不足：活期余额 ${formatAmount(balance)} HTB，还差 ${formatAmount(amount - balance)} HTB`;
  return null;
}

// The next payment as a student or the back office reads it from the tables (no `next`): the first period still to pay
// (`upcoming`: not counting overdue ones), what principal is left of it, and that with the interest's whole HTB, or rounded
// up when it is all that is left (as next.amount and payoff are made).
export function nextPayment(loan: Pick<Loan, 'remaining' | 'interest_centi'> & { loan_periods: LoanPeriod[] }, upcoming = false) {
  const p = [...loan.loan_periods].sort((a, b) => a.seq - b.seq).find((x) => unpaid(x) && !(upcoming && x.overdue_at));
  if (!p) return null;
  const principal = p.principal - p.paid;
  const interest = Math.floor(loan.interest_centi / 100);
  return { due_on: p.due_on, principal, interest, amount: principal + (principal >= loan.remaining ? Math.ceil(loan.interest_centi / 100) : interest) };
}

// 我的贷款's open loan: "借了 130 HTB，还剩 [98 HTB] 没还" and "下次 11月24日 还本金 32 HTB，利息约 1 HTB · 5.89%/周".
export function myLoanLine(loan: Loan & { loan_periods: LoanPeriod[] }) {
  const next = nextPayment(loan, true);
  return {
    lead: `借了 ${formatAmount(loan.principal)} HTB，还剩 `, amount: `${formatAmount(loan.remaining)} HTB`,
    note: [next && `下次 ${monthDay(next.due_on)} 还本金 ${formatAmount(next.principal)} HTB，利息约 ${formatAmount(next.interest)} HTB`, rateText(loan.rate)].filter(Boolean).join(' · '),
  };
}

// A settled loan: "贷款 60 HTB · 用途 买书", "10月13日 已结清 · 共付利息 3 HTB" (not the reversed payments).
export function closedLine(loan: Loan & { loan_payments: { interest: number; txns: { status: string } | null }[] }) {
  const interest = loan.loan_payments.filter((p) => p.txns?.status !== 'reversed').reduce((s, p) => s + p.interest, 0);
  return { title: `贷款 ${formatAmount(loan.principal)} HTB · 用途 ${loan.purpose}`, note: `${monthDay(loan.closed_on ?? loan.opened_on)} 已结清 · 共付利息 ${formatAmount(interest)} HTB` };
}

// The 首页 贷款 line: "剩余 98 HTB" with "11月24日 应还 33 HTB", "已逾期 · 应还 20 HTB" (danger), or "没有".
export function homeLoanLine(loan: (Loan & { loan_periods: LoanPeriod[] }) | null) {
  if (!loan) return { text: '没有', note: null, danger: false };
  const late = overdueText(loan.loan_periods);
  if (loan.status === 'overdue' && late) return { text: `已逾期 · 应还 ${formatAmount(late.short)} HTB`, note: null, danger: true };
  const next = nextPayment(loan);
  return { text: `剩余 ${formatAmount(loan.remaining)} HTB`, note: next && `${monthDay(next.due_on)} 应还 ${formatAmount(next.amount)} HTB`, danger: false };
}

// The open loan (还款中 or 已逾期) of a student's loans, if any.
export const openLoan = <T extends Pick<Loan, 'status'>>(list: T[]) => list.find((l) => l.status === 'active' || l.status === 'overdue') ?? null;

// Loans as a list shows them: overdue first, then the latest paid out first.
export const byUrgency = <T extends Pick<Loan, 'status' | 'opened_on' | 'loan_no'>>(list: T[]) =>
  [...list].sort((a, b) => Number(b.status === 'overdue') - Number(a.status === 'overdue') || b.opened_on.localeCompare(a.opened_on) || b.loan_no.localeCompare(a.loan_no));

// 估算利息 "约 7.66", two decimals, from loan_preview's interest_centi.
export const about = (centi: number) => `约 ${formatCenti(centi)}`;
export const interestText = (centi: number) => `${formatCenti(centi)} HTB`;
