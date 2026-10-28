import { formatAmount, formatSigned } from '@/lib/format';
import type { Txn } from '@/lib/txns';
import { Icon } from './ui';

// BalanceCard: the largest number on the page, on a cloud with the three-layer wave at its foot.
export function BalanceCard({ amount, label = '我的海豚币' }: { amount: number; label?: string }) {
  return (
    <div className="dc-balance">
      <div className="dc-balance-label"><Icon name="coin" />{label}</div>
      <div className="dc-balance-amount">{formatAmount(amount)}<span>HTB</span></div>
      <div className="dc-waves" aria-hidden="true"><i /><i /><i /></div>
    </div>
  );
}

// TxnList: icon, "业务 · 详情", time, and the signed amount with a word (存入 / 支出), never colour alone.
export function TxnList({ items }: { items: Txn[] }) {
  return (
    <ul className="dc-txns dc-stagger">
      {items.map((t) => (
        <li key={t.key} className="dc-txn">
          <span className="dc-txn-icon"><Icon name={t.icon} /></span>
          <div className="dc-txn-main">
            <div className="dc-txn-title">{t.title}</div>
            <div className="dc-txn-time">{t.time}</div>
          </div>
          <div className={`dc-txn-amount ${t.amount > 0 ? 'is-in' : ''}`}>{formatSigned(t.amount)}<small>{t.note}</small></div>
        </li>
      ))}
    </ul>
  );
}

// Skeleton rows while the list loads.
export function TxnListLoading({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="dc-txns" aria-busy="true" aria-label="正在加载交易">
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
