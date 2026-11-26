import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  CashCounter, CashReason, cashRefusal, CashTable, CashTxns, Desk, Icon, KvLoading, Notice, ReviewTag, SkeletonGroup, Summary,
  TxnListLoading, useCashReviews, useWide, type CashProblem,
} from '@/components';
import { cashCell, cashHref, cashTotal, compareCash, diffAmount, isBalanced, type Counts } from '@/lib/cash';
import { dutyCash, type CashReview } from '@/lib/duty';
import { AppError } from '@/lib/errors';
import { dutySpan, formatAmount, formatTime, reversedNote } from '@/lib/format';
import { useBump } from '@/lib/motion';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';

// 复核 one duty (design system CashCount 复核, PHASE-2.md §7.1, §16.2). The list's filters ride along in the address,
// so 返回 and a review that went through land on the 轧账 page as it was.
export default function CashReviewPage() {
  const { duty, tab, user, day } = useLocalSearchParams<{ duty: string; tab?: string; user?: string; day?: string }>();
  const me = useMe().data!;
  const list = useCashReviews();
  const r = list.data?.find((x) => x.duty_id === duty);
  const filters = { tab, user, day };
  return (
    <Desk title={r ? `复核 ${r.name}的上班` : '复核'} back={() => router.navigate(cashHref(filters) as Href)}>
      {list.isError ? <Notice tone="danger" title="暂时无法读取这次上班">请检查网络后刷新页面。</Notice>
        : !list.data ? <SkeletonGroup className="dc-stack"><KvLoading rows={4} /><TxnListLoading rows={2} label="正在加载这次上班" /></SkeletonGroup>
        : !r ? <Notice tone="danger" title="找不到这次上班">请返回轧账页刷新后再试。</Notice>
        : <Review key={r.duty_id} r={r} canReview={me.roles.some((x) => ['accountant', 'teacher', 'president'].includes(x))}
            onDone={() => router.navigate(cashHref({ ...filters, fresh: r.duty_id }) as Href)} />}
    </Desk>
  );
}

