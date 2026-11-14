import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { holdingLine, shownHoldings, type WealthDay, type WealthHolding } from '@/lib/wealth';
import { Icon } from './ui';

// A day on the school's clock (Asia/Shanghai) of a timestamp: 2027-01-06.
const cnDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso));

// A 理财 with the day it was redeemed, when it was (the time of its wealth_close).
export type ListedHolding = WealthHolding & { closed_on?: string | null };

// A student's own 理财 (我的理财), not the reversed ones, latest bought first, each with the day it ended; RLS shows a
// student only their own.
export function useMyWealth(studentNo: string) {
  return useQuery({
    queryKey: ['my-wealth', studentNo],
    queryFn: async () => {
      const { data, error } = await supabase.from('wealth_holdings').select('*,close:txns!wealth_holdings_close_txn_fkey(created_at)')
        .eq('student_no', studentNo).neq('status', 'reversed');
      if (error) throw error;
      return shownHoldings((data as (WealthHolding & { close: { created_at: string } | null })[])
        .map(({ close, ...h }) => ({ ...h, closed_on: close && cnDay(close.created_at) })));
    },
  });
}

// The index's latest trading day, for the sentence over 我的理财; null before the first.
export function useLatestDay() {
  return useQuery({
    queryKey: ['wealth-latest'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wealth_days').select('day,change').order('day', { ascending: false }).limit(1);
      if (error) throw error;
      return (data[0] ?? null) as Pick<WealthDay, 'day' | 'change'> | null;
    },
  });
}

const TAGS = {
  open: <span className="dc-tag"><Icon name="clock" />持有中</span>,
  matured: <span className="dc-tag dc-tag-success"><Icon name="success" />已到期</span>,
  redeemed: <span className="dc-tag">已赎回</span>,
};

// 理财 list (design system Invest): one row each, the sentence with its value in bold, the gain and its day, the
// status; with onRedeem (the counter) an open one also offers 赎回.
export function WealthList({ holdings, onRedeem }: { holdings: ListedHolding[]; onRedeem?: (h: WealthHolding) => void }) {
  return (
    <ul className="dc-list">
      {shownHoldings(holdings).map((h) => {
        const l = holdingLine(h, h.closed_on);
        return (
          <li key={h.id}>
            <div className="dc-list-item">
              <span>{l.lead}<b>{l.amount}</b><small><span className={`dc-pl ${l.gain.cls}`}>{l.gain.text}</span>{l.day && ` · ${l.day}`}</small></span>
              {TAGS[l.tag]}
              {onRedeem && l.canRedeem && (
                <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" aria-label={`赎回 ${h.weeks} 周理财 ${h.principal} HTB`}
                  onClick={() => onRedeem(h)}>赎回</button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
