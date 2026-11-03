import { useQuery } from '@tanstack/react-query';
import { formatAmount, formatSigned } from '@/lib/format';
import { readAll, supabase } from '@/lib/supabase';
import { termStart, tide, type Tide } from '@/lib/term';
import type { Txn } from '@/lib/txns';
import { SlowNotice, useSlow } from './Skeleton';
import { Icon } from './ui';

// +270, −45, and 0 with no sign when nothing came in or went out.
export const signed = (n: number) => (n ? formatSigned(n) : '0');

// BalanceCard: the largest number on the page, on a cloud with the three-layer wave at its foot; with the term's
// `tide`, the sea at its foot is the balance through the term, and the pills say what came in and went out.
export function BalanceCard({ amount, label = '我的海豚币', tide }: { amount: number; label?: string; tide?: Tide }) {
  return (
    <div className={`dc-balance ${tide ? 'has-tide' : ''}`}>
      <div className="dc-balance-label"><Icon name="coin" />{label}</div>
      <div className="dc-balance-amount">{formatAmount(amount)}<span>HTB</span></div>
      {tide ? <>
        <div className="dc-balance-split"><span>本学期存入 <b>{signed(tide.saved)}</b></span><span>本学期支出 <b>{signed(tide.spent)}</b></span></div>
        <div className="dc-tide" role="img"
          aria-label={`本学期余额从 ${tide.from}的 ${formatAmount(tide.start)} HTB ${amount >= tide.start ? '涨到' : '降到'}今天的 ${formatAmount(amount)} HTB`}>
          <svg viewBox="0 0 1000 112" preserveAspectRatio="none" aria-hidden="true"><polygon className="dc-tide-sea" points={tide.points} /></svg>
          <div className="dc-tide-axis" aria-hidden="true"><span>{tide.from} <b>{formatAmount(tide.start)}</b></span><span>今天 <b>{formatAmount(amount)}</b></span></div>
        </div>
      </> : <div className="dc-waves" aria-hidden="true"><i /><i /><i /></div>}
    </div>
  );
}

// A student's balance, account status and this term's businesses, drawn as BalanceCard's tide.
export function useTerm(studentNo: string) {
  const term = termStart();
  return useQuery({
    queryKey: ['student-term', studentNo, term],
    queryFn: async () => {
      const [account, rows] = await Promise.all([
        supabase.from('accounts').select('balance,students(status)').eq('student_no', studentNo).single(),
        readAll<{ balance_delta: number; created_at: string }>((from, to) => supabase.from('txns').select('balance_delta,created_at')
          .eq('student_no', studentNo).gte('created_at', `${term}T00:00:00+08:00`).order('seq').range(from, to)),
      ]);
      if (account.error) throw account.error;
      const status = (account.data.students as unknown as { status: 'normal' | 'frozen' | 'graduated' }).status;
      return { balance: account.data.balance, status, tide: tide(account.data.balance, rows, term) };
    },
  });
}

// TxnList: icon, "业务 · 详情", time, and the signed amount with a word (存入 / 取出 / 余额支付), never colour alone; a cash
// business shows its amount unsigned, as it leaves the balance as it is.
export function TxnList({ items }: { items: Txn[] }) {
  return (
    <ul className="dc-txns dc-stagger">
      {items.map((t) => (
        <li key={t.key} className={`dc-txn ${t.kind}`}>
          <span className="dc-txn-icon"><Icon name={t.icon} /></span>
          <div className="dc-txn-main">
            <div className="dc-txn-title">{t.title}</div>
            <div className="dc-txn-time">{t.time}</div>
          </div>
          <div className={`dc-txn-amount ${t.amount > 0 ? 'is-in' : ''}`}>{t.amount ? formatSigned(t.amount) : formatAmount(t.paid)}<small>{t.note}</small></div>
        </li>
      ))}
    </ul>
  );
}

// Skeleton rows while the list loads.
export function TxnListLoading({ rows = 3, label = '正在加载交易' }: { rows?: number; label?: string }) {
  if (useSlow()) return <SlowNotice />;
  return (
    <ul className="dc-txns" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="dc-txn" aria-hidden="true">
          <span className="dc-skeleton" style={{ width: 52, height: 52, borderRadius: 'var(--radius-md)' }} />
          <div className="dc-txn-main">
            <span className="dc-skeleton" style={{ width: '60%', height: 18 }} />
            <span className="dc-skeleton" style={{ width: '36%', height: 14, marginTop: 8 }} />
          </div>
          <span className="dc-skeleton" style={{ width: 48, height: 22 }} />
        </li>
      ))}
    </ul>
  );
}
