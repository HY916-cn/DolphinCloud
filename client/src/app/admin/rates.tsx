import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmSheet, Desk, link, ListLoading, Notice, Stats, useInTerm } from '@/components';
import { formatAmount, formatPercent, formatPoints, formatRate, shiftDay } from '@/lib/format';
import { byWeeks, penaltyRate, type AnchorParams, type TermRates } from '@/lib/rates';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { monthDay } from '@/lib/term';

const enter = (i: number) => ({ '--i': i }) as React.CSSProperties;

type Overview = { week_start: string | null; anchor: number; table: { score: number; current: number; loan: number | null }[] };
type Week = { week_start: string; prev_anchor: number; deposits: number; loans: number; ratio: number; growth: number | null; adjust: number; anchor: number; params: AnchorParams };
type Params = { anchor: AnchorParams; term: TermRates; loan: number; penalty: number };

// A percentage that may be below zero (目标增速), with the minus sign −.
const pct = (n: number) => (n < 0 ? `−${formatRate(-n)}` : formatRate(n));

// anchor_params as 计算参数 and a week's 参数 list them.
const anchorRows = (a: AnchorParams): [string, string][] => [
  ['初始锚点', formatRate(a.initial)],
  ['锚点范围', `${formatRate(a.min)}～${formatRate(a.max)}`],
  ['目标存贷比', `${formatRate(a.ratio_target)}（每差 ${formatRate(a.ratio_step)} 调整 ${a.weight} 个百分点）`],
  ['目标增速', `${pct(a.growth_target)}（每差 ${formatRate(a.growth_step)} 调整 ${a.weight} 个百分点）`],
  ['每周最多调整', `±${a.max_adjust} 个百分点`],
];
const Kv = ({ rows }: { rows: [string, string][] }) => <dl className="dc-kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;

