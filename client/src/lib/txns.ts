import type { IconName } from '@/theme/icons';
import { formatTime } from './format';

// One ledger line as the account holder reads it. `amount` is the change to the balance; `paid` is the business's own
// amount, shown instead when the balance is untouched (a cash exchange and its 冲正).
export type Txn = { key: string; icon: IconName; kind: string; title: string; time: string; amount: number; paid: number; note: string };

export type TxnRow = {
  id: string; type: 'opening' | 'deposit' | 'withdraw' | 'purchase' | 'reversal'; amount: number; balance_delta: number;
  payment: 'account' | 'cash' | null; status: 'normal' | 'reversed'; reason: string | null; created_at: string;
  txn_items?: { name: string; qty: number }[];
};

// Icon and category colour per business (design system ColorRoles): savings, withdrawals, exchanges; a reversal is
// a correction and keeps the account blue.
export const KINDS = {
  opening: { icon: 'savings', title: '期初余额', kind: 'dc-kind-save' },
  deposit: { icon: 'deposit', title: '存款', kind: 'dc-kind-save' },
  withdraw: { icon: 'withdraw', title: '取款', kind: 'dc-kind-withdraw' },
  purchase: { icon: 'exchange', title: '兑换', kind: 'dc-kind-exchange' },
  reversal: { icon: 'transfer', title: '冲正', kind: '' },
} as const;

// A ledger row as the account holder reads it: "业务 · 详情", time, and the change to their balance, or for cash
// (balance_delta 0: a cash exchange or the 冲正 of one) the cash amount without a sign.
export function toTxn(t: TxnRow): Txn {
  const detail =
    t.type === 'purchase' ? t.txn_items?.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join('、')
    : t.type === 'reversal' ? t.reason
    : null;
  return {
    key: t.id,
    icon: KINDS[t.type].icon,
    kind: KINDS[t.type].kind,
    title: [KINDS[t.type].title, detail].filter(Boolean).join(' · ') + (t.status === 'reversed' ? '（已冲正）' : ''),
    time: formatTime(t.created_at),
    amount: t.balance_delta,
    paid: t.amount,
    note: t.balance_delta > 0 ? '存入' : t.balance_delta < 0 ? '支出' : t.type === 'reversal' ? '退回现金，余额不变' : '现金支付，余额不变',
  };
}
