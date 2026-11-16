import { useQuery } from '@tanstack/react-query';
import { formatCenti, formatRate } from '@/lib/format';
import { byWeeks, maturityCenti, weekCenti, type TermRates } from '@/lib/rates';
import { call } from '@/lib/rpc';
import { monthDay } from '@/lib/term';
import { CreditFailed } from './Credit';
import { KvLoading } from './Skeleton';

// interest_profile (PHASE-2.md §15): the week's anchor (week_start null: none published yet, the initial one stands),
// the weekly rates at the student's score (loan null: too low to borrow) and 攒着的利息 (not yet paid in) in 0.01 HTB.
export type InterestProfile = {
  student_no: string; score: number; week_start: string | null; anchor: number;
  rates: { current: number; term: TermRates; loan: number | null }; pending_centi: number;
};
export const useInterest = () => useQuery({ queryKey: ['interest', 'me'], queryFn: () => call<InterestProfile>('interest_profile', {}) });

// 本周利率 (design system StudentCreditPage): every rate at the student's score as an example on 100 HTB, the weekly rate
// in small type below, and where the rates come from.
export function RateCard({ min }: { min: number }) {
  const interest = useInterest();
  const p = interest.data;
  const week = (r: number) => <small>{formatRate(r)}/周</small>;
  const htb = (centi: number) => <b>{formatCenti(centi)} HTB</b>;
  return (
    <>
      <p className="dc-list-title">{p ? `本周利率 · 按 ${p.score} 分` : '本周利率'}</p>
      {interest.isError ? <CreditFailed title="暂时无法读取本周利率" onRetry={() => interest.refetch()} />
        : !p ? <KvLoading rows={5} /> : (
          <section className="dc-card dc-stack" aria-label="本周利率">
            <ul className="dc-rate-list">
              <li>活期存 100 HTB，一周多得约 {htb(weekCenti(p.rates.current))}{week(p.rates.current)}</li>
              {byWeeks(p.rates.term).map(([w, r]) => (
                <li key={w}>定期 {w} 周存 100 HTB，到期拿回 {htb(maturityCenti(r, w))}{week(r)}</li>
              ))}
              <li>{p.rates.loan === null ? `${min} 分以上才能贷款` : <>借 100 HTB，一周利息约 {htb(weekCenti(p.rates.loan))}{week(p.rates.loan)}</>}</li>
            </ul>
            <p className="dc-caption">
              信用分越高，活期多得，借钱少付；定期利率是固定的。{!p.week_start ? '本周利率还没有公布，先按初始利率显示。每周一公布。'
                : `${monthDay(p.week_start)}公布，每周一更新。`}
            </p>
          </section>
        )}
    </>
  );
}
