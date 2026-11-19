import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  anchorNote, anchorText, cashNote, countTop, loanNote, monthDay, stockNote, weekChange, weekLabel, weekTip, type Dashboard as Board, type Move, type Overview,
} from '@/lib/currency';
import { formatAmount } from '@/lib/format';
import { call } from '@/lib/rpc';
import { supabase } from '@/lib/supabase';
import { Columns, Stats } from './Report';
import { ConfirmSheet } from './Sheet';
import { StatsLoading } from './Skeleton';
import { Notice } from './ui';

// 货币 (design system Currency): the notes, the electronic money and 兑付能力; the records, newest first, with who
// entered them (null for the president, who reads no other login; the page then names the bank admin).
export const useCurrency = () => useQuery({ queryKey: ['currency', 'overview'], queryFn: () => call<Overview>('currency_overview', {}) });
export const useCurrencyMoves = () => useQuery({
  queryKey: ['currency', 'moves'],
  queryFn: async () => {
    const { data, error } = await supabase.from('currency_moves').select('*,creator:profiles!created_by(display_name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data as unknown as Move[];
  },
});

// 经营看板 at the top of 总览 (accountant, president, bank admin): six figures, 银行应有现金 a link to 货币, and the
// business of the last 12 weeks, with a sheet of their numbers. Never a 0 for a figure it could not read.
export function Dashboard() {
  const board = useQuery({ queryKey: ['dashboard'], queryFn: () => call<Board>('dashboard', {}) });
  const [table, setTable] = useState(false);
  const d = board.data;
  if (board.isError) {
    return (
      <Notice tone="danger" title="暂时无法读取经营看板">
        请检查网络后重试。
        <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => board.refetch()}>重试</button>
      </Notice>
    );
  }
  if (!d) {
    return (
      <>
        <StatsLoading count={6} label="正在加载经营看板" />
        <div className="dc-card" aria-hidden="true"><span className="dc-skeleton" style={{ height: 200 }} /></div>
      </>
    );
  }
  const last = d.weeks.at(-2)?.count ?? 0;
  return (
    <>
      <Stats items={[
        ['账户余额', formatAmount(d.balance.total), 'HTB', '含定期、理财本金'],
        ['银行应有现金', `${d.bank_cash < 0 ? '−' : ''}${formatAmount(d.bank_cash)}`, 'HTB', cashNote(d.payout), d.payout.low, undefined, '/admin/currency'],
        ['贷款余额', formatAmount(d.loans.remaining), 'HTB', loanNote(d.loans), d.loans.overdue.count > 0],
        ['文创库存', formatAmount(d.stock.qty), '件', stockNote(d.stock)],
        ['本周业务', formatAmount(d.week.count), '笔', weekChange(d.week.count, last)],
        ['本周锚点', anchorText(d.anchor.anchor), '%', anchorNote(d.anchor)],
      ]} />
      <section className="dc-card dc-stack" aria-label="每周业务">
        <Columns title="每周业务笔数" note="最近 12 周" unit="笔" fromEnd top={countTop(Math.max(...d.weeks.map((w) => w.count)))}
          data={d.weeks.map((w) => ({ label: weekLabel(w.week_start), value: w.count, tip: weekTip(w.week_start, w.count) }))} />
        <div className="dc-section-head">
          <span />
          <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" onClick={() => setTable(true)}>各周数字</button>
        </div>
      </section>
      {table && (
        <ConfirmSheet title="每周业务笔数" confirm="关闭" cancel={null} onConfirm={() => setTable(false)} onClose={() => setTable(false)}>
          <div className="dc-table-scroll">
            <table className="dc-table" aria-label="每周业务笔数">
              <thead><tr><th scope="col">周一</th><th scope="col" className="n">笔数</th></tr></thead>
              <tbody>
                {[...d.weeks].reverse().map((w) => (
                  <tr key={w.week_start}><td>{monthDay(w.week_start)}</td><td className="n">{formatAmount(w.count)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </ConfirmSheet>
      )}
    </>
  );
}
