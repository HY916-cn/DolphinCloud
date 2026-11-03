import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FilterBar, filtered, Icon, NO_FILTER, Notice, Page, signed, TxnList, TxnListLoading, type Filter } from '@/components';
import { formatAmount, formatTime } from '@/lib/format';
import { useMe } from '@/lib/session';
import { readAll, supabase } from '@/lib/supabase';
import { toTxn, type Txn, type TxnRow } from '@/lib/txns';

const enter = (i: number, className = '') => ({ className: `dc-stack dc-enter ${className}`, style: { '--i': i } as React.CSSProperties });
const PAGE = 30;
const TABS = {
  all: { label: '全部', empty: '还没有交易记录', hint: '在柜台办理存款后，这里会显示每一笔交易。' },
  deposit: { label: '存款', empty: '还没有存款记录', hint: '在柜台存款后，这里会显示每一笔存款。' },
  withdraw: { label: '取款', empty: '还没有取款记录', hint: '在柜台取款后，这里会显示每一笔取款。' },
  purchase: { label: '兑换', empty: '还没有兑换记录', hint: '在柜台兑换商品后，这里会显示每一笔兑换。' },
  salary: { label: '工资', empty: '还没有工资记录', hint: '担任柜员并参与考勤后，工资每周发到这里。' },
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

// 明细: every business of the account, newest first, 30 at a time, by type (存款, 取款, 兑换, 工资), found by words of
// a 交易号 or a product and by days; and this month's money in and out between last month's closing balance and now.
export default function StudentTxns() {
  const student = useMe().data!.student!;
  const [tab, setTab] = useState<Tab>('all');
  const [filter, setFilter] = useState<Filter>(NO_FILTER);

  const list = useInfiniteQuery({
    queryKey: ['student-txns', student.student_no, tab, filter],
    initialPageParam: 0,
    getNextPageParam: (last: TxnRow[], pages) => (last.length === PAGE ? pages.length : undefined),
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('txns').select('id,type,amount,balance_delta,payment,status,reason,created_at,txn_items(name,qty)')
        .eq('student_no', student.student_no);
      if (tab !== 'all') q = q.eq('type', tab);
      if (filter.from) q = q.gte('created_at', `${filter.from}T00:00:00+08:00`);
      if (filter.to) q = q.lte('created_at', `${filter.to}T23:59:59.999+08:00`);
      if (filter.timeFrom) q = q.gte('cn_time', filter.timeFrom);
      if (filter.timeTo) q = q.lt('cn_time', filter.timeTo);
      const words = filter.text.trim().replace(/[%_\\,()*]/g, '');
      if (words) {
        // A product's name is in txn_items; the transactions holding it join the ones whose 交易号 matches.
        // Only this student's items, so the cap holds every match but a student's 500th purchase of the same product.
        const { data, error } = await supabase.from('txn_items').select('txn_id,txns!inner(student_no)')
          .eq('txns.student_no', student.student_no).ilike('name', `%${words}%`).limit(500);
        if (error) throw error;
        q = q.or([`txn_no.ilike.*${words}*`, ...(data.length ? [`id.in.(${data.map((i) => i.txn_id).join(',')})`] : [])].join(','));
      }
      const { data, error } = await q.order('seq', { ascending: false }).range(pageParam * PAGE, pageParam * PAGE + PAGE - 1);
      if (error) throw error;
      return data as TxnRow[];
    },
  });

  // The month as the school reads it (Asia/Shanghai): "2026-10". Every change to the balance since it began, 冲正
  // included, so last month's closing balance, what came in and what went out add up to the balance now.
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  const m = Number(month.slice(5));
  const totals = useQuery({
    queryKey: ['student-month', student.student_no, month],
    queryFn: async () => {
      const [account, data] = await Promise.all([
        supabase.from('accounts').select('balance').eq('student_no', student.student_no).single(),
        readAll<{ balance_delta: number }>((from, to) => supabase.from('txns').select('balance_delta')
          .eq('student_no', student.student_no).gte('created_at', `${month}-01T00:00:00+08:00`).order('seq').range(from, to)),
      ]);
      if (account.error) throw account.error;
      const saved = data.reduce((n, t) => n + Math.max(t.balance_delta, 0), 0);
      const spent = data.reduce((n, t) => n + Math.min(t.balance_delta, 0), 0);
      return { balance: account.data.balance, saved, spent, opening: account.data.balance - saved - spent };
    },
  });

  const rows = list.data?.pages.flat();
  const amount = (n: number | undefined, show = formatAmount) =>
    n === undefined ? <span className="dc-skeleton" style={{ display: 'inline-block', width: 48, height: 22 }} /> : show(n);
  const narrowed = filtered(filter);

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
            <FilterBar label="筛选明细" placeholder="搜索交易号或商品" value={filter} onChange={setFilter} />
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
                    <h3>{narrowed ? '没有符合条件的交易' : TABS[tab].empty}</h3>
                    <p>{narrowed ? '换个搜索或日期试试。' : TABS[tab].hint}</p>
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
            <section className="dc-card">
              <h2 className="heading" style={{ margin: '0 0 var(--space-3)' }}>{m}月收支</h2>
              <dl className="dc-kv">
                <div><dt>{m === 1 ? 12 : m - 1}月底余额</dt><dd>{amount(totals.data?.opening)}</dd></div>
                <div><dt>存入</dt><dd>{amount(totals.data?.saved, signed)}</dd></div>
                <div><dt>支出</dt><dd>{amount(totals.data?.spent, signed)}</dd></div>
                <div className="is-total"><dt>当前余额</dt><dd>{amount(totals.data?.balance)}<small>HTB</small></dd></div>
              </dl>
            </section>
          </div>
        </div>
      )}
    </Page>
  );
}
