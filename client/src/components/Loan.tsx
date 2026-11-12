import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { byUrgency, closedLine, myLoanLine, openLoan, overdueText, periodLines, type Loan, type LoanPeriod, type LoanPlan, type LoanStatus } from '@/lib/loans';
import { supabase } from '@/lib/supabase';
import { Icon, Notice } from './ui';

// 贷款 (design system Loan): the status tags, the plan a period a line, and a student's own loans (我的贷款).
export const LOAN_TAGS: Record<LoanStatus, ReactNode> = {
  active: <span className="dc-tag"><Icon name="clock" />还款中</span>,
  overdue: <span className="dc-tag dc-tag-danger"><Icon name="warning" />已逾期</span>,
  closed: <span className="dc-tag dc-tag-success"><Icon name="success" />已结清</span>,
  reversed: <span className="dc-tag">已作废</span>,
};
export const PERIOD_TAGS = {
  paid: <span className="dc-tag dc-tag-success"><Icon name="success" />已还清</span>,
  overdue: <span className="dc-tag dc-tag-danger"><Icon name="warning" />已逾期</span>,
  current: <span className="dc-tag dc-tag-pending"><Icon name="clock" />本期</span>,
  waiting: <span className="dc-tag">待还</span>,
};

// 还款计划: each period, how far it is paid, and its tag.
export function PeriodList({ schedule, plan }: { schedule: LoanPeriod[]; plan: LoanPlan }) {
  return (
    <ul className="dc-list" aria-label="还款计划">
      {periodLines(schedule, plan).map((l) => (
        <li key={l.seq}><div className="dc-list-item"><span>{l.title}<small>{l.note}</small></span>{PERIOD_TAGS[l.tag]}</div></li>
      ))}
    </ul>
  );
}

// What the loan pages take from settings: the 罚息 multiplier, and the points an overdue loan costs each week.
export function useLoanSettings() {
  return useQuery({
    queryKey: ['settings', 'loan'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('key,value').in('key', ['penalty_multiplier', 'credit_rules']);
      if (error) throw error;
      const v = Object.fromEntries(data.map((r) => [r.key, r.value]));
      return { multiplier: Number(v.penalty_multiplier), overdueWeek: Math.abs(Number(v.credit_rules?.overdue_week ?? 0)) };
    },
  }).data;
}

// A student's own loans with their plans and payments (RLS shows a student only their own), not the reversed ones,
// the open one first.
export type MyLoan = Loan & { loan_periods: LoanPeriod[]; loan_payments: { interest: number; txns: { status: string } | null }[] };
export function useMyLoans(studentNo: string) {
  return useQuery({
    queryKey: ['my-loans', studentNo],
    queryFn: async () => {
      const { data, error } = await supabase.from('loans').select('*, loan_periods(*), loan_payments(*, txns(status))')
        .eq('student_no', studentNo).neq('status', 'reversed').order('opened_on', { ascending: false });
      if (error) throw error;
      return byUrgency(data as MyLoan[]);
    },
  });
}

// 我的贷款: the open loan as a card with its plan (a notice above when overdue), then the settled ones a line each;
// none, how much the student may borrow now (`limit`, null below `min`).
export function MyLoans({ loans, limit, min }: { loans: MyLoan[]; limit: number | null | undefined; min: number }) {
  const open = openLoan(loans);
  const closed = loans.filter((l) => l.status === 'closed');
  const late = open?.status === 'overdue' ? overdueText(open.loan_periods) : null;
  if (!open && !closed.length) {
    return (
      <section className="dc-card">
        <p className="dc-caption">{limit ? `没有贷款。你现在最多能借 ${limit} HTB，在柜台申请。` : `没有贷款。信用分 ${min} 分以上才能申请。`}</p>
      </section>
    );
  }
  const line = open && myLoanLine(open);
  return (
    <>
      {late && <Notice tone="danger" title="贷款已逾期">{late.text}。请尽快到柜台还款，每晚会先从活期自动扣。</Notice>}
      {open && line && (
        <>
          <section className="dc-card dc-stack">
            <div className="dc-list-item"><span>{line.lead}<b>{line.amount}</b> 没还<small>{line.note}</small></span>{LOAN_TAGS[open.status]}</div>
          </section>
          <PeriodList schedule={open.loan_periods} plan={open.plan} />
        </>
      )}
      {closed.length > 0 && (
        <ul className="dc-list" aria-label="已结清的贷款">
          {closed.map((l) => {
            const c = closedLine(l);
            return <li key={l.id}><div className="dc-list-item"><span>{c.title}<small>{c.note}</small></span>{LOAN_TAGS.closed}</div></li>;
          })}
        </ul>
      )}
    </>
  );
}
