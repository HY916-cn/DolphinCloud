import { useQuery } from '@tanstack/react-query';
import { formatRate } from '@/lib/format';
import type { Weeks } from '@/lib/rates';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import { inTerm, monthDay } from '@/lib/term';
import { CreditFailed } from './Credit';
import { today } from './DatePicker';
import { KvLoading } from './Skeleton';

// interest_profile (PHASE-2.md §15): the week's anchor (week_start null: none published yet, the initial one stands),
// the weekly rates at the student's score (loan null: too low to borrow) and 待入账利息 in 0.01 HTB.
export type InterestProfile = {
  student_no: string; score: number; week_start: string | null; anchor: number;
  rates: { current: number; term: Record<Weeks, number>; loan: number | null }; pending_centi: number;
};
export const useInterest = () => useQuery({ queryKey: ['interest', 'me'], queryFn: () => call<InterestProfile>('interest_profile', {}) });

// Whether today (Asia/Shanghai) is in a term; undefined until the terms are read or when they cannot be.
export function useInTerm() {
  const terms = useQuery({
    queryKey: ['terms', 'dates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('starts_on,ends_on');
      if (error) throw error;
      return data;
    },
  });
  return terms.data && inTerm(terms.data, today());
}

// 本周利率 (design system StudentCreditPage): every weekly rate at the student's score, and where the rates come from.
export function RateCard({ min }: { min: number }) {
  const interest = useInterest();
  const term = useInTerm();
  const p = interest.data;
  const week = (r: number) => `${formatRate(r)}/周`;
  return (
    <>
      <p className="dc-list-title">{p ? `本周利率 · 按 ${p.score} 分` : '本周利率'}</p>
      {interest.isError ? <CreditFailed title="暂时无法读取本周利率" onRetry={() => interest.refetch()} />
        : !p ? <KvLoading rows={5} /> : (
          <section className="dc-card dc-stack" aria-label="本周利率">
            <dl className="dc-kv">
              <div><dt>活期</dt><dd>{week(p.rates.current)}</dd></div>
              {(['2', '4', '8'] as const).map((w) => <div key={w}><dt>定期 {w} 周</dt><dd>{week(p.rates.term[w])}</dd></div>)}
              <div><dt>贷款</dt><dd>{p.rates.loan === null ? `${min} 分以上才能贷款` : week(p.rates.loan)}</dd></div>
            </dl>
            <p className="dc-top-sub" style={{ margin: 0 }}>
              {term === false ? '假期里不计息，开学后沿用这组利率。'
                : !p.week_start ? '本周利率还没有公布，先按初始利率显示。每周一公布。'
                : `${monthDay(p.week_start)}公布，每周一更新。`}
            </p>
          </section>
        )}
    </>
  );
}
