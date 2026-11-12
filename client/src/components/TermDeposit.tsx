import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { depositLine, shownDeposits, type TermDeposit } from '@/lib/term-deposits';
import { Icon } from './ui';

// A student's own 定期 (我的定期), not the reversed ones, latest first; RLS shows a student only their own.
export function useMyTerms(studentNo: string) {
  return useQuery({
    queryKey: ['my-terms', studentNo],
    queryFn: async () => {
      const { data, error } = await supabase.from('term_deposits').select('*').eq('student_no', studentNo).neq('status', 'reversed');
      if (error) throw error;
      return shownDeposits(data as TermDeposit[]);
    },
  });
}

const TAGS = {
  open: <span className="dc-tag"><Icon name="clock" />存期中</span>,
  matured: <span className="dc-tag dc-tag-success"><Icon name="success" />已到期</span>,
  early: <span className="dc-tag">已提前支取</span>,
};

// 定期 list (design system TermDeposit): one row each, the sentence with its amount in bold, the small line, the status;
// with onWithdraw (the counter) an open one not past its maturity day also offers 提前支取.
export function TermList({ deposits, today, onWithdraw }: { deposits: TermDeposit[]; today: string; onWithdraw?: (d: TermDeposit) => void }) {
  return (
    <ul className="dc-list">
      {shownDeposits(deposits).map((d) => {
        const l = depositLine(d, today);
        return (
          <li key={d.id}>
            <div className="dc-list-item">
              <span>{l.lead}<b>{l.amount}</b><small>{l.note}</small></span>
              {TAGS[l.tag]}
              {onWithdraw && l.canWithdraw && (
                <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" aria-label={`提前支取 ${d.weeks} 周定期 ${d.principal} HTB`}
                  onClick={() => onWithdraw(d)}>提前支取</button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
