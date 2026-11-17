import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  Desk, FilterBar, Icon, link, Notice, OutputSheet, ReversalSheet, SCOPE_ICON, Summary, Toast, TxnListLoading, today, useWide, wrongTimes,
  type Chip, type Suggestion,
} from '@/components';
import { LEDGER, LedgerLine, type LedgerRow } from '@/components/Ledger';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatSigned, formatTime } from '@/lib/format';
import { useNewRows } from '@/lib/motion';
import { ledgerPages, ledgerQuery, ledgerSheet, NO_LEDGER, saveWorkbook, type LedgerFilter } from '@/lib/reports';
import { findScopes } from '@/lib/search';
import { bankAdmin, useMe } from '@/lib/session';
import { useStudents } from '@/lib/students';
import { supabase } from '@/lib/supabase';
import { toTxn } from '@/lib/txns';

const PAGE = 50;
const KINDS = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换'], ['adjust', '调账'], ['reversal', '冲正'], ['salary', '工资'], ['interest', '利息'], ['term_open', '开定期'], ['term_close', '定期转回'], ['wealth_buy', '买理财'], ['wealth_close', '理财转回'], ['loan', '贷款'], ['repay', '还款'], ['opening', '期初'], ['closing', '注销清零']] as const;
type Kind = (typeof KINDS)[number][0];
// How each row on a page was corrected: the reversal of a 已冲正 row, the 交易号 of a 冲正 row's original and of an 编辑's
// (更正自), and of what an edited row became (已更正为).
type Page = {
  rows: LedgerRow[]; count: number | null; reversals: Map<string, { txn_no: string; reason: string | null }>; originals: Map<string, string>;
  corrected: Map<string, string>;
};
type Staff = { id: string; display_name: string; user_roles: { role: string } | { role: string }[] | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TXN_NO = /^(ht)?\d{2,}$/i;

// Filters from the address, so other pages can link here: ?student=&operator=&from=&to=&type=deposit,withdraw; ?no= a
// 交易号, whose row opens.
function fromParams(p: Record<string, string | string[] | undefined>): LedgerFilter {
  const one = (k: string) => [p[k]].flat()[0]?.trim() ?? '';
  const day = (k: string) => (DAY.test(one(k)) ? one(k) : '');
  const kinds = one('type').split(',').filter((k): k is Kind => KINDS.some(([x]) => x === k));
  const no = one('student');
  return { ...NO_LEDGER, scope: no ? { kind: 'student', student_no: no, label: `学号 ${no}`, note: '' } : null,
    operator: one('operator'), from: day('from'), to: day('to'), kinds, txnNo: TXN_NO.test(one('no')) ? one('no').toUpperCase() : '' };
}

// 流水 (accountant, teacher): every transaction, newest first, 50 at a time. One search finds a student, a class or
// 学部 (the counter's search), a teller or part of a 交易号; then the days, the types and, when asked for, a 时段 of
// each day (Asia/Shanghai). A new address starts over with its own filters. 打印 / 导出 prints the transactions the
// filters choose, or keeps them as a PDF or an Excel file. The bank admin's 补录 and 编辑 (PHASE-2.md §10.11) open
// txns/new, which comes back here with ?no= the new 交易号 and ?done= what to say.
export default function Txns() {
  const params = useLocalSearchParams();
  const init = fromParams(params);
  const done = [params.done].flat()[0] ?? null;
  return <Ledger key={JSON.stringify([init, done])} init={init} done={done} />;
}

function Ledger({ init, done }: { init: LedgerFilter; done: string | null }) {
  const me = useMe().data!;
  const teacher = bankAdmin(me);
  const admin = me.roles.includes('teacher');
  const wide = useWide();
  const [toast, setToast] = useState(done);
  const queryClient = useQueryClient();
  const students = useStudents();
  const [applied, setApplied] = useState<LedgerFilter>(init);
  const [fullNames, setFullNames] = useState(false);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const [reversing, setReversing] = useState<LedgerRow | null>(null);
  const [reversed, setReversed] = useState<string | null>(null);
  const set = (patch: Partial<LedgerFilter>) => setApplied((f) => ({ ...f, ...patch }));
  const now = today();

  // Tellers for the search; stopped and closed logins are only in the records.
  const tellers = useQuery({
    queryKey: ['admin-tellers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id,display_name,user_roles(role)')
        .eq('login_kind', 'staff').eq('disabled', false).is('closed_at', null).order('display_name');
      if (error) throw error;
      return (data as Staff[]).filter((p) => [p.user_roles ?? []].flat().some((r) => r.role === 'teller'));
    },
  });

  function suggest(text: string): Suggestion[] {
    const q = text.toLowerCase();
    return [
      ...(TXN_NO.test(text) ? [{ key: 'txn', icon: 'passbook' as const, label: `交易号含「${text.toUpperCase()}」`, pick: () => set({ txnNo: text.toUpperCase() }) }] : []),
      ...(tellers.data ?? []).filter((t) => t.display_name.toLowerCase().includes(q)).slice(0, 4)
        .map((t) => ({ key: `t-${t.id}`, icon: 'teacher' as const, label: t.display_name, note: '柜员', pick: () => set({ operator: t.id }) })),
      ...findScopes(students.data?.index ?? [], text, 6).map((s) => ({
        key: `${s.kind}-${s.label}-${s.note}`, icon: SCOPE_ICON[s.kind], note: s.note, pick: () => set({ scope: s }),
        label: s.kind === 'student' ? s.label : `${s.kind === 'class' ? '整个班级' : '整个学部'}：${s.label}`,
      })),
    ];
  }
  const s = applied.scope;
  const row = s?.kind === 'student' ? students.data?.rows.find((r) => r.student_no === s.student_no) : undefined;
  const chips: Chip[] = [
    ...(s ? [{ key: 'scope', label: row ? `${row.name} · 学号 ${row.student_no}` : s.label, clear: () => set({ scope: null }) }] : []),
    ...(applied.operator ? [{ key: 'op', label: `柜员 ${tellers.data?.find((t) => t.id === applied.operator)?.display_name ?? ''}`, clear: () => set({ operator: '' }) }] : []),
    ...(applied.txnNo ? [{ key: 'no', label: `交易号含 ${applied.txnNo}`, clear: () => set({ txnNo: '' }) }] : []),
  ];
  const about = [chips.map((c) => c.label).join(' · ') || '全部学生',
    applied.from || applied.to ? `${applied.from || '最早'} 至 ${applied.to || now}` : `截至 ${now}`].join(' · ');

  const badTime = wrongTimes(applied);
  const list = useInfiniteQuery({
    queryKey: ['admin-txns', applied],
    enabled: !badTime,
    initialPageParam: 0,
    getNextPageParam: (last: Page, pages) => (last.rows.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }): Promise<Page> => {
      const { data, error, count } = await ledgerQuery(LEDGER, applied, pageParam === 0 ? 'exact' : undefined)
        // By when each business happened, so one entered after the fact stands at its original time.
        .order('created_at', { ascending: false }).order('seq', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      const rows = data as unknown as LedgerRow[];
      const reversedIds = rows.filter((r) => r.status === 'reversed').map((r) => r.id);
      const originalIds = rows.flatMap((r) => [r.reversal_of, r.corrects].filter((id): id is string => !!id));
      const [rev, orig, fixed] = await Promise.all([
        reversedIds.length ? supabase.from('txns').select('txn_no,reason,reversal_of').in('reversal_of', reversedIds) : null,
        originalIds.length ? supabase.from('txns').select('id,txn_no').in('id', originalIds) : null,
        reversedIds.length ? supabase.from('txns').select('txn_no,corrects').in('corrects', reversedIds) : null,
      ]);
      if (rev?.error || orig?.error || fixed?.error) throw rev?.error ?? orig?.error ?? fixed?.error;
      return {
        rows, count,
        reversals: new Map((rev?.data ?? []).map((r) => [r.reversal_of as string, { txn_no: r.txn_no, reason: r.reason }])),
        originals: new Map((orig?.data ?? []).map((r) => [r.id, r.txn_no])),
        corrected: new Map((fixed?.data ?? []).map((r) => [r.corrects as string, r.txn_no])),
      };
    },
  });

  const pages = list.data?.pages;
  const rows = pages?.flatMap((p) => p.rows.map((row) => ({ row, page: p })));
  const fresh = useNewRows(rows?.map((r) => r.row.id), JSON.stringify(applied));
  const count = pages?.[0].count;
  async function exportExcel() {
    setExporting('excel');
    setProblem(null);
    try {
      const span = applied.from || applied.to ? `-${applied.from || '最早'}至${applied.to || now}` : `-截至${now}`;
      await saveWorkbook(`流水${span}.xlsx`, [await ledgerSheet(LEDGER, applied, fullNames)]);
      setExporting(null);
    } catch (err) {
      // The sheet stays open to say why.
      setProblem(err instanceof AppError ? explain(err.code, err.detail) : { title: '流水未能导出', text: '请检查网络后再导出一次。' });
      setExporting('pdf');
    }
  }

  const enter = <a className={`dc-btn dc-btn-primary ${wide ? 'dc-btn-sm' : ''}`} {...link('/admin/txns/new')}><Icon name="plus" />补录</a>;
  return (
    <Desk title="流水" actions={admin && wide ? enter : undefined}>
      <div className="dc-enter">
        <FilterBar label="筛选流水" placeholder="搜索学生、班级、柜员或交易号" value={applied} onChange={(f) => set(f)} kinds={KINDS}
          suggest={suggest} chips={chips} actions={
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={badTime || !rows?.length} onClick={() => { setProblem(null); setExporting('pdf'); }}>
              <Icon name="passbook" />打印 / 导出
            </button>
          } />
      </div>

      <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="流水">
        {reversed && <Notice tone="success" title="冲正成功">冲正交易号 {reversed}，原交易已标记为已冲正。</Notice>}
        {badTime ? (
          <Notice tone="danger" title="时段有误">结束时间要晚于开始时间。</Notice>
        ) : list.error && !rows ? (
          <Notice tone="danger" title="暂时无法读取流水">请检查网络后再查询一次。</Notice>
        ) : !rows ? (
          <TxnListLoading />
        ) : rows.length ? (
          <>
            {count != null && <p className="dc-list-title">共 {formatAmount(count)} 笔</p>}
            <ul className="dc-txns">
              {rows.map(({ row, page }, i) => (
                <TxnLine key={row.id} first={!i} isNew={fresh.has(row.id) || (!!done && row.txn_no === init.txnNo)} open={row.txn_no === init.txnNo}
                  row={row} page={page} teacher={teacher} admin={admin} onReverse={() => { setReversed(null); setReversing(row); }} />
              ))}
            </ul>
            {list.isFetchingNextPage && <TxnListLoading rows={2} />}
          </>
        ) : (
          <div className="dc-card">
            <div className="dc-empty">
              <span className="dc-empty-icon"><Icon name="inbox" /></span>
              <h3>没有符合条件的流水</h3>
              <p>换个搜索、日期或类型试试。</p>
            </div>
          </div>
        )}
        {list.error && rows && <Notice tone="danger" title="暂时无法读取更多流水">请检查网络后再试一次。</Notice>}
        {list.hasNextPage && !list.isFetchingNextPage && (
          <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => list.fetchNextPage()}>加载更多</button>
        )}
      </section>
      {admin && !wide && <div className="dc-actions">{enter}</div>}
      {exporting && (
        <OutputSheet title={`导出 ${count ?? ''} 笔流水`} name={`流水-${now}.pdf`} text={about}
          make={() => ledgerPages(LEDGER, applied, fullNames, about)} onClose={() => setExporting(null)} onDone={() => setExporting(null)}
          extra={
            <>
              <label className="dc-check">
                <input type="checkbox" checked={fullNames} onChange={(e) => setFullNames(e.target.checked)} />
                <span className="dc-check-box" />
                <span>导出完整姓名<small>不勾选时为「张*明」</small></span>
              </label>
              {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
              <button className={`dc-btn dc-btn-ghost dc-btn-sm dc-btn-block ${exporting === 'excel' ? 'is-loading' : ''}`} type="button"
                disabled={exporting === 'excel'} onClick={exportExcel}>
                {exporting === 'excel' ? '正在导出' : '下载 Excel'}
              </button>
            </>
          } />
      )}
      {reversing && (
        <ReversalSheet onClose={() => setReversing(null)}
          txn={{ id: reversing.id, txn_no: reversing.txn_no, type: reversing.type, what: `${reversing.students?.name} · ${toTxn(reversing).title} ${formatAmount(reversing.amount)} HTB` }}
          onDone={(r) => {
            setReversing(null);
            setReversed(r.txn_no);
            queryClient.invalidateQueries();
          }} />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </Desk>
  );
}

const PAYMENT = { account: '账户', cash: '现金' } as const;

// The repayments of a loan not reversed.
const repays = (row: LedgerRow) => row.loan?.txns.filter((t) => t.type === 'repay' && t.status === 'normal') ?? [];

// One transaction; it opens to the full facts, links to the student and the teller (teacher), and 冲正 (teacher, on a
// transaction that is not itself a reversal and has not been reversed; a 开定期 while its 定期 is open, a 定期转回 only
// for 提前支取 up to the day it was to mature; a 贷款 while it is 还款中 with no repayment, a 还款 only the loan's latest,
// PHASE-2.md §10.9). The bank admin (`admin`) also has 编辑 on a 存款, 取款, 兑换 or 调账 that stands (§10.11). A business
// entered after the fact says when and by whom, and an 编辑 links its original and what it became. `open` shows it opened.
function TxnLine({ row, page, first, isNew, open, teacher, admin, onReverse }: {
  row: LedgerRow; page: Page; first: boolean; isNew: boolean; open: boolean; teacher: boolean; admin: boolean; onReverse: () => void;
}) {
  const rev = page.reversals.get(row.id);
  const txnLink = (no: string) => <a {...link(`/admin/txns?no=${no}`)}>{no}</a>;
  const corrects = row.corrects && page.originals.get(row.corrects);
  const corrected = page.corrected.get(row.id);
  const items = row.txn_items?.map((i) => (i.qty > 1 ? `${i.name} × ${i.qty}` : i.name)).join('、');
  const facts: [string, ReactNode][] = [
    ['交易号', row.txn_no],
    ['时间', formatTime(row.created_at)],
    ['学生', `${row.students?.name ?? ''} · 学号 ${row.student_no}`],
    ['经办人', row.operator?.display_name ?? ''],
    ['金额', `${formatAmount(row.amount)} HTB`],
    ...(items ? [['商品', items] as [string, ReactNode]] : []),
    ...(row.payment && row.type !== 'opening' ? [['支付方式', PAYMENT[row.payment]] as [string, ReactNode]] : []),
    ['余额变动', row.balance_delta ? `${formatSigned(row.balance_delta)} HTB` : '不变'],
    ...(row.entered_at ? [['补录', `${formatTime(row.entered_at)} 由${row.operator?.display_name ?? ''}补录`]] as [string, ReactNode][] : []),
    ['办理后余额', row.entered_at ? <>{formatAmount(row.balance_after)} HTB<small> 录入时的余额</small></> : `${formatAmount(row.balance_after)} HTB`],
    ...(corrects ? [['更正自', txnLink(corrects)]] as [string, ReactNode][] : []),
    ...(corrected ? [['已更正为', txnLink(corrected)]] as [string, ReactNode][] : []),
    ...(row.type === 'reversal'
      ? [['冲正原因', row.reason ?? ''], ['冲正的交易', page.originals.get(row.reversal_of ?? '') ?? ''],
          ...(row.entered_at ? [['状态', '编辑时冲正']] : [])] as [string, ReactNode][]
      : [['状态', row.status === 'normal' ? '正常' : rev ? `已冲正 · ${rev.reason ?? ''} · 冲正交易号 ${rev.txn_no}` : '已冲正']] as [string, ReactNode][]),
  ];
  const canEdit = admin && row.status === 'normal' && ['deposit', 'withdraw', 'purchase', 'adjust'].includes(row.type);
  const canReverse = teacher && row.status === 'normal' && !['reversal', 'salary', 'interest', 'closing'].includes(row.type)
    && (row.type !== 'term_open' || row.term?.status === 'open')
    && (row.type !== 'term_close' || (row.term?.status === 'early' && row.term.matures_on >= today()))
    // 买理财 until its first day is counted; a 赎回 up to its maturity day (an end at maturity is the system's).
    && (row.type !== 'wealth_buy' || (row.wealth?.status === 'open' && row.wealth.valued_to === row.wealth.starts_on))
    && (row.type !== 'wealth_close' || (row.wealth?.status === 'redeemed' && row.wealth.matures_on >= today()))
    && (row.type !== 'loan' || (row.loan?.status === 'active' && !repays(row).length))
    && (row.type !== 'repay' || (row.loan?.status !== 'reversed' && !repays(row).some((t) => t.created_at > row.created_at)));
  const system = row.type === 'interest' || (row.type === 'term_close' && row.term?.status === 'matured') || (row.type === 'wealth_close' && row.wealth?.status === 'matured') || (row.type === 'repay' && !!row.reason?.startsWith('自动扣款'));
  return (
    <li style={first ? undefined : { borderTop: '2px dashed var(--line)' }}>
      <details open={open || undefined}>
        <summary className={`dc-txn ${toTxn(row).kind} ${isNew ? 'is-new' : ''}`} style={{ listStyle: 'none', cursor: 'pointer' }}>
          <LedgerLine row={row} />
        </summary>
        <div className="dc-stack dc-expand-body">
          <Summary rows={facts} />
          {teacher && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {admin && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(`/admin/students/${row.student_no}`)}><Icon name="me" />查看学生</a>}
              {admin && !system && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(`/admin/staff/${row.operator_id}`)}><Icon name="teacher" />查看经办人</a>}
              {canEdit && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(`/admin/txns/new?edit=${row.id}`)}><Icon name="settings" />编辑</a>}
              {canReverse && <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={onReverse}><Icon name="transfer" />冲正</button>}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
