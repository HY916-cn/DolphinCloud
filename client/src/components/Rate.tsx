import { useQuery } from '@tanstack/react-query';
import { formatCenti, formatRate } from '@/lib/format';
import { byWeeks, maturityCenti, weekCenti, type TermRates } from '@/lib/rates';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import { monthDay } from '@/lib/term';
import { CreditFailed } from './Credit';
import { Icon, link, Notice } from './ui';
import { KvLoading } from './Skeleton';

// interest_profile (PHASE-2.md §15): the week's anchor (week_start null: none published yet, the initial one stands),
// the weekly rates at the student's score (loan null: too low to borrow; current 0 while 活期 is paused, savings_enabled
// false) and 攒着的利息 (not yet paid in) in 0.01 HTB.
export type InterestProfile = {
  student_no: string; score: number; week_start: string | null; anchor: number; savings_enabled: boolean;
  rates: { current: number; term: TermRates; loan: number | null }; pending_centi: number;
};
export const useInterest = () => useQuery({ queryKey: ['interest', 'me'], queryFn: () => call<InterestProfile>('interest_profile', {}) });

// 活期计息开关 (PHASE-2.md §9.3, design system data.md 活期计息开关（后台）): settings.savings_interest_enabled, which every
// login reads; updated_at and updated_by are the last turn. Until it is read, or when it cannot be, 活期 counts as on.
export type SavingsSwitch = { value: boolean; updated_at: string; updated_by: string | null };
export function useSavingsSwitch() {
  return useQuery({
    queryKey: ['settings', 'savings_interest_enabled'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('value,updated_at,updated_by').eq('key', 'savings_interest_enabled').single();
      if (error) throw error;
      return data as SavingsSwitch;
    },
  });
}
// At the top of the back office's 利率 and 总览 while 活期 is paused.
export function SavingsPausedNotice() {
  return useSavingsSwitch().data?.value === false ? <Notice title="活期暂停计息：每天不计活期利息，已攒着的利息照常结息。" /> : null;
}

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
              {/* 活期 opens 利息 (StudentInterestPage). */}
              <li className="is-link">
                <a {...link('/student/interest')}>{p.savings_enabled ? <>活期存 100 HTB，一周多得约 {htb(weekCenti(p.rates.current))}{week(p.rates.current)}</>
                  : '活期暂停计息，暂停期间存在活期不计利息'}</a>
                <Icon name="next" />
              </li>
              {byWeeks(p.rates.term).map(([w, r]) => (
                <li key={w}>定期 {w} 周存 100 HTB，到期拿回 {htb(maturityCenti(r, w))}{week(r)}</li>
              ))}
              <li>{p.rates.loan === null ? `${min} 分以上才能贷款` : <>借 100 HTB，一周利息约 {htb(weekCenti(p.rates.loan))}{week(p.rates.loan)}</>}</li>
            </ul>
            <p className="dc-caption">
              信用分越高，借得越多，利息越少；活期利率人人相同，定期利率是固定的。{!p.week_start ? '本周利率还没有公布，先按初始利率显示。每周一公布。'
                : `${monthDay(p.week_start)}公布，每周一更新。`}
            </p>
          </section>
        )}
    </>
  );
}
