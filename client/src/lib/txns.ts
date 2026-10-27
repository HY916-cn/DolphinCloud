import type { Txn } from '@/components';
import { formatTime } from './format';

export type TxnRow = {
  id: string; type: 'opening' | 'deposit' | 'withdraw' | 'purchase' | 'reversal'; amount: number; balance_delta: number;
  payment: 'account' | 'cash' | null; status: 'normal' | 'reversed'; reason: string | null; created_at: string;
  txn_items?: { name: string; qty: number }[];
};

const KINDS = {
  opening: { icon: 'coin', title: '期初余额' },
  deposit: { icon: 'deposit', title: '存款' },
  withdraw: { icon: 'withdraw', title: '取款' },
  purchase: { icon: 'exchange', title: '兑换' },
  reversal: { icon: 'transfer', title: '冲正' },
} as const;

// A ledger row as the account holder reads it: "业务 · 详情", time, and the change to their balance.
export function toTxn(t: TxnRow): Txn {
  const detail =
    t.type === 'purchase' ? t.txn_items?.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join('、')
    : t.type === 'reversal' ? t.reason
    : null;
  return {
    key: t.id,
    icon: KINDS[t.type].icon,
    title: [KINDS[t.type].title, detail].filter(Boolean).join(' · ') + (t.status === 'reversed' ? '（已冲正）' : ''),
    time: formatTime(t.created_at),
    amount: t.balance_delta,
    note: t.balance_delta > 0 ? '存入' : '支出',
  };
}
