import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { cashCell, cashNotes, compareCash, diffAmount, diffNotes, isBalanced, type Counts } from '@/lib/cash';
import { dutyCash, type CashReview, type CashTxn } from '@/lib/duty';
import { AppError, explain } from '@/lib/errors';
import { dutySpan, formatAmount, formatSigned, formatTime, reversedNote } from '@/lib/format';
import { call } from '@/lib/rpc';
import { KINDS } from '@/lib/txns';
import { CashCounter, Summary } from './Counter';
import { ConfirmSheet } from './Sheet';
import { TxnListLoading } from './Account';
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
            <div className={`dc-txn-amount ${t.type === 'deposit' ? 'is-in' : ''}`}>
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

const htb = (n: number | null) => (n === null ? '—' : `${formatAmount(n)} HTB`);

// The screen's cash table of one duty: notes per face and the amount, 应有, 柜员实点, 财务实点 (when the accountant
// counted) and the 差额 by the count that stands.
function CashTable({ r }: { r: CashReview }) {
  const faces = Object.keys(r.expected).map(Number).sort((a, b) => a - b);
  const row = (label: string, counts: Counts, total: ReactNode, totalDanger = false, cell = (n: number) => ({ text: cashCell(n, true).text, short: n < 0 })) => (
    <tr className={label === '应有' ? 'is-total' : undefined}>
      <td>{label}</td>
      {faces.map((f) => { const c = cell(counts[f] ?? 0); return <td key={f} className={`n ${c.short ? 'is-danger' : ''}`}>{c.text}</td>; })}
      <td className={`n ${totalDanger ? 'is-danger' : ''}`}>{total}</td>
    </tr>
  );
  return (
    <div className="dc-table-scroll">
      <table className="dc-table" aria-label="本次上班现金">
        <thead><tr><th scope="col"><span className="dc-sr-only">项目</span></th>{faces.map((f) => <th key={f} scope="col" className="n">{f}元</th>)}<th scope="col" className="n">合计</th></tr></thead>
        <tbody>
          {row('应有', r.expected, htb(r.expected_total))}
          {r.teller_count && row('柜员实点', r.teller_count, htb(r.teller_total))}
          {r.review_count && row('财务实点', r.review_count, htb(r.count_total))}
          {r.diff && row('差额', r.diff, diffAmount(r.diff), !r.balanced, (n) => ({ text: n ? diffNotes(n) : '0', short: n !== 0 }))}
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

// 复核 (design system CashCount 复核): the duty's cash table, its cash businesses and, for the accountant while it waits,
// 和柜员点的一致 (the teller's count stands) or the accountant's own count with the reason. A duty without the teller's
// count (强制下班, or ended by an old client) takes the accountant's count at once. Read-only otherwise.
export function ReviewSheet({ r, canReview, onClose, onDone }: {
  r: CashReview; canReview: boolean; onClose: () => void; onDone: (r: CashReview) => void;
}) {
  const queryClient = useQueryClient();
  const cash = useQuery({ queryKey: ['duty-cash', r.duty_id], queryFn: () => dutyCash(r.duty_id) });
  const open = canReview && (r.status === 'pending' || r.status === 'forced');
  const [same, setSame] = useState(true);
  const [counts, setCounts] = useState<Counts>(r.teller_count ?? {});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem>(null);
  const faces = Object.keys(r.expected).map(Number);
  const counted: Counts = Object.fromEntries(faces.map((f) => [f, counts[f] ?? 0]));
  const editing = open && (!r.teller_count || !same);
  const diff = compareCash(r.expected, counted);
  const differs = r.teller_count ? faces.some((f) => counted[f] !== (r.teller_count![f] ?? 0)) : !isBalanced(diff);
  const ready = !editing || !differs || !!note.trim();
  const reversed = reversedNote(r.reversed, r.ended_at);

  async function review() {
    setBusy(true);
    setProblem(null);
    try {
      onDone(await call<CashReview>('review_cash_count', editing
        ? { p_duty_id: r.duty_id, p_count: counted, p_note: note.trim() || null } : { p_duty_id: r.duty_id }));
    } catch (err) {
      setProblem(cashRefusal(err, 'review'));
      if (err instanceof AppError && err.detail.field === 'duty_id') queryClient.invalidateQueries({ queryKey: ['cash-reviews'] });
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, ReactNode][] = [
    ['上班', dutySpan(r.started_at, r.ended_at)],
    ['状态', <ReviewTag key="s" r={r} />],
    ...(r.teller_note ? [['柜员的原因', r.teller_note] as [string, ReactNode]] : []),
    ...(r.forced_reason ? [['强制下班的原因', r.forced_reason] as [string, ReactNode]] : []),
    ...(r.reviewed_at ? [['复核', `${formatTime(r.reviewed_at)} 由${r.reviewer_name ?? '财务'}复核`] as [string, ReactNode]] : []),
    ...(r.review_note ? [['财务的原因', r.review_note] as [string, ReactNode]] : []),
  ];
  return (
    <ConfirmSheet title={`复核 ${r.name}的上班`} confirm={open ? '复核通过' : '关闭'} cancel={open ? '取消' : null} ready={ready} busy={busy}
      onClose={onClose} onConfirm={open ? review : onClose}>
      <div className="dc-stack">
        <Summary rows={rows} />
        <CashTable r={r} />
        {reversed && <p className="dc-caption">{reversed}，这次上班的应有不变。</p>}
        <p className="dc-list-title">本次上班的现金业务</p>
        {cash.isError ? <Notice tone="danger" title="暂时无法读取现金业务">请检查网络后重试。</Notice>
          : !cash.data ? <TxnListLoading rows={2} label="正在加载现金业务" /> : <CashTxns txns={cash.data.cash_txns} />}
        {open && r.teller_count && (
          <fieldset className="dc-seg" aria-label="复核结果">
            <label><input type="radio" name="review-same" checked={same} onChange={() => setSame(true)} /><span>和柜员点的一致</span></label>
            <label><input type="radio" name="review-same" checked={!same} onChange={() => setSame(false)} /><span>不一致</span></label>
          </fieldset>
        )}
        {editing && (
          <>
            <p className="dc-list-title">财务实点</p>
            <CashCounter faces={faces} counts={counts} onChange={setCounts} kind="" what="财务实点张数"
              sum={(f) => r.teller_count
                ? <span className="dc-qty-sum">柜员<b>{r.teller_count[f] ?? 0}</b></span>
                : <span className="dc-qty-sum">应有<b className={r.expected[f] < 0 ? 'is-danger' : undefined}>{cashCell(r.expected[f], true).text}</b></span>} />
            <CashReason value={note} onChange={setNote}
              hint={r.teller_count ? '必填，写清和柜员点的哪里不同' : `${differs ? '必填，' : ''}写清储蓄盒的情况`} />
            {!isBalanced(diff) && <p className="dc-caption is-danger">按财务的数，{diffAmount(diff)}，会记一条风险提醒。</p>}
          </>
        )}
        {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
      </div>
    </ConfirmSheet>
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
      text={`结束${r.name} ${formatTime(r.started_at)} 开始的上班，柜台马上不能再办理业务，要重新上班才能继续。这次上班没有柜员实点，由财务点数复核。`}>
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
