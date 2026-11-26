import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmSheet, DatePicker, Desk, Icon, ListLoading, Notice, today, Toast } from '@/components';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatCenti, shiftDay } from '@/lib/format';
import { call } from '@/lib/rpc';
import { useMe } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { monthDay } from '@/lib/term';
import {
  dayName, gain, holdingName, missingText, nav4, parseChange, plClass, signedPct, type Holding, type OverviewDay, type OverviewProduct,
  type WealthOverview,
} from '@/lib/wealth';

const enter = (i: number) => ({ '--i': i }) as React.CSSProperties;
const PAGE = 30;
// The last weekday before today, for 登记 with nothing waiting.
function lastWeekday(now: string) {
  let d = shiftDay(now, -1);
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = shiftDay(d, -1);
  return d;
}
// The change entered, as the confirmation says it: −0.80%, +1.2345%.
const entered = (n: number) => (Math.round(n * 10_000) % 100 ? `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%` : signedPct(n));
const pl = (r: number | null, bold = false) => (r == null ? '—' : <span className={`dc-pl ${plClass(r)}`}>{bold ? <b>{signedPct(r)}</b> : signedPct(r)}</span>);
type Open = Pick<Holding, 'id' | 'product' | 'principal' | 'buy_nav' | 'value_centi' | 'weeks' | 'tier_name' | 'multiplier'> & {
  student_no: string; opened_on: string; students: { name: string } | null;
};

