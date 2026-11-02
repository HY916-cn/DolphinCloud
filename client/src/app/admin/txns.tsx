import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  Desk, FilterBar, Icon, link, Notice, OutputSheet, ReversalSheet, SCOPE_ICON, Summary, TxnListLoading, today, type Chip, type Suggestion,
} from '@/components';
import { LEDGER, LedgerLine, type LedgerRow } from '@/components/Ledger';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatSigned, formatTime } from '@/lib/format';
import { ledgerPages, ledgerQuery, ledgerSheet, NO_LEDGER, saveWorkbook, type LedgerFilter } from '@/lib/reports';
import { findScopes } from '@/lib/search';
import { useMe } from '@/lib/session';
import { useStudents } from '@/lib/students';
import { supabase } from '@/lib/supabase';
import { KINDS as LOOK, toTxn } from '@/lib/txns';

const PAGE = 50;
const KINDS = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换'], ['reversal', '冲正'], ['salary', '工资'], ['opening', '期初'], ['closing', '注销清零']] as const;
type Kind = (typeof KINDS)[number][0];
// How each row on a page was corrected: the reversal of a 已冲正 row, and the original of a 冲正 row.
type Page = { rows: LedgerRow[]; count: number | null; reversals: Map<string, { txn_no: string; reason: string | null }>; originals: Map<string, string> };
type Staff = { id: string; display_name: string; user_roles: { role: string } | { role: string }[] | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TXN_NO = /^(ht)?\d{2,}$/i;

// Filters from the address, so other pages can link here: ?student=&operator=&from=&to=&type=deposit,withdraw.
function fromParams(p: Record<string, string | string[] | undefined>): LedgerFilter {
  const one = (k: string) => [p[k]].flat()[0]?.trim() ?? '';
  const day = (k: string) => (DAY.test(one(k)) ? one(k) : '');
  const kinds = one('type').split(',').filter((k): k is Kind => KINDS.some(([x]) => x === k));
  const no = one('student');
  return { ...NO_LEDGER, scope: no ? { kind: 'student', student_no: no, label: `学号 ${no}`, note: '' } : null,
    operator: one('operator'), from: day('from'), to: day('to'), kinds };
}

// 流水 (accountant, teacher): every transaction, newest first, 50 at a time. One search finds a student, a class or
// 学部 (the counter's search), a teller or part of a 交易号; then the days, the types and, when asked for, a 时段 of
// each day (Asia/Shanghai). A new address starts over with its own filters. 打印 / 导出 prints the transactions the
// filters choose, or keeps them as a PDF or an Excel file.
export default function Txns() {
  const params = useLocalSearchParams();
  const init = fromParams(params);
  return <Ledger key={JSON.stringify(init)} init={init} />;
}

function Ledger({ init }: { init: LedgerFilter }) {
  const me = useMe().data!;
  const teacher = me.roles.includes('teacher');
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

  const list = useInfiniteQuery({
    queryKey: ['admin-txns', applied],
    initialPageParam: 0,
    getNextPageParam: (last: Page, pages) => (last.rows.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }): Promise<Page> => {
      const { data, error, count } = await ledgerQuery(LEDGER, applied, pageParam === 0 ? 'exact' : undefined)
        .order('seq', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      const rows = data as unknown as LedgerRow[];
      const reversedIds = rows.filter((r) => r.status === 'reversed').map((r) => r.id);
      const originalIds = rows.flatMap((r) => (r.reversal_of ? [r.reversal_of] : []));
      const [rev, orig] = await Promise.all([
        reversedIds.length ? supabase.from('txns').select('txn_no,reason,reversal_of').in('reversal_of', reversedIds) : null,
        originalIds.length ? supabase.from('txns').select('id,txn_no').in('id', originalIds) : null,
      ]);
      if (rev?.error || orig?.error) throw rev?.error ?? orig?.error;
      return {
        rows, count,
        reversals: new Map((rev?.data ?? []).map((r) => [r.reversal_of as string, { txn_no: r.txn_no, reason: r.reason }])),
        originals: new Map((orig?.data ?? []).map((r) => [r.id, r.txn_no])),
      };
    },
  });

  const pages = list.data?.pages;
  const rows = pages?.flatMap((p) => p.rows.map((row) => ({ row, page: p })));
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

  return (
    <Desk title="流水">
      <div className="dc-enter">
        <FilterBar label="筛选流水" placeholder="搜索学生、班级、柜员或交易号" value={applied} onChange={(f) => set(f)} kinds={KINDS}
          suggest={suggest} chips={chips} actions={
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={!rows?.length} onClick={() => { setProblem(null); setExporting('pdf'); }}>
              <Icon name="passbook" />打印 / 导出
            </button>
          } />
      </div>

      <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="流水">
        {reversed && <Notice tone="success" title="冲正成功">冲正交易号 {reversed}，原交易已标记为已冲正。</Notice>}
        {list.error && !rows ? (
          <Notice tone="danger" title="暂时无法读取流水">请检查网络后再查询一次。</Notice>
        ) : !rows ? (
          <TxnListLoading />
        ) : rows.length ? (
          <>
            {count != null && <p className="dc-list-title">共 {formatAmount(count)} 笔</p>}
            <ul className="dc-txns">
              {rows.map(({ row, page }, i) => (
                <TxnLine key={row.id} first={!i} row={row} page={page} teacher={teacher} onReverse={() => { setReversed(null); setReversing(row); }} />
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
          txn={{ id: reversing.id, txn_no: reversing.txn_no, what: `${reversing.students?.name} · ${toTxn(reversing).title} ${formatAmount(reversing.amount)} HTB` }}
          onDone={(r) => {
            setReversing(null);
            setReversed(r.txn_no);
            queryClient.invalidateQueries();
          }} />
      )}
    </Desk>
  );
}

const PAYMENT = { account: '账户', cash: '现金' } as const;

// One transaction; it opens to the full facts, links to the student and the teller (teacher), and 冲正 (teacher, on a
// transaction that is not itself a reversal and has not been reversed).
function TxnLine({ row, page, first, teacher, onReverse }: {
  row: LedgerRow; page: Page; first: boolean; teacher: boolean; onReverse: () => void;
}) {
  const rev = page.reversals.get(row.id);
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
    ['办理后余额', `${formatAmount(row.balance_after)} HTB`],
    ...(row.type === 'reversal'
      ? [['冲正原因', row.reason ?? ''], ['冲正的交易', page.originals.get(row.reversal_of ?? '') ?? '']] as [string, ReactNode][]
      : [['状态', row.status === 'normal' ? '正常' : rev ? `已冲正 · ${rev.reason ?? ''} · 冲正交易号 ${rev.txn_no}` : '已冲正']] as [string, ReactNode][]),
  ];
  const canReverse = teacher && row.status === 'normal' && row.type !== 'reversal' && row.type !== 'salary';
  return (
    <li style={first ? undefined : { borderTop: '2px dashed var(--line)' }}>
      <details>
        <summary className={`dc-txn ${LOOK[row.type].kind}`} style={{ listStyle: 'none', cursor: 'pointer' }}>
          <LedgerLine row={row} />
        </summary>
        <div className="dc-stack" style={{ paddingLeft: 'calc(52px + var(--space-3))', paddingBottom: 'var(--space-3)' }}>
          <Summary rows={facts} />
          {teacher && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(`/admin/students/${row.student_no}`)}><Icon name="me" />查看学生</a>
              <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link(`/admin/staff/${row.operator_id}`)}><Icon name="teacher" />查看经办人</a>
              {canReverse && <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={onReverse}><Icon name="transfer" />冲正</button>}
            </div>
          )}
        </div>
      </details>
    </li>
  );
}