// 利率 (PHASE-2.md §9, design system data.md 利率（后台）): the week's anchor with where it comes from, the weekly
// rates by score, the fixed 定期周利率, every Monday's anchor with all it was worked out from, and the parameters, read
// only; the president and the bank admin change them on 参数.
export default function Rates() {
  const me = useMe().data!;
  const edit = me.roles.includes('teacher') || me.roles.includes('president');
  const term = useInTerm();
  const [shown, setShown] = useState<Week | null>(null);
  const overview = useQuery({ queryKey: ['rate-overview'], queryFn: () => call<Overview>('rate_overview', {}) });
  const weeks = useQuery({
    queryKey: ['rate-weeks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('rate_weeks')
        .select('week_start,prev_anchor,deposits,loans,ratio,growth,adjust,anchor,params').order('week_start', { ascending: false });
      if (error) throw error;
      return data as Week[];
    },
  });
  const settings = useQuery({
    queryKey: ['settings', 'rates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('key,value')
        .in('key', ['anchor_params', 'term_rates', 'loan_multiplier', 'penalty_multiplier']);
      if (error) throw error;
      const v = Object.fromEntries(data.map((r) => [r.key, r.value]));
      return { anchor: v.anchor_params, term: v.term_rates, loan: v.loan_multiplier, penalty: v.penalty_multiplier } as Params;
    },
  });
  const o = overview.data;
  const s = settings.data;
  const latest = weeks.data?.[0];
  const published = o?.week_start ? weeks.data?.find((w) => w.week_start === o.week_start) : undefined;
  const change = published && published.anchor - published.prev_anchor;
  const penalty = (loan: number | null) => (loan === null ? '不能贷款' : s ? formatRate(penaltyRate(loan, s.penalty)) : '—');

  return (
    <Desk title="利率">
      {overview.isError ? <Notice tone="danger" title="暂时无法读取本周利率">请检查网络后刷新页面。</Notice> : !o ? <ListLoading rows={4} label="正在加载利率" /> : (
        <section className="dc-stack dc-enter" aria-label="本周锚点">
          <Stats items={[
            ['本周锚点', formatRate(o.anchor), undefined,
              change === undefined ? undefined : change ? `比上周 ${formatPoints(change)} 个百分点` : '与上周持平'],
            ['存贷比', o.week_start && latest ? formatPercent(latest.ratio) : '—'],
            ['存款余额', o.week_start && latest ? formatAmount(latest.deposits) : '—', 'HTB'],
          ]} />
          <p className="dc-caption">
            {term === false ? '假期中不计息，下学期沿用此锚点。'
              : !o.week_start ? `还没有公布锚点，现在按初始锚点 ${formatRate(o.anchor)} 计算。学期内每周一公布。`
              : `${monthDay(o.week_start)}公布，下次 ${monthDay(shiftDay(o.week_start, 7))}。`}
          </p>
          <section className="dc-card dc-stack" aria-label="按分数的利率">
            <h2 className="heading">按分数的周利率 · 锚点 {formatRate(o.anchor)}</h2>
            <div className="dc-table-scroll">
              <table className="dc-table" aria-label="按分数的周利率">
                <thead><tr>
                  <th scope="col">分数</th><th scope="col" className="n">活期</th>
                  <th scope="col" className="n">贷款</th><th scope="col" className="n">逾期罚息</th>
                </tr></thead>
                <tbody>
                  {o.table.map((r) => (
                    <tr key={r.score}>
                      <td>{r.score} 分</td><td className="n">{formatRate(r.current)}</td>
                      <td className="n">{r.loan === null ? '不能贷款' : formatRate(r.loan)}</td><td className="n">{penalty(r.loan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      <section className="dc-card dc-stack dc-enter" aria-label="定期周利率" style={enter(1)}>
        <div className="dc-section-head">
          <h2 className="heading">定期周利率</h2>
          {edit && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/settings')}>在参数页修改</a>}
        </div>
        {settings.isError ? <Notice tone="danger" title="暂时无法读取定期周利率">请检查网络后刷新页面。</Notice>
          : !s ? <ListLoading rows={5} label="正在加载定期周利率" />
          : <Kv rows={byWeeks(s.term).map(([w, r]): [string, string] => [`${w} 周`, formatRate(r)])} />}
      </section>

      <section className="dc-card dc-stack dc-enter" aria-label="每周历史" style={enter(2)}>
        <h2 className="heading">每周历史</h2>
        {weeks.isError ? <Notice tone="danger" title="暂时无法读取每周历史">请检查网络后刷新页面。</Notice>
          : !weeks.data ? <ListLoading rows={3} label="正在加载每周历史" />
          : !weeks.data.length ? <p className="dc-caption">还没有记录。学期内每周一公布一次锚点。</p> : (
            <div className="dc-table-scroll">
              <table className="dc-table" aria-label="每周历史">
                <thead><tr>
                  <th scope="col">周一</th><th scope="col" className="n">上周锚点</th><th scope="col" className="n">存款余额（HTB）</th>
                  <th scope="col" className="n">贷款余额（HTB）</th><th scope="col" className="n">存贷比</th><th scope="col" className="n">增速</th>
                  <th scope="col" className="n">调整（百分点）</th><th scope="col" className="n">本周锚点</th><th scope="col">参数</th>
                </tr></thead>
                <tbody>
                  {weeks.data.map((w) => (
                    <tr key={w.week_start}>
                      <td>{monthDay(w.week_start)}{w.growth === null && <> <span className="dc-tag">不调整</span></>}</td>
                      <td className="n">{formatRate(w.prev_anchor)}</td>
                      <td className="n">{formatAmount(w.deposits)}</td>
                      <td className="n">{formatAmount(w.loans)}</td>
                      <td className="n">{formatPercent(w.ratio)}</td>
                      <td className="n">{w.growth === null ? '—' : formatPercent(w.growth, true)}</td>
                      <td className="n">{w.growth === null ? '0.00' : formatPoints(w.adjust)}</td>
                      <td className="n">{formatRate(w.anchor)}</td>
                      <td>
                        <button className="dc-btn dc-btn-ghost dc-btn-sm" type="button" aria-label={`查看${monthDay(w.week_start)}的锚点参数`}
                          onClick={() => setShown(w)}>查看</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

      <section className="dc-card dc-stack dc-enter" aria-label="计算参数" style={enter(3)}>
        <div className="dc-section-head">
          <h2 className="heading">计算参数</h2>
          {edit && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/settings')}>在参数页修改</a>}
        </div>
        {settings.isError ? <Notice tone="danger" title="暂时无法读取利率参数">请检查网络后刷新页面。</Notice>
          : !s ? <ListLoading rows={3} label="正在加载参数" /> : (
            <>
              <p className="dc-list-title">可在参数页修改</p>
              <Kv rows={anchorRows(s.anchor).slice(0, 2)} />
              <p className="dc-list-title">系统固定</p>
              <Kv rows={[...anchorRows(s.anchor).slice(2),
                ['贷款倍数', `×${s.loan}`],
                ['罚息倍数', `×${s.penalty}`]]} />
            </>
          )}
      </section>

      {shown && (
        <ConfirmSheet title={`${monthDay(shown.week_start)}的锚点参数`} confirm="关闭" cancel={null} onConfirm={() => setShown(null)} onClose={() => setShown(null)}>
          <Kv rows={anchorRows(shown.params)} />
        </ConfirmSheet>
      )}
    </Desk>
  );
}
