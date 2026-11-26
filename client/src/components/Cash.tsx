import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { cashCell, cashNotes, diffNotes } from '@/lib/cash';
import type { CashReview, CashTxn } from '@/lib/duty';
import { AppError, explain } from '@/lib/errors';
import { dutySpan, formatAmount, formatSigned, formatTime } from '@/lib/format';
import { call } from '@/lib/rpc';
import { KINDS } from '@/lib/txns';
import { Summary } from './Counter';
import { ConfirmSheet } from './Sheet';
import { Icon, Notice } from './ui';

export type CashProblem = { title: string; text: string } | null;
export const cashRefusal = (err: unknown, cash: 'end' | 'review' | 'force') =>
  err instanceof AppError ? explain(err.code, { ...err.detail, cash }) : explain('');

// The cash businesses of a duty (duty_cash.cash_txns, by time): "存款 · 张小明", the time and the notes taken in
// and paid out. A business reversed by the bank admin or the president during the duty is still listed (its cash is
// in the box), tagged 已冲正.
export function CashTxns({ txns }: { txns: CashTxn[] }) {
  if (!txns.length) return <p className="dc-top-sub">这次上班没有现金业务。</p>;
  return (
    <ul className="dc-txns" aria-label="本次上班的现金业务">
      {txns.map((t) => {
        const k = KINDS[t.type];
        return (
          <li key={t.txn_no} className={`dc-txn ${k.kind}`}>
            <span className="dc-txn-icon"><Icon name={k.icon} /></span>
            <div className="dc-txn-main">
              <div className="dc-txn-title">{k.title} · {t.name ?? t.student_no}{t.status === 'reversed' && <> <span className="dc-tag">已冲正</span></>}</div>
              <div className="dc-txn-time">{formatTime(t.created_at).split(' ')[1]} · {cashNotes(t.income, t.payout, t.type)}</div>
            </div>
            <div className={`dc-txn-amount ${t.type === 'deposit' ? 'is-in' : t.type === 'withdraw' ? 'is-out' : ''}`}>
              {t.type === 'deposit' ? formatSigned(t.amount) : t.type === 'withdraw' ? formatSigned(-t.amount) : formatAmount(t.amount)}
              <small>{t.type === 'deposit' ? '存入' : t.type === 'withdraw' ? '取出' : '现金'}</small>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// 轧账's status as a tag (design system CashCount).
export function ReviewTag({ r }: { r: CashReview }) {
  const late = r.overdue ? ' · 超过一天' : '';
  if (r.status === 'open') return <span className="dc-tag"><Icon name="clock" />待下班</span>;
  if (r.status === 'forced') return <span className="dc-tag dc-tag-danger"><Icon name="warning" />强制下班{late}</span>;
  if (r.status === 'done') return <span className="dc-tag dc-tag-success"><Icon name="success" />已轧账</span>;
  return r.overdue ? <span className="dc-tag dc-tag-danger"><Icon name="warning" />待复核{late}</span> : <span className="dc-tag dc-tag-pending">待复核</span>;
}

// Every duty's 轧账, newest first (the 轧账 page and each 复核 page read the same list).
// shortcut: every duty in one read, filtered on the device; fine for one school's terms, pass p_from / p_to when it grows.
export const useCashReviews = () => useQuery({ queryKey: ['cash-reviews'], queryFn: () => call<CashReview[]>('cash_reviews', {}) });

// The screen's cash table of one duty, one row per face: the notes 应有, 柜员 (the teller's count, when there is one),
// 复核 (when a reviewer counted) and the 差额 by the count that stands. The totals are in 这次上班's SummaryList.
export function CashTable({ r }: { r: CashReview }) {
  const faces = Object.keys(r.expected).map(Number).sort((a, b) => a - b);
  const cell = (key: string, text: string, danger: boolean) => <td key={key} className={`n ${danger ? 'is-danger' : ''}`}>{text}</td>;
  return (
    <div className="dc-table-scroll">
      <table className="dc-table" aria-label="本次上班现金">
        <thead>
          <tr>
            <th scope="col"><span className="dc-sr-only">面额</span></th>
            <th scope="col" className="n">应有</th>
            {r.teller_count && <th scope="col" className="n">柜员<span className="dc-sr-only">实点</span></th>}
            {r.review_count && <th scope="col" className="n">复核<span className="dc-sr-only">实点</span></th>}
            {r.diff && <th scope="col" className="n">差额</th>}
          </tr>
        </thead>
        <tbody>
          {faces.map((f) => {
            const expected = cashCell(r.expected[f] ?? 0, true);
            const diff = r.diff?.[f] ?? 0;
            return (
              <tr key={f}>
                <td>{f} 元</td>
                {cell('expected', expected.text, expected.short)}
                {r.teller_count && cell('teller', cashCell(r.teller_count[f] ?? 0, true).text, false)}
                {r.review_count && cell('review', cashCell(r.review_count[f] ?? 0, true).text, false)}
                {r.diff && cell('diff', diff ? diffNotes(diff) : '0', diff !== 0)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 原因 (多行 Field), at most 100 characters (the server takes 200); `hint` says whether it is required.
export function CashReason({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <label className="dc-field">
      <span className="dc-field-label"><Icon name="help" />原因</span>
      <span className="dc-input-wrap dc-input-area">
        <textarea className="dc-input" rows={2} maxLength={100} value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
      <span className="dc-field-hint">{hint}</span>
    </label>
  );
}

// 强制下班 (president, bank admin): ends a teller's open duty with the reason; the accountant then counts the box.
export function ForceSheet({ r, onClose, onDone }: { r: CashReview; onClose: () => void; onDone: (r: CashReview) => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem>(null);
  async function force() {
    setBusy(true);
    setProblem(null);
    try {
      onDone(await call<CashReview>('force_end_duty', { p_duty_id: r.duty_id, p_reason: reason.trim() }));
    } catch (err) {
      setProblem(cashRefusal(err, 'force'));
      if (err instanceof AppError && err.detail.field === 'duty_id') queryClient.invalidateQueries({ queryKey: ['cash-reviews'] });
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmSheet title={`让${r.name}强制下班？`} confirm="强制下班" ready={!!reason.trim()} busy={busy} onClose={onClose} onConfirm={force}
      text={`结束${r.name} ${formatTime(r.started_at)} 开始的上班，柜台马上不能再办理业务，要重新上班才能继续。这次上班没有柜员实点，复核时重新点数。`}>
      <CashReason value={reason} onChange={setReason} hint="必填，最多 100 字" />
      {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
    </ConfirmSheet>
  );
}

// 这次上班 (president, bank admin, an open duty): when it began and how it stands, with 强制下班 beside 关闭.
export function DutySheet({ r, onClose, onForce }: { r: CashReview; onClose: () => void; onForce: () => void }) {
  return (
    <ConfirmSheet title={`${r.name}的上班`} cancel="关闭" confirm="强制下班" danger onClose={onClose} onConfirm={onForce}>
      <Summary rows={[['上班', dutySpan(r.started_at, r.ended_at)], ['状态', <ReviewTag key="s" r={r} />]]} />
    </ConfirmSheet>
  );
}
