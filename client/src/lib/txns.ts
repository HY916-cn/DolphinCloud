import type { IconName } from '@/theme/icons';
import { formatTime } from './format';

// One ledger line as the account holder reads it. `amount` is the change to the balance; `paid` is the business's own
// amount, shown instead when the balance is untouched (a cash exchange and its 冲正).
// `after` is the balance once the business was done (txns.balance_after), when the query read it.
// `entered` is "11月15日 补录" for a business entered or corrected after the fact (txns.entered_at), shown after its time.
export type Txn = {
  key: string; icon: IconName; kind: string; title: string; time: string; amount: number; paid: number; note: string; after?: number; entered?: string;
};

export type TxnRow = {
  id: string; type: 'opening' | 'deposit' | 'withdraw' | 'purchase' | 'reversal' | 'salary' | 'interest' | 'term_open' | 'term_close' | 'wealth_buy' | 'wealth_close' | 'loan' | 'repay' | 'closing' | 'adjust'; amount: number; balance_delta: number;
  payment: 'account' | 'cash' | null; status: 'normal' | 'reversed'; reason: string | null; created_at: string; balance_after?: number;
  txn_items?: { name: string; qty: number; product_id?: string }[]; entered_at?: string | null;
};

// Icon and category colour per business (design system ColorRoles): savings, withdrawals, exchanges; a reversal is
// a correction and keeps the account blue; 工资 is the bank's pay for a teller's shifts; 利息 is the week's 活期 interest,
// paid by the system; 开定期 moves 活期 into a 定期 and 定期转回 brings it back with its interest; 买理财 and 理财转回 do the same
// with a 理财 and what it is worth; 贷款 pays a loan out (into
// the account or in cash) and 还款 pays it back; 注销清零 clears the balance of a closed account; 调账 puts 活期 right by hand,
// with the look of a 存款 or a 取款 by its sign (toTxn).
export const KINDS = {
  opening: { icon: 'savings', title: '期初余额', kind: 'dc-kind-save' },
  deposit: { icon: 'deposit', title: '存款', kind: 'dc-kind-save' },
  withdraw: { icon: 'withdraw', title: '取款', kind: 'dc-kind-withdraw' },
  purchase: { icon: 'exchange', title: '兑换', kind: 'dc-kind-exchange' },
  reversal: { icon: 'transfer', title: '冲正', kind: '' },
  salary: { icon: 'invest', title: '工资', kind: 'dc-kind-reward' },
  interest: { icon: 'rate', title: '利息', kind: 'dc-kind-reward' },
  term_open: { icon: 'savings', title: '开定期', kind: 'dc-kind-save' },
  term_close: { icon: 'savings', title: '定期转回', kind: 'dc-kind-save' },
  wealth_buy: { icon: 'invest', title: '买理财', kind: 'dc-kind-reward' },
  wealth_close: { icon: 'invest', title: '理财转回', kind: 'dc-kind-reward' },
  loan: { icon: 'loan', title: '贷款', kind: 'dc-kind-withdraw' },
  repay: { icon: 'loan', title: '还款', kind: 'dc-kind-withdraw' },
  closing: { icon: 'close', title: '注销清零', kind: '' },
  adjust: { icon: 'deposit', title: '调账', kind: 'dc-kind-save' },
} as const;
const ADJUST_DOWN = { icon: 'withdraw', kind: 'dc-kind-withdraw' } as const;

// A ledger row as the account holder reads it: "业务 · 详情", time, and the change to their balance, or for cash
// (balance_delta 0: a cash exchange or the 冲正 of one) the cash amount without a sign. A business entered after the
// fact takes its 说明 ("补录：…", "更正：…") as the 详情.
export function toTxn(t: TxnRow): Txn {
  const look = t.type === 'adjust' && t.balance_delta < 0 ? ADJUST_DOWN : KINDS[t.type];
  const detail =
    t.entered_at || t.type === 'adjust' ? t.reason
    : t.type === 'purchase' ? t.txn_items?.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join('、')
    : ['reversal', 'salary', 'interest', 'term_open', 'term_close', 'wealth_buy', 'wealth_close', 'loan', 'repay'].includes(t.type) ? t.reason
    : null;
  return {
    key: t.id,
    icon: look.icon,
    kind: look.kind,
    title: [KINDS[t.type].title, detail].filter(Boolean).join(' · ') + (t.status === 'reversed' ? '（已冲正）' : ''),
    time: formatTime(t.created_at),
    amount: t.balance_delta,
    paid: t.amount,
    note: t.type === 'adjust' ? '调账' : t.type === 'term_open' ? '转定期' : t.type === 'wealth_buy' ? '转理财' : t.type === 'term_close' || t.type === 'wealth_close' ? '转回'
      : t.type === 'loan' || t.type === 'repay' ? (t.balance_delta ? (t.type === 'loan' ? '放款' : '还款') : '现金') : t.balance_delta > 0 ? '存入' : t.balance_delta < 0 ? (t.type === 'purchase' ? '余额支付' : '取出') : t.type === 'reversal' ? '退回现金，余额不变' : '现金支付，余额不变',
    after: t.balance_after,
    entered: t.entered_at ? `${formatTime(t.entered_at).split(' ')[0]} 补录` : undefined,
  };
}
