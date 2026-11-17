import { useState } from 'react';
import { BookPages, NO_FILTER, Notice, PassbookPage, PassbookRows, signed, TxnListLoading, useLines, useTerm } from '@/components';
import { formatAmount, signClass } from '@/lib/format';
import { TXN_TABS as TABS, useLedger, useMonth, type TxnTab as Tab } from '@/lib/ledger';
import { useMe } from '@/lib/session';
import { toTxn } from '@/lib/txns';

// 明细: first this month from last month's closing balance to now and this term's money in and out; then every business
// printed on the 存折's pages, newest first, as many lines a page as it holds, by type on the printed tabs of the first.
// Turning to a page past the lines read so far reads the next ones.
export default function BookTxns() {
  const student = useMe().data!.student!;
  const [tab, setTab] = useState<Tab>('all');
  const list = useLedger(student.student_no, tab, NO_FILTER);
  const { m, totals } = useMonth(student.student_no);
  const term = useTerm(student.student_no).data;
  const lines = useLines();
  const rows = list.data?.pages.flat().map(toTxn);
  const n = rows?.length ?? 0;
  const sheets = Math.max(1, Math.ceil(n / lines) + (list.hasNextPage && n % lines === 0 ? 1 : 0));
  const value = (v: number | undefined, show = formatAmount) => (v === undefined ? '…' : show(v));

  const sheet = (k: number) => {
    const items = rows?.slice(k * lines, (k + 1) * lines);
    const body = list.error && !items?.length ? <Notice tone="danger" title={k ? '暂时无法读取更早的交易' : '暂时无法读取交易明细'}>请检查网络后再试一次。</Notice>
      : !items || (!items.length && list.hasNextPage) ? <TxnListLoading />
        : items.length ? <PassbookRows items={items} lines={lines} start={k * lines} />
          : <p className="dc-pb-empty"><b>{TABS[tab].empty}</b>{TABS[tab].hint}</p>;
    return (
      <PassbookPage key={`lines-${k}`} title="交易明细" side={k ? <small>续页</small> : undefined}>
        {k === 0 ? <>
          <div className="dc-pb-types" role="tablist" aria-label="交易类型">
            {(Object.keys(TABS) as Tab[]).map((t) => (
              <button key={t} id={`txns-tab-${t}`} role="tab" type="button" aria-selected={tab === t} aria-controls="txns-panel"
                onClick={() => setTab(t)}>{TABS[t].label}</button>
            ))}
          </div>
          <div id="txns-panel" role="tabpanel" aria-labelledby={`txns-tab-${tab}`}>{body}</div>
        </> : body}
      </PassbookPage>
    );
  };

  return (
    <BookPages
      onShow={(last) => { if (last * lines > n && list.hasNextPage && !list.isFetchingNextPage) list.fetchNextPage(); }}
      pages={[
        <PassbookPage key="month" title={`${m}月收支`}>
          {totals.error ? <Notice tone="danger" title="暂时无法读取本月收支">请检查网络后刷新页面。</Notice> : (
            <dl className="dc-pb-fields">
              <dt>{m === 1 ? 12 : m - 1}月底余额</dt><dd>{value(totals.data?.opening)}</dd>
              <dt>本月存入</dt><dd className={signClass(totals.data?.saved ?? 0)}>{value(totals.data?.saved, signed)}</dd>
              <dt>本月支出</dt><dd className={signClass(totals.data?.spent ?? 0)}>{value(totals.data?.spent, signed)}</dd>
              <dt>当前余额</dt><dd className="is-total">{value(totals.data?.balance)}<small>HTB</small></dd>
            </dl>
          )}
          <h3 className="dc-pb-sub">本学期</h3>
          <dl className="dc-pb-fields">
            <dt>存入</dt><dd className={signClass(term?.saved ?? 0)}>{value(term?.saved, signed)}</dd>
            <dt>支出</dt><dd className={signClass(term?.spent ?? 0)}>{value(term?.spent, signed)}</dd>
          </dl>
          <p className="dc-pb-hint">往后翻是每一笔交易，最新的在最前面。</p>
        </PassbookPage>,
        ...Array.from({ length: sheets }, (_, k) => sheet(k)),
      ]} />
  );
}
