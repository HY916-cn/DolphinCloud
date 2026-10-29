import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Desk, Icon, Notice, TxnListLoading, type IconName } from '@/components';
import { formatAmount, formatSigned } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { toTxn, type TxnRow } from '@/lib/txns';

const PAGE = 50;
const KINDS = [['opening', '期初'], ['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换'], ['reversal', '冲正']] as const;
type Kind = (typeof KINDS)[number][0];
type Filters = { studentNo: string; from: string; to: string; kinds: Kind[]; operator: string };
type Row = TxnRow & {
  txn_no: string; student_no: string; students: { name: string } | null; operator: { display_name: string } | null;
};
type Staff = { id: string; display_name: string; user_roles: { role: string } | { role: string }[] | null };

const EMPTY: Filters = { studentNo: '', from: '', to: '', kinds: [], operator: '' };

function Field({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <label className="dc-field">
      <span className="dc-field-label"><Icon name={icon} />{label}</span>
      {children}
    </label>
  );
}

// 流水 (accountant, teacher): every transaction, newest first, 50 at a time, filtered by student, school days
// (Asia/Shanghai), type and teller.
export default function Txns() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const set = (patch: Partial<Filters>) => setDraft((f) => ({ ...f, ...patch }));

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
    getNextPageParam: (last: { rows: Row[]; count: number | null }, pages) => (last.rows.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('txns')
        .select('id,txn_no,type,amount,balance_delta,payment,status,reason,created_at,student_no,txn_items(name,qty),'
          + 'students(name),operator:profiles!txns_operator_id_fkey(display_name)', { count: pageParam === 0 ? 'exact' : undefined });
      if (applied.studentNo.trim()) q = q.eq('student_no', applied.studentNo.trim());
      if (applied.from) q = q.gte('created_at', `${applied.from}T00:00:00+08:00`);
      if (applied.to) q = q.lte('created_at', `${applied.to}T23:59:59.999+08:00`);
      if (applied.kinds.length) q = q.in('type', applied.kinds);
      if (applied.operator) q = q.eq('operator_id', applied.operator);
      const { data, error, count } = await q.order('seq', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as Row[], count };
    },
  });

  const rows = list.data?.pages.flatMap((p) => p.rows);
  const count = list.data?.pages[0].count;
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
          <Field icon="calendar" label="开始日期">
            <span className="dc-input-wrap">
              <input className="dc-input" type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            </span>
          </Field>
          <Field icon="calendar" label="结束日期">
            <span className="dc-input-wrap">
              <input className="dc-input" type="date" value={draft.to} min={draft.from || undefined} onChange={(e) => set({ to: e.target.value })} />
            </span>
          </Field>
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
        {list.error && !rows ? (
          <Notice tone="danger" title="暂时无法读取流水">请检查网络后再查询一次。</Notice>
        ) : !rows ? (
          <TxnListLoading />
        ) : rows.length ? (
          <>
            {count != null && <p className="dc-list-title">共 {formatAmount(count)} 笔</p>}
            <ul className="dc-txns">{rows.map((r) => <TxnLine key={r.id} row={r} />)}</ul>
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
    </Desk>
  );
}

// One transaction: "业务 · 详情", who and which teller, 交易号 and time, and the change to the balance; a cash
// purchase leaves the balance as it is and shows the amount paid in cash.
function TxnLine({ row }: { row: Row }) {
  const t = toTxn(row);
  const delta = row.balance_delta;
  return (
    <li className="dc-txn">
      <span className="dc-txn-icon"><Icon name={t.icon} /></span>
      <div className="dc-txn-main">
        <div className="dc-txn-title">{t.title}</div>
        <div className="dc-txn-time">{row.students?.name} · 学号 {row.student_no} · 经办人 {row.operator?.display_name}</div>
        <div className="dc-txn-time">交易号 {row.txn_no} · {t.time}</div>
      </div>
      <div className={`dc-txn-amount ${delta > 0 ? 'is-in' : ''}`}>
        {delta ? formatSigned(delta) : formatAmount(row.amount)}<small>{delta ? t.note : '现金'}</small>
      </div>
    </li>
  );
}