// 理财 (PHASE-2.md §10.10, §16.2; design system Invest 后台「理财」页): the days still to enter, each product's net value
// and what is held in it, every calendar day of one product (30 days at a time), and the open holdings. Only the bank
// admin enters a day's change by hand (登记行情); the accountant and the president read.
export default function Wealth() {
  const me = useMe().data!;
  const admin = me.roles.includes('teacher');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<string | null>(null);
  const [entering, setEntering] = useState<{ product: string; day: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const overview = useInfiniteQuery({
    queryKey: ['wealth-overview'],
    initialPageParam: null as string | null,
    // Days before a product's first net value are all `none`: once every product has reached them there is no more.
    getNextPageParam: (last: WealthOverview) => {
      const days = last.products[0]?.days ?? [];
      return days.length === PAGE && last.products.some((p) => p.days.at(-1)?.status !== 'none') ? days.at(-1)!.day : undefined;
    },
    queryFn: ({ pageParam }) => call<WealthOverview>('wealth_overview', { p_before: pageParam, p_limit: PAGE }),
  });
  const holdings = useQuery({
    queryKey: ['wealth-open'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wealth_holdings')
        .select('id,student_no,product,principal,buy_nav,value_centi,opened_on,weeks,tier_name,multiplier,students(name)')
        .eq('status', 'open').order('opened_on', { ascending: false }).order('student_no');
      if (error) throw error;
      return data as unknown as Open[];
    },
  });
  const o = overview.data?.pages[0];
  const now = today();
  const products = o?.products ?? [];
  const current = products.find((p) => p.key === tab) ?? products.find((p) => p.missing.length) ?? products[0];
  // Days before a product's first net value (`none`) have nothing to show.
  const days = overview.data?.pages.flatMap((page) => page.products.find((p) => p.key === current?.key)?.days ?? []).filter((d) => d.status !== 'none') ?? [];
  const missing = missingText(products);
  const nameOf = (key: string) => products.find((p) => p.key === key)?.name ?? key;
  const start = (p: OverviewProduct) => setEntering({ product: p.key, day: p.missing[0] ?? lastWeekday(now) });

  function done(product: string, day: string) {
    setEntering(null);
    setToast(`已登记${nameOf(product)} ${monthDay(day)} 的行情`);
    queryClient.invalidateQueries({ queryKey: ['wealth-overview'] });
    queryClient.invalidateQueries({ queryKey: ['wealth-open'] });
  }

  return (
    <Desk title="理财">
      {overview.isError ? <Notice tone="danger" title="暂时无法读取理财">请检查网络后刷新页面。</Notice> : !o ? <ListLoading rows={6} label="正在加载理财" /> : (
        <>
          {missing.count > 0 && (
            <Notice title={`有 ${missing.count} 天的行情还没有取到：${missing.text}。`} icon="warning">
              这些品种的净值先停在前一天，取到或登记后自动补上。
            </Notice>
          )}
          <section className="dc-card dc-stack dc-enter" aria-label="品种">
            <p className="dc-list-title">品种</p>
            <div className="dc-table-scroll">
              <table className="dc-table" aria-label="理财品种">
                <thead><tr>
                  <th scope="col">品种</th><th scope="col" className="n">当前净值</th><th scope="col">净值日期</th><th scope="col" className="n">涨跌</th>
                  <th scope="col" className="n">持有笔数</th><th scope="col" className="n">本金 HTB</th><th scope="col" className="n">现值 HTB</th>
                </tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.key}>
                      <td>{p.name}</td><td className="n">{p.nav == null ? '—' : p.nav.toFixed(6)}</td>
                      <td>{p.nav_day ? dayName(p.nav_day, now) : '—'}{p.waiting && <> <span className="dc-tag dc-tag-pending">待登记</span></>}</td>
                      <td className="n">{pl(p.change)}</td><td className="n">{p.count}</td>
                      <td className="n">{formatAmount(p.principal)}</td><td className="n">{formatCenti(p.value_centi)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td>合计</td><td /><td /><td /><td className="n">{o.open.count}</td>
                  <td className="n">{formatAmount(o.open.principal)}</td><td className="n">{formatCenti(o.open.value_centi)}</td>
                </tr></tfoot>
              </table>
            </div>
            {o.term.count > 0 && (
              <p className="dc-caption">
                另有按期限买入的理财 {o.term.count} 笔，本金 {formatAmount(o.term.principal)} HTB，现在值 {formatCenti(o.term.value_centi)} HTB，到期自动转回活期。
              </p>
            )}
          </section>
        </>
      )}

      {o && current && (
        <section className="dc-card dc-stack dc-enter" aria-label="每日行情" style={enter(1)}>
          <h2 className="heading">每日行情</h2>
          <div className="dc-tabs" role="tablist" aria-label="品种">
            {products.map((p) => (
              <button key={p.key} id={`wealth-tab-${p.key}`} className="dc-tabs-item" role="tab" type="button" aria-selected={p.key === current.key}
                aria-controls="wealth-days" onClick={() => setTab(p.key)}>{p.name}</button>
            ))}
          </div>
          <div id="wealth-days" role="tabpanel" aria-labelledby={`wealth-tab-${current.key}`} className="dc-table-scroll">
            <table className="dc-table" aria-label={`每日行情 · ${current.name}`}>
              <thead><tr>
                <th scope="col">日期</th><th scope="col" className="n">收盘价</th><th scope="col" className="n">行情涨跌</th>
                <th scope="col" className="n">当天收益率</th><th scope="col" className="n">净值</th><th scope="col">来源</th>
              </tr></thead>
              <tbody>
                {days.map((d) => (
                  <DayRow key={d.day} d={d} cap={o.params.cap} onEnter={admin && d.status === 'pending' ? () => setEntering({ product: current.key, day: d.day }) : undefined} />
                ))}
              </tbody>
            </table>
          </div>
          {overview.isFetchingNextPage && <ListLoading rows={2} label="正在加载每日行情" />}
          {overview.hasNextPage && !overview.isFetchingNextPage && (
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" onClick={() => overview.fetchNextPage()}>加载更多</button>
          )}
        </section>
      )}

      <section className="dc-card dc-stack dc-enter" aria-label="持有中的理财" style={enter(2)}>
        <h2 className="heading">持有中的理财</h2>
        {holdings.isError ? <Notice tone="danger" title="暂时无法读取持有中的理财">请检查网络后刷新页面。</Notice>
          : !holdings.data || !o ? <ListLoading rows={3} label="正在加载持有中的理财" />
          : !holdings.data.length ? <p className="dc-caption">没有持有中的理财。</p> : (
            <div className="dc-table-scroll">
              <table className="dc-table" aria-label="持有中的理财">
                <thead><tr>
                  <th scope="col">学生</th><th scope="col">品种</th><th scope="col" className="n">本金</th><th scope="col" className="n">买入净值</th>
                  <th scope="col" className="n">现值</th><th scope="col" className="n">盈亏</th><th scope="col">买入日</th>
                </tr></thead>
                <tbody>
                  {holdings.data.map((h) => {
                    const g = gain(h.value_centi - 100 * h.principal);
                    return (
                      <tr key={h.id}>
                        <td>{h.students?.name} · {h.student_no}</td><td>{holdingName({ ...h, name: nameOf(h.product) })}</td>
                        <td className="n">{formatAmount(h.principal)} HTB</td><td className="n">{h.buy_nav == null ? '—' : nav4(h.buy_nav)}</td>
                        <td className="n">{formatCenti(h.value_centi)} HTB</td>
                        <td className="n">{g.cls ? <span className={`dc-pl ${g.cls}`}>{g.text}</span> : g.text}</td><td>{monthDay(h.opened_on)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>

      {admin && current && (
        <div className="dc-actions">
          <button className="dc-btn dc-btn-primary" type="button" onClick={() => start(current)}>登记行情</button>
        </div>
      )}
      {entering && (
        <EnterSheets start={entering} products={products} now={now} onClose={() => setEntering(null)} onDone={done} />
      )}
      {toast && <Toast text={toast} onDone={() => setToast(null)} />}
    </Desk>
  );
}

// One calendar day of a product: its close and change, the day's rate (in bold where ±cap cut it) and net value, and where
// the close came from; a day still waiting offers 登记 to the bank admin.
function DayRow({ d, cap, onEnter }: { d: OverviewDay; cap: number; onEnter?: () => void }) {
  const source = d.status === 'open' ? (d.source === 'manual' && d.created_by_name ? `${d.source_name} · ${d.created_by_name}` : d.source_name)
    : d.status === 'closed' ? <span className="dc-tag">休市</span>
    : d.status === 'pending' ? <span className="dc-tag dc-tag-pending">待登记</span> : '—';
  return (
    <tr>
      <td>{monthDay(d.day)}</td>
      <td className="n">{d.close == null ? '—' : String(d.close)}</td>
      <td className="n">{pl(d.change)}</td>
      <td className="n">{pl(d.rate, d.rate != null && Math.abs(d.rate) >= cap)}</td>
      <td className="n">{d.nav == null ? '—' : d.nav.toFixed(6)}</td>
      <td>
        {source}
        {onEnter && <> <button className="dc-btn dc-btn-ghost dc-btn-sm dc-btn-inline" type="button" aria-label={`登记${monthDay(d.day)}的行情`} onClick={onEnter}>登记</button></>}
      </td>
    </tr>
  );
}

// 登记行情: the product, the day, its change and where it came from, then a second look; what the server refuses is said
// in the sheet.
function EnterSheets({ start, products, now, onClose, onDone }: {
  start: { product: string; day: string }; products: OverviewProduct[]; now: string; onClose: () => void; onDone: (product: string, day: string) => void;
}) {
  const [key, setKey] = useState(start.product);
  const [day, setDay] = useState(start.day);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ title: string; text: string } | null>(null);
  const product = products.find((p) => p.key === key)!;
  const change = parseChange(text);
  const wrong = !!text && change === null;

  function pick(k: string) {
    setKey(k);
    setDay(products.find((p) => p.key === k)?.missing[0] ?? lastWeekday(now));
  }

  async function record() {
    setBusy(true);
    setRefusal(null);
    try {
      await call('record_wealth_day', { p_product: key, p_day: day, p_change: change, p_note: note.trim() });
      onDone(key, day);
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('');
      setRefusal(explain(err.code, { ...err.detail, wealth: 'record' }));
      setBusy(false);
    }
  }

  if (confirming && change !== null) {
    return (
      <ConfirmSheet title={`按涨跌 ${entered(change)} 登记${product.name} ${monthDay(day)}？`} confirm="确认登记" busy={busy} onConfirm={record}
        text={`${product.name}的净值从这一天起按顺序补上，持有它的理财随之变动。登记后不能修改。`}
        onClose={() => { setConfirming(false); setRefusal(null); }}>
        {refusal && <Notice tone="danger" title={refusal.title}>{refusal.text}</Notice>}
      </ConfirmSheet>
    );
  }
  return (
    <ConfirmSheet title={`登记${product.name} ${monthDay(day)} 的行情`} confirm="下一步" ready={change !== null && !!note.trim()}
      onConfirm={() => setConfirming(true)} onClose={onClose}>
      <div className="dc-stack">
        <label className="dc-field">
          <span className="dc-field-label"><Icon name="invest" />品种</span>
          <span className="dc-select">
            <select aria-label="品种" value={key} onChange={(e) => pick(e.target.value)}>
              {products.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </span>
        </label>
        <DatePicker label="日期" value={day} max={shiftDay(now, -1)} rule="只能登记已经过去的工作日" onChange={setDay} />
        <label className={`dc-field ${wrong ? 'is-error' : ''}`}>
          <span className="dc-field-label"><Icon name="invest" />行情涨跌</span>
          <span className="dc-input-wrap">
            <input className="dc-input" inputMode="decimal" aria-label="行情涨跌" value={text} placeholder="例如 −0.80"
              onChange={(e) => setText(e.target.value.replace(/[^\d.\-−]/g, '').slice(0, 9))} />
            <span className="dc-input-unit">%</span>
          </span>
          {wrong && <span className="dc-field-hint"><Icon name="warning" />行情涨跌要在 −50% 到 50% 之间，最多 4 位小数。</span>}
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
