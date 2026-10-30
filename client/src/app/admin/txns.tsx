import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState, type FormEvent, type ReactNode } from 'react';
import { DatePicker, Desk, Icon, link, Notice, ReversalSheet, Summary, TxnListLoading, today, type IconName } from '@/components';
import { LEDGER, LedgerLine, type LedgerRow } from '@/components/Ledger';
import { formatAmount, formatSigned, formatTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { KINDS as LOOK, toTxn } from '@/lib/txns';

const PAGE = 50;
const KINDS = [['opening', '期初'], ['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换'], ['reversal', '冲正']] as const;
type Kind = (typeof KINDS)[number][0];
type Filters = { studentNo: string; from: string; to: string; kinds: Kind[]; operator: string };
// How each row on a page was corrected: the reversal of a 已冲正 row, and the original of a 冲正 row.
type Page = { rows: LedgerRow[]; count: number | null; reversals: Map<string, { txn_no: string; reason: string | null }>; originals: Map<string, string> };
type Staff = { id: string; display_name: string; user_roles: { role: string } | { role: string }[] | null };

const EMPTY: Filters = { studentNo: '', from: '', to: '', kinds: [], operator: '' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Filters from the address, so other pages can link here: ?student=&operator=&from=&to=&type=deposit,withdraw.
function fromParams(p: Record<string, string | string[] | undefined>): Filters {
  const one = (k: string) => [p[k]].flat()[0]?.trim() ?? '';
  const day = (k: string) => (DAY.test(one(k)) ? one(k) : '');
  const kinds = one('type').split(',').filter((k): k is Kind => KINDS.some(([x]) => x === k));
  return { studentNo: one('student'), operator: one('operator'), from: day('from'), to: day('to'), kinds };
}

function Field({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <label className="dc-field">
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      {children}
    </label>
  );
}

// 流水 (accountant, teacher): every transaction, newest first, 50 at a time, filtered by student, school days
// (Asia/Shanghai), type and teller. A new address starts over with its own filters.
export default function Txns() {
  const params = useLocalSearchParams();
  const init = fromParams(params);
  return <Ledger key={JSON.stringify(init)} init={init} />;
}

function Ledger({ init }: { init: Filters }) {
  const me = useMe().data!;
  const teacher = me.roles.includes('teacher');
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Filters>(init);
  const [applied, setApplied] = useState<Filters>(init);
  const [reversing, setReversing] = useState<LedgerRow | null>(null);
  const [reversed, setReversed] = useState<string | null>(null);
  const set = (patch: Partial<Filters>) => setDraft((f) => ({ ...f, ...patch }));
  const now = today();

  // Tellers for the filter.
  const tellers = useQuery({
    queryKey: ['admin-tellers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id,display_name,user_roles(role)')
        .eq('login_kind', 'staff').order('display_name');
      if (error) throw error;
      return (data as Staff[]).filter((p) => {
        const roles = [p.user_roles ?? []].flat();
        return roles.some((r) => r.role === 'teller');
      });
    },
  });

  const list = useInfiniteQuery({
    queryKey: ['admin-txns', applied],
    initialPageParam: 0,
    getNextPageParam: (last: Page, pages) => (last.rows.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }): Promise<Page> => {
      let q = supabase.from('txns').select(LEDGER, { count: pageParam === 0 ? 'exact' : undefined });
      if (applied.studentNo.trim()) q = q.eq('student_no', applied.studentNo.trim());
      if (applied.from) q = q.gte('created_at', `${applied.from}T00:00:00+08:00`);
      if (applied.to) q = q.lte('created_at', `${applied.to}T23:59:59.999+08:00`);
      if (applied.kinds.length) q = q.in('type', applied.kinds);
      if (applied.operator) q = q.eq('operator_id', applied.operator);
      const { data, error, count } = await q.order('seq', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
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
  const toggle = (k: Kind) => set({ kinds: draft.kinds.includes(k) ? draft.kinds.filter((x) => x !== k) : [...draft.kinds, k] });
  const search = (e: FormEvent) => {
    e.preventDefault();
    setApplied(draft);
  };

  return (
    <Desk title="流水">
      <form className="dc-card dc-stack dc-enter" role="search" aria-label="筛选流水" onSubmit={search}>
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Field icon="me" label="学号">
            <span className="dc-input-wrap">
              <input className="dc-input" inputMode="numeric" value={draft.studentNo} placeholder="全部学生"
                onChange={(e) => set({ studentNo: e.target.value })} />
            </span>
          </Field>
          <Field icon="teacher" label="柜员">
            <span className="dc-select">
              <select value={draft.operator} onChange={(e) => set({ operator: e.target.value })}>
                <option value="">全部柜员</option>
                {tellers.data?.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
              </select>
            </span>
          </Field>
          <DatePicker label="开始日期" value={draft.from} placeholder="不限" max={draft.to || now} rule="今天之后的日期不能选"
            onChange={(from) => set({ from })} />
          <DatePicker label="结束日期" value={draft.to} placeholder="不限" min={draft.from || undefined} max={now}
            rule={draft.from ? '不能早于开始日期' : '今天之后的日期不能选'} onChange={(to) => set({ to })} />
        </div>
        <div className="dc-chips" role="group" aria-label="类型">
          {KINDS.map(([k, label]) => (
            <button key={k} className="dc-chip" type="button" aria-pressed={draft.kinds.includes(k)} onClick={() => toggle(k)}>
              <Icon name="check" />{label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="dc-btn dc-btn-ghost" type="button" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); }}>清除条件</button>
          <button className="dc-btn dc-btn-primary" type="submit"><Icon name="query" />查询</button>
        </div>
      </form>

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
              <p>换个学号、日期或类型再查询。</p>
            </div>
          </div>
        )}
        {list.error && rows && <Notice tone="danger" title="暂时无法读取更多流水">请检查网络后再试一次。</Notice>}
        {list.hasNextPage && !list.isFetchingNextPage && (
          <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => list.fetchNextPage()}>加载更多</button>
        )}
      </section>
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
  const canReverse = teacher && row.status === 'normal' && row.type !== 'reversal';
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
