import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmSheet, DatePicker, Desk, Icon, link, ListLoading, Notice, Stats, today, Toast, useLatestDay } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatCenti, shiftDay } from '@/lib/format';
import { byWeeks } from '@/lib/rates';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { monthDay } from '@/lib/term';
import {
  clipped, dayName, gain, parseChange, plainPct, plClass, signedPct, tierLabel, type OverviewDay, type Tier, type WealthHolding, type WealthOverview,
} from '@/lib/wealth';

const enter = (i: number) => ({ '--i': i }) as React.CSSProperties;
const PAGE = 30;
const LENGTHS = [2, 4, 12, 24, 48];
const Kv = ({ rows }: { rows: [string, string][] }) => <dl className="dc-kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
// A tier's daily bounds: 每天 −10%～+10%.
const range = (t: Tier) => `每天 ${t.min ? '−' : ''}${plainPct(t.min)}～+${plainPct(t.max)}`;
// The last weekday before today, for 登记 with nothing waiting.
function lastWeekday(now: string) {
  let d = shiftDay(now, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = shiftDay(d, -1);
  return d;
}
// The change entered, as the confirmation says it: −0.80%, +1.2345%.
const entered = (n: number) => (Math.round(n * 10_000) % 100 ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%` : signedPct(n));

// 理财 (PHASE-2.md §10.10, §16.2; design system Invest 后台「理财」页): today's index, what is held and worth, the working
// days still without a close, the rules read only, every calendar day's rates for one length (30 days at a time), and the
// open holdings. The president and the bank admin enter a day's index change by hand (登记指数涨跌).
export default function Wealth() {
  const me = useMe().data!;
  const admin = me.roles.includes('teacher') || me.roles.includes('president');
  const queryClient = useQueryClient();
  const [weeks, setWeeks] = useState(12);
  const [entering, setEntering] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const latest = useLatestDay();
  const overview = useInfiniteQuery({
    queryKey: ['wealth-overview'],
    initialPageParam: null as string | null,
    // Days before the first close on record are all `none`: there is nothing more to list.
    getNextPageParam: (last: WealthOverview) => {
      const end = last.days.at(-1);
      return end && end.status !== 'none' && last.days.length === PAGE ? end.day : undefined;
    },
    queryFn: ({ pageParam }) => call<WealthOverview>('wealth_overview', { p_before: pageParam, p_limit: PAGE }),
  });
  const holdings = useQuery({
    queryKey: ['wealth-open'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wealth_holdings').select('*,students(name)').eq('status', 'open')
        .order('matures_on').order('student_no');
      if (error) throw error;
      return data as (WealthHolding & { students: { name: string } | null })[];
    },
  });
  const o = overview.data?.pages[0];
  const days = overview.data?.pages.flatMap((p) => p.days) ?? [];
  const now = today();
  const l = latest.data;

  function done(day: string) {
    setEntering(null);
    setToast(`已登记 ${monthDay(day)} 的指数涨跌`);
    queryClient.invalidateQueries({ queryKey: ['wealth-overview'] });
    queryClient.invalidateQueries({ queryKey: ['wealth-latest'] });
  }

  return (
    <Desk title="理财">
      {overview.isError ? <Notice tone="danger" title="暂时无法读取理财">请检查网络后刷新页面。</Notice> : !o ? <ListLoading rows={4} label="正在加载理财" /> : (
        <section className="dc-stack dc-enter" aria-label="理财概况">
          <Stats items={[
            [`${l ? dayName(l.day, now) : '今天'}${l && l.day !== now ? ' ' : ''}指数涨跌`, l ? signedPct(l.change) : '—', undefined, undefined, undefined, l && plClass(l.change) ? `dc-pl ${plClass(l.change)}` : undefined],
            ['持有中', String(o.open.count), '笔', `本金 ${formatAmount(o.open.principal)} HTB`],
            ['当前总值', formatCenti(o.open.value_centi), 'HTB'],
          ]} />
          {o.missing.length > 0 && (
            <Notice title={`有 ${o.missing.length} 个工作日还没有行情：${o.missing.map(monthDay).join('、')}。`} icon="warning">
              需要这些日子的理财先停在前一天，取到或登记后自动补上。
            </Notice>
          )}
        </section>
      )}

      {o && (
        <section className="dc-card dc-stack dc-enter" aria-label="收益规则" style={enter(1)}>
          <div className="dc-section-head">
            <h2 className="heading">收益规则</h2>
            {admin && <a className="dc-btn dc-btn-ghost dc-btn-sm" {...link('/admin/settings')}>在参数页修改</a>}
          </div>
          <Kv rows={[['参考指数', `${o.params.name} · ${o.params.symbol}`], ['系数', `×${o.params.factor}`]]} />
          <p className="dc-list-title">每天的基础收益</p>
          <Kv rows={byWeeks(o.params.day_base).map(([w, r]): [string, string] => [`${w} 周`, `每天 ${plainPct(r)}`])} />
          <p className="dc-list-title">档位</p>
          <Kv rows={o.params.tiers.map((t): [string, string] => [tierLabel(t), range(t)])} />
        </section>
      )}

      {o && (
        <section className="dc-card dc-stack dc-enter" aria-label="每日收益" style={enter(2)}>
          <h2 className="heading">每日收益</h2>
          <fieldset className="dc-seg" aria-label="期限">
            {LENGTHS.map((w) => (
              <label key={w}><input type="radio" name="wealth-length" checked={weeks === w} onChange={() => setWeeks(w)} /><span>{w} 周</span></label>
            ))}
          </fieldset>
          <div className="dc-table-scroll">
            <table className="dc-table" aria-label={`每日收益 · ${weeks} 周`}>
              <thead><tr>
                <th scope="col">日期</th><th scope="col" className="n">收盘价</th><th scope="col" className="n">指数涨跌</th>
                {o.params.tiers.map((t) => <th key={t.key} scope="col" className="n">{tierLabel(t)}</th>)}
                <th scope="col">来源</th>
              </tr></thead>
              <tbody>
                {days.map((d) => (
                  <DayRow key={d.day} d={d} weeks={weeks} tiers={o.params.tiers} onEnter={admin && d.status === 'pending' ? () => setEntering(d.day) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="dc-caption">按现在的参数计算；已经买的理财按买入时的参数，可能与这里不同。</p>
          {overview.isFetchingNextPage && <ListLoading rows={2} label="正在加载每日收益" />}
          {overview.hasNextPage && !overview.isFetchingNextPage && (
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => overview.fetchNextPage()}>加载更多</button>
          )}
        </section>
      )}

      <section className="dc-card dc-stack dc-enter" aria-label="持有中的理财" style={enter(3)}>
        <h2 className="heading">持有中的理财</h2>
        {holdings.isError ? <Notice tone="danger" title="暂时无法读取持有中的理财">请检查网络后刷新页面。</Notice>
          : !holdings.data ? <ListLoading rows={3} label="正在加载持有中的理财" />
          : !holdings.data.length ? <p className="dc-caption">没有持有中的理财。</p> : (
            <div className="dc-table-scroll">
              <table className="dc-table" aria-label="持有中的理财">
                <thead><tr>
                  <th scope="col">学生</th><th scope="col">期限和档位</th><th scope="col" className="n">本金</th>
                  <th scope="col" className="n">现值</th><th scope="col" className="n">盈亏</th><th scope="col">到期日</th>
                </tr></thead>
                <tbody>
                  {holdings.data.map((h) => {
                    const g = gain(h.value_centi - 100 * h.principal);
                    return (
                      <tr key={h.id}>
                        <td>{h.students?.name} · {h.student_no}</td><td>{h.weeks} 周 · {tierLabel(h)}</td>
                        <td className="n">{formatAmount(h.principal)} HTB</td><td className="n">{formatCenti(h.value_centi)} HTB</td>
                        <td className="n"><span className={`dc-pl ${g.cls}`}>{g.text}</span></td><td>{monthDay(h.matures_on)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {admin && o && (
        <div className="dc-actions">
          <button className="dc-btn dc-btn-primary" type="button" onClick={() => setEntering(o.missing[0] ?? lastWeekday(now))}>登记指数涨跌</button>
        </div>
      )}
      {entering && <EnterSheets day={entering} onClose={() => setEntering(null)} onDone={done} />}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </Desk>
  );
}

// One calendar day: its close and change, the rate each tier of `weeks` took (in bold where its bounds cut it), and where
// the close came from; a day still waiting offers 登记 to those who may enter it.
function DayRow({ d, weeks, tiers, onEnter }: { d: OverviewDay; weeks: number; tiers: Tier[]; onEnter?: () => void }) {
  const rates = d.rates?.[String(weeks)];
  const source = d.status === 'open' ? (d.source_name === '手动登记' && d.created_by_name ? `手动登记 · ${d.created_by_name}` : d.source_name)
    : d.status === 'closed' ? <span className="dc-tag">休市</span>
    : d.status === 'pending' ? <span className="dc-tag dc-tag-pending">待登记</span> : '—';
  return (
    <tr>
      <td>{monthDay(d.day)}</td>
      <td className="n">{d.close == null ? '—' : d.close.toFixed(2)}</td>
      <td className="n">{d.change == null ? '—' : <span className={`dc-pl ${plClass(d.change)}`}>{signedPct(d.change)}</span>}</td>
      {tiers.map((t) => {
        const r = rates?.[t.key];
        return <td key={t.key} className="n">{r == null ? '—' : clipped(r, t) ? <b>{signedPct(r)}</b> : signedPct(r)}</td>;
      })}
      <td>
        {source}
        {onEnter && <> <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-inline" type="button" aria-label={`登记${monthDay(d.day)}的指数涨跌`} onClick={onEnter}>登记</button></>}
      </td>
    </tr>
  );
}

// 登记指数涨跌: the day, the index's change and where it came from, then a second look; what the server refuses is said
// in the sheet.
function EnterSheets({ day: start, onClose, onDone }: { day: string; onClose: () => void; onDone: (day: string) => void }) {
  const [day, setDay] = useState(start);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ title: string; text: string } | null>(null);
  const change = parseChange(text);
  const wrong = !!text && change === null;

  async function enter() {
    setBusy(true);
    setRefusal(null);
    try {
      await call('record_wealth_day', { p_day: day, p_change: change, p_note: note.trim() });
      onDone(day);
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      setRefusal(explain(err.code, { ...err.detail, wealth: true }));
      setBusy(false);
    }
  }

  if (confirming && change !== null) {
    return (
      <ConfirmSheet title={`按指数涨跌 ${entered(change)} 登记 ${monthDay(day)}？`} confirm="确认登记" busy={busy} onConfirm={enter}
        text="每笔持有中的理财按自己买入时的参数算这一天的收益，登记后不能修改。"
        onClose={() => { setConfirming(false); setRefusal(null); }}>
        {refusal && <Notice tone="danger" title={refusal.title}>{refusal.text}</Notice>}
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet title={`登记 ${monthDay(day)} 的指数涨跌`} confirm="下一步" ready={change !== null && !!note.trim()}
      onConfirm={() => setConfirming(true)} onClose={onClose}>
      <div className="dc-stack">
        <DatePicker label="日期" value={day} max={shiftDay(today(), -1)} rule="只能登记已经过去的工作日" onChange={setDay} />
        <label className={`dc-field ${wrong ? 'is-error' : ''}`}>
          <span className="dc-field-label"><Icon name="invest" />指数涨跌</span>
          <span className="dc-input-wrap">
            <input className="dc-input" inputMode="decimal" aria-label="指数涨跌" value={text} placeholder="例如 −0.80"
              onChange={(e) => setText(e.target.value.replace(/[^\d.\-−]/g, '').slice(0, 9))} />
            <span className="dc-input-unit">%</span>
          </span>
          {wrong && <span className="dc-field-hint"><Icon name="warning" />指数涨跌要在 −50% 到 50% 之间，最多 4 位小数。</span>}
        </label>
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="passbook" />说明</span>
          <span className="dc-input-wrap dc-input-area">
            <textarea className="dc-input" rows={2} maxLength={200} value={note} placeholder="写明数据从哪里来" onChange={(e) => setNote(e.target.value)} />
          </span>
          <span className="dc-field-hint">必填，最多 200 字</span>
        </label>
        <p className="dc-caption">这一天休市的不用登记。请从最早的一天起按顺序登记：登记了后面的日子，前面没有行情的工作日会按休市算。</p>
      </div>
    </ConfirmSheet>
  );
}
