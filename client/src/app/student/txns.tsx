import { useState } from 'react';
import { FilterBar, filtered, Icon, NO_FILTER, Notice, Page, signed, TxnList, TxnListLoading, type Filter } from '@/components';
import { formatAmount } from '@/lib/format';
import { TXN_TABS as TABS, useLedger, useMonth, type TxnTab as Tab } from '@/lib/ledger';
import { useNewRows } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { toTxn, type Txn, type TxnRow } from '@/lib/txns';

const enter = (i: number, className = '') => ({ className: `dc-stack dc-enter ${className}`, style: { '--i': i } as React.CSSProperties });

// Consecutive rows of one day under one heading: "11月3日" and the time.
function byDay(rows: TxnRow[]) {
  const days: { day: string; items: Txn[] }[] = [];
  for (const r of rows) {
    const t = toTxn(r);
    const [day, time] = t.time.split(' ');
    if (days.at(-1)?.day === day) days.at(-1)!.items.push({ ...t, time });
    else days.push({ day, items: [{ ...t, time }] });
  }
  return days;
}

// 明细: every business of the account newest first, 30 at a time, under its day; by type on the tabs (存款, 取款, 兑换,
// 工资), found by words of a 交易号 or a product and by days; beside it, this month from last month's closing balance
// to now.
export default function StudentTxns() {
  const student = useMe().data!.student!;
  const [tab, setTab] = useState<Tab>('all');
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const list = useLedger(student.student_no, tab, filter);
  const { m, totals } = useMonth(student.student_no);

  const rows = list.data?.pages.flat();
  const fresh = useNewRows(rows?.map((r) => toTxn(r).key), JSON.stringify([tab, filter]));
  const amount = (n: number | undefined, show = formatAmount) =>
    n === undefined ? <span className="dc-skeleton" style={{ display: 'inline-block', width: 48, height: 22 }} /> : show(n);
  const narrowed = filtered(filter);

  return (
    <Page title="明细">
      {(list.error && !rows) || totals.error ? (
        <Notice tone="danger" title="暂时无法读取交易明细">请检查网络后刷新页面。</Notice>
      ) : (
        <div className="dc-split">
          <section {...enter(1)}>
            <FilterBar label="筛选明细" placeholder="搜索交易号或商品" value={filter} onChange={setFilter} />
            <div className="dc-stack">
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
                    <TxnList items={items} fresh={fresh} />
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
                  <button className="dc-btn dc-btn-secondary dc-btn-block" type="button" onClick={() => list.fetchNextPage()}>加载更多</button>
                )}
              </div>
            </div>
          </section>
          <div {...enter(0, 'is-sticky')}>
            <section className="dc-card">
              <h2 className="heading has-gap">{m}月收支</h2>
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
