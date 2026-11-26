import { useQuery } from '@tanstack/react-query';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import { holdingLine, holdingName, shownHoldings, type Holding, type MyWealth } from '@/lib/wealth';
import { today as todayOf } from './DatePicker';
import { Icon } from './ui';

// A student's own 理财 (my_wealth): the products, the open holdings' value and gain, and every holding but the void.
export function useMyWealthQuote() {
  return useQuery({ queryKey: ['my-wealth'], queryFn: () => call<MyWealth>('my_wealth', {}) });
}
// The holdings alone, as a list shows them.
export function useMyWealth(_studentNo: string) {
  return useQuery({ queryKey: ['my-wealth'], queryFn: () => call<MyWealth>('my_wealth', {}), select: (w) => shownHoldings(w.holdings) });
}

// 沪深 300's latest trading day, for the sentence over 我的理财 on 信用; null before the first.
export function useLatestDay() {
  return useQuery({
    queryKey: ['wealth-latest'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wealth_days').select('day,change').eq('product', 'csi300').order('day', { ascending: false }).limit(1);
      if (error) throw error;
      return (data[0] ?? null) as { day: string; change: number } | null;
    },
  });
}

// 理财 list (design system Invest 持仓列表): one row each, the sentence with its value in bold, the gain and its day, and on
// the right what can be done or the status. At the counter (`onSell`) an open one that may be sold offers 卖出, or a
// disabled button saying why (`blocked`: 账户冻结, 已毕业); the student's rows say 持有中 and leave out the net value.
export function WealthList({ holdings, today = todayOf(), onSell, blocked }: {
  holdings: Holding[]; today?: string; onSell?: (h: Holding) => void; blocked?: string;
}) {
  const counter = !!onSell || !!blocked;
  return (
    <ul className="dc-list">
      {shownHoldings(holdings).map((h) => {
        const l = holdingLine(h, today, !counter);
        return (
          <li key={h.id}>
            <div className="dc-list-item">
              <span>{l.lead}<b>{l.amount}</b><small>{l.gain.cls ? <span className={`dc-pl ${l.gain.cls}`}>{l.gain.text}</span> : l.gain.text} · {l.day}</small></span>
              {l.tag === 'wait' ? <span className="dc-tag"><Icon name="clock" />{l.wait}</span>
                : l.tag === 'matured' ? <span className="dc-tag dc-tag-success"><Icon name="success" />已到期</span>
                : l.tag === 'redeemed' ? <span className="dc-tag">已卖出</span>
                : !counter ? <span className="dc-tag">持有中</span>
                : blocked ? <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled>{blocked}</button>
                : (
                  <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" aria-label={`卖出${holdingName(h)} ${h.principal} HTB`}
                    onClick={() => onSell?.(h)}>卖出</button>
                )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
