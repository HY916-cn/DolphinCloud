import { formatAmount, formatSigned } from '@/lib/format';
import { toTxn, type TxnRow } from '@/lib/txns';
import { Icon } from './ui';

// A transaction as the back office lists it (流水, 总览): the student, the teller, and how it was corrected.
export type LedgerRow = TxnRow & {
  txn_no: string; student_no: string; balance_after: number; reversal_of: string | null; operator_id: string;
  students: { name: string; class_label: string | null } | null; operator: { display_name: string } | null;
  term?: { status: string; matures_on: string } | null; // the 定期 of a term_open or term_close
};
export const LEDGER = 'id,txn_no,type,amount,balance_delta,balance_after,payment,status,reason,reversal_of,created_at,student_no,'
  + 'operator_id,txn_items(name,qty),students(name,class_label),operator:profiles!txns_operator_id_fkey(display_name),'
  + 'term:term_deposits!txns_term_id_fkey(status,matures_on)';

// The inside of a `dc-txn` row: "业务 · 详情", who and which teller, 交易号 and time, and the change to the balance;
// a cash purchase leaves the balance as it is and shows the amount paid in cash.
export function LedgerLine({ row }: { row: LedgerRow }) {
  const t = toTxn(row);
  const delta = row.balance_delta;
  return (
    <>
      <span className="dc-txn-icon"><Icon name={t.icon} /></span>
      <div className="dc-txn-main">
        <div className="dc-txn-title">{t.title}</div>
        <div className="dc-txn-time">{row.students?.name} · 学号 {row.student_no} · 经办人 {row.operator?.display_name}</div>
        <div className="dc-txn-time">交易号 {row.txn_no} · {t.time}</div>
      </div>
      <div className={`dc-txn-amount ${delta > 0 ? 'is-in' : ''}`}>
        {delta ? formatSigned(delta) : formatAmount(row.amount)}<small>{delta ? t.note : '现金'}</small>
      </div>
    </>
  );
}
