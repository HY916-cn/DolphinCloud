import { useState } from 'react';
import { NO_FILTER, Notice, Passbook, PassbookPage, PassbookRows, signed, TxnListLoading, useTerm } from '@/components';
import { formatAmount } from '@/lib/format';
import { TXN_TABS as TABS, useLedger, useMonth, type TxnTab as Tab } from '@/lib/ledger';
import { useMe } from '@/lib/session';
import { toTxn } from '@/lib/txns';

// 明细: every business printed on the 存折's pages, newest first, 30 lines a page, by type on the printed tabs; facing
// it, this month from last month's closing balance to now, and this term's money in and out.
export default function BookTxns() {
  const student = useMe().data!.student!;
  const [tab, setTab] = useState<Tab>('all');
  const list = useLedger(student.student_no, tab, NO_FILTER);
  const { m, totals } = useMonth(student.student_no);
  const term = useTerm(student.student_no).data;
  const rows = list.data?.pages.flat().map(toTxn);
  const value = (n: number | undefined, show = formatAmount) => (n === undefined ? '…' : show(n));

  return (
    <Passbook spread>
      <PassbookPage title="交易明细" foot={`第 1${(list.data?.pages.length ?? 1) > 1 ? `–${list.data!.pages.length}` : ''} 页`}>
        <div className="dc-pb-types" role="tablist" aria-label="交易类型">
          {(Object.keys(TABS) as Tab[]).map((k) => (
            <button key={k} id={`txns-tab-${k}`} role="tab" type="button" aria-selected={tab === k} aria-controls="txns-panel"
              onClick={() => setTab(k)}>{TABS[k].label}</button>
          ))}
        </div>
        <div id="txns-panel" role="tabpanel" aria-labelledby={`txns-tab-${tab}`}>
          {list.error && !rows ? <Notice tone="danger" title="暂时无法读取交易明细">请检查网络后刷新页面。</Notice>
            : !rows ? <TxnListLoading /> : rows.length ? <PassbookRows items={rows} /> : (
              <p className="dc-pb-empty"><b>{TABS[tab].empty}</b>{TABS[tab].hint}</p>
            )}
          {list.isFetchingNextPage && <TxnListLoading rows={2} />}
          {list.error && rows && <Notice tone="danger" title="暂时无法读取更早的交易">请检查网络后再试一次。</Notice>}
          {list.hasNextPage && !list.isFetchingNextPage && (
            <button className="dc-btn dc-btn-secondary dc-btn-block dc-pb-more" type="button" onClick={() => list.fetchNextPage()}>翻到更早的一页</button>
          )}
        </div>
      </PassbookPage>
      <PassbookPage title={`${m}月收支`} foot="海豚银行对账">
        {totals.error ? <Notice tone="danger" title="暂时无法读取本月收支">请检查网络后刷新页面。</Notice> : (
          <dl className="dc-pb-fields">
            <dt>{m === 1 ? 12 : m - 1}月底余额</dt><dd>{value(totals.data?.opening)}</dd>
            <dt>本月存入</dt><dd className="is-in">{value(totals.data?.saved, signed)}</dd>
            <dt>本月支出</dt><dd>{value(totals.data?.spent, signed)}</dd>
            <dt>当前余额</dt><dd className="is-total">{value(totals.data?.balance)}<small>HTB</small></dd>
          </dl>
        )}
        <h3 className="dc-pb-sub">本学期</h3>
        <dl className="dc-pb-fields">
          <dt>存入</dt><dd className="is-in">{value(term?.saved, signed)}</dd>
          <dt>支出</dt><dd>{value(term?.spent, signed)}</dd>
        </dl>
      </PassbookPage>
    </Passbook>
  );
}