// 这次上班 is the reference: when it ran and how it stands with its totals. 核对 is the work, for the accountant or the
// bank admin while the duty waits: the cash table, then 和柜员点的一致 (the teller's count stands) or a count of their own
// with the reason. A duty without the teller's count (强制下班, or ended by an old client) takes their count at once.
// On a computer 核对 and then the cash businesses are on the left, and 这次上班 alone stays in view on the right; on a
// phone 这次上班 comes first and the cash businesses last. Read-only (已轧账, or no right to review): 核对 becomes 现金,
// only the cash table, and no ActionBar.
function Review({ r, canReview, onDone }: { r: CashReview; canReview: boolean; onDone: () => void }) {
  const queryClient = useQueryClient();
  const wide = useWide();
  const cash = useQuery({ queryKey: ['duty-cash', r.duty_id], queryFn: () => dutyCash(r.duty_id) });
  const open = canReview && (r.status === 'pending' || r.status === 'forced');
  const [same, setSame] = useState(true);
  const [counts, setCounts] = useState<Counts>(r.teller_count ?? {});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CashProblem>(null);
  const faces = Object.keys(r.expected).map(Number);
  const counted: Counts = Object.fromEntries(faces.map((f) => [f, counts[f] ?? 0]));
  const editing = !r.teller_count || !same;
  const diff = compareCash(r.expected, counted);
  const differs = r.teller_count ? faces.some((f) => counted[f] !== (r.teller_count![f] ?? 0)) : !isBalanced(diff);
  const ready = !editing || !differs || !!note.trim();
  const total = editing ? cashTotal(counted) : r.teller_total ?? 0;
  const totalRef = useBump<HTMLElement>(total);
  const reversed = reversedNote(r.reversed, r.ended_at);

  async function review() {
    setBusy(true);
    setProblem(null);
    try {
      const done = await call<CashReview>('review_cash_count', editing
        ? { p_duty_id: r.duty_id, p_count: counted, p_note: note.trim() || null } : { p_duty_id: r.duty_id });
      queryClient.setQueryData<CashReview[]>(['cash-reviews'], (rows) => rows?.map((x) => (x.duty_id === done.duty_id ? done : x)));
      queryClient.invalidateQueries({ queryKey: ['cash-reviews'] });
      queryClient.invalidateQueries({ queryKey: ['cash-overview'] });
      onDone();
    } catch (err) {
      setProblem(cashRefusal(err, 'review'));
      if (err instanceof AppError && err.detail.field === 'duty_id') queryClient.invalidateQueries({ queryKey: ['cash-reviews'] });
      setBusy(false);
    }
  }

  const rows: [string, ReactNode][] = [
    ['上班', dutySpan(r.started_at, r.ended_at)],
    ['状态', <ReviewTag key="s" r={r} />],
    ['应有', `${formatAmount(r.expected_total)} HTB`],
    ...(r.teller_total !== null ? [['柜员实点', `${formatAmount(r.teller_total)} HTB`] as [string, ReactNode]] : []),
    ...(r.status === 'done' && r.review_count && r.count_total !== null
      ? [['复核实点', `${formatAmount(r.count_total)} HTB`] as [string, ReactNode]] : []),
    ...(r.diff ? [['差额', <span key="d" className={r.balanced ? undefined : 'is-danger'}>{diffAmount(r.diff)}</span>] as [string, ReactNode]] : []),
    ...(r.teller_note ? [['柜员的原因', r.teller_note] as [string, ReactNode]] : []),
    ...(r.forced_reason ? [['强制下班的原因', r.forced_reason] as [string, ReactNode]] : []),
    ...(r.reviewed_at ? [['复核', `${formatTime(r.reviewed_at)} ${r.reviewer_name ? `由${r.reviewer_name}复核` : '已复核'}`] as [string, ReactNode]] : []),
    ...(r.review_note ? [['复核的原因', r.review_note] as [string, ReactNode]] : []),
  ];
  const txns = (
    <>
      <p className="dc-list-title">本次上班的现金业务</p>
      {cash.isError ? <Notice tone="danger" title="暂时无法读取现金业务">请检查网络后刷新页面。</Notice>
        : !cash.data ? <TxnListLoading rows={2} label="正在加载现金业务" /> : <CashTxns txns={cash.data.cash_txns} />}
    </>
  );
  const shift = (
    <section className="dc-card dc-stack" aria-label="这次上班">
      <h2 className="heading">这次上班</h2>
      <Summary rows={rows} />
    </section>
  );
  const refusal = problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>;
  const table = (
    <>
      <CashTable r={r} />
      {reversed && <p className="dc-caption">{reversed}，这次上班的应有不变。</p>}
    </>
  );
  const after = <section className="dc-stack">{txns}</section>;
  const page = (work: ReactNode) => (wide
    ? <div className="dc-split"><div className="dc-stack">{work}{after}</div><div className="is-sticky">{shift}</div></div>
    : <>{shift}{work}{after}</>);
  if (!open) {
    return page(
      <section className="dc-card dc-stack" aria-label="现金">
        <h2 className="heading">现金</h2>
        {refusal}
        {table}
      </section>,
    );
  }

  const work = (
    <section className="dc-card dc-stack" aria-label="核对">
      <h2 className="heading">核对</h2>
      {refusal}
      {table}
      {r.teller_count && (
        <fieldset className="dc-seg" aria-label="复核结果">
          <label><input type="radio" name="review-same" checked={same} onChange={() => setSame(true)} /><span>和柜员点的一致</span></label>
          <label><input type="radio" name="review-same" checked={!same} onChange={() => setSame(false)} /><span>不一致</span></label>
        </fieldset>
      )}
      {editing ? (
        <>
          <p className="dc-list-title">复核实点</p>
          <CashCounter faces={faces} counts={counts} onChange={setCounts} kind="" what="复核实点张数"
            sum={(f) => r.teller_count
              ? <span className="dc-qty-sum">柜员<b>{r.teller_count[f] ?? 0}</b></span>
              : <span className="dc-qty-sum">应有<b className={r.expected[f] < 0 ? 'is-danger' : undefined}>{cashCell(r.expected[f], true).text}</b></span>} />
          <Summary rows={[]} total={['复核实点合计', total]} />
          <CashReason value={note} onChange={setNote}
            hint={r.teller_count ? '必填，写清和柜员点的哪里不同' : `${differs ? '必填，' : ''}写清储蓄盒的情况`} />
          {!isBalanced(diff) && <p className="dc-caption is-danger">按复核的数，{diffAmount(diff)}，会记一条风险提醒。</p>}
        </>
      ) : <p className="dc-caption">以柜员点的 {formatAmount(total)} HTB 为准。</p>}
    </section>
  );

  return (
    <>
      {page(work)}
      <div className="dc-actions">
        <button className={`dc-btn dc-btn-primary ${busy ? 'is-loading' : ''}`} type="button" disabled={busy || !ready} onClick={review}>
          <Icon name="check" />复核通过
        </button>
        <div className="dc-actions-total">
          <span>{editing ? '复核实点' : '柜员实点'}<small>复核 {r.name}的上班</small></span>
          <b ref={totalRef}>{formatAmount(total)}<small>HTB</small></b>
        </div>
      </div>
    </>
  );
}
