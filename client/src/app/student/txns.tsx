import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon, Notice, Page, TxnList, TxnListLoading } from '@/components';
import { formatSigned, formatTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { toTxn, type Txn, type TxnRow } from '@/lib/txns';

const enter = (i: number, className = '') => ({ className: `dc-stack dc-enter ${className}`, style: { '--i': i } as React.CSSProperties });
const PAGE = 30;
const TABS = {
  all: { label: '全部', empty: '还没有交易记录', hint: '在柜台办理存款后，这里会显示每一笔交易。' },
  in: { label: '存入', empty: '还没有存入记录', hint: '在柜台存款后，这里会显示每一笔存入。' },
  out: { label: '支出', empty: '还没有支出记录', hint: '取款或用账户兑换后，这里会显示每一笔支出。' },
} as const;
type Tab = keyof typeof TABS;

// Consecutive rows of one day under one heading; formatTime gives "10月27日 14:20", split into the day and the time.
function byDay(rows: TxnRow[]) {
  const days: { day: string; items: Txn[] }[] = [];
  for (const r of rows) {
    const [day, time] = formatTime(r.created_at).split(' ');
    const item = { ...toTxn(r), time };
    if (days.at(-1)?.day === day) days.at(-1)!.items.push(item);
    else days.push({ day, items: [item] });
  }
  return days;
}

// 明细: every business of the account, newest first, 30 at a time (全部 includes cash exchanges; 存入 and 支出 are the
// changes to the balance), and this month's totals of those changes.
export default function StudentTxns() {
  const student = useMe().data!.student!;
  const [tab, setTab] = useState<Tab>('all');

  const list = useInfiniteQuery({
    queryKey: ['student-txns', student.student_no, tab],
    initialPageParam: 0,
    getNextPageParam: (last: TxnRow[], pages) => (last.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }) => {
      const q = supabase.from('txns').select('id,type,amount,balance_delta,payment,status,reason,created_at,txn_items(name,qty)')
        .eq('student_no', student.student_no);
      const { data, error } = await (tab === 'in' ? q.gt('balance_delta', 0) : tab === 'out' ? q.lt('balance_delta', 0) : q)
        .order('seq', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      return data as TxnRow[];
    },
  });

  // The month as the school reads it (Asia/Shanghai): "2026-10".
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  const totals = useQuery({
    queryKey: ['student-month', student.student_no, month],
    queryFn: async () => {
      const { data, error } = await supabase.from('txns').select('balance_delta').eq('student_no', student.student_no)
        .neq('balance_delta', 0).gte('created_at', `${month}-01T00:00:00+08:00`);
      if (error) throw error;
      return data.reduce((s, { balance_delta: d }) => (d > 0 ? { ...s, in: s.in + d } : { ...s, out: s.out + d }), { in: 0, out: 0 });
    },
  });

  const rows = list.data?.pages.flat();
  const amount = (n: number | undefined) =>
    n === undefined ? <span className="dc-skeleton" style={{ display: 'inline-block', width: 48, height: 22 }} /> : n ? formatSigned(n) : '0';

  return (
    <Page title="明细">
      {(list.error && !rows) || totals.error ? (
        <Notice tone="danger" title="暂时无法读取交易明细">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-split">
          <section {...enter(0)}>
            <div className="dc-tabs" role="tablist" aria-label="交易类型">
              {(Object.keys(TABS) as Tab[]).map((k) => (
                <button key={k} id={`txns-tab-${k}`} className="dc-tabs-item" role="tab" type="button" aria-selected={tab === k}
                  aria-controls="txns-panel" onClick={() => setTab(k)}>{TABS[k].label}</button>
              ))}
            </div>
            <div id="txns-panel" className="dc-stack" role="tabpanel" aria-labelledby={`txns-tab-${tab}`}>
              {!rows ? <TxnListLoading /> : rows.length ? byDay(rows).map(({ day, items }) => (
                <div key={day}>
                  <p className="dc-list-title">{day}</p>
                  <TxnList items={items} />
                </div>
              )) : (
                <div className="dc-card">
                  <div className="dc-empty">
                    <span className="dc-empty-icon"><Icon name="inbox" /></span>
                    <h3>{TABS[tab].empty}</h3>
                    <p>{TABS[tab].hint}</p>
                  </div>
                </div>
              )}
              {list.isFetchingNextPage && <TxnListLoading rows={2} />}
              {list.error && rows && <Notice tone="danger" title="暂时无法读取更早的交易">请检查网络后再试一次。</Notice>}
              {list.hasNextPage && !list.isFetchingNextPage && (
                <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => list.fetchNextPage()}>加载更早的交易</button>
              )}
            </div>
          </section>
          <div {...enter(1, 'is-sticky')}>
            <div className="dc-card">
              <h2 className="heading" style={{ margin: '0 0 var(--space-2)' }}>本月收支</h2>
              <dl className="dc-kv">
                <div><dt>存入</dt><dd>{amount(totals.data?.in)}</dd></div>
                <div><dt>支出</dt><dd>{amount(totals.data?.out)}</dd></div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
