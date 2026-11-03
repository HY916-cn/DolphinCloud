import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  Bars, Columns, DatePicker, Desk, Icon, KvLoading, Line, Notice, OutputSheet, ScopePicker, Stats, Summary, Table, TimeRange, today,
} from '@/components';
import { formatAmount, formatSigned, PERIODS, periodOf, shiftDay } from '@/lib/format';
import { CHANGES, classLabel, dailyBalance, dayLabel, reportPages, scopeArgs, type Report } from '@/lib/reports';
import { call } from '@/lib/rpc';
import type { Scope } from '@/lib/search';

const TABS = { business: '营业', accounts: '账户', finance: '财务', goods: '商品' } as const;
type Tab = keyof typeof TABS;
const span = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="dc-card dc-stack" aria-label={title}>
      <h2 className="heading">{title}{sub && <span className="dc-top-sub"> {sub}</span>}</h2>
      {children}
    </section>
  );
}

// The change from the period before, as 比上期 +12% (or the amount when the period before had none).
type Prev = Report | undefined;
function delta(now: number, before: number | undefined) {
  if (before === undefined) return undefined;
  if (now === before) return '与上期持平';
  if (!before) return `上期为 0`;
  const pct = Math.round(((now - before) / before) * 100);
  return `比上期 ${pct > 0 ? '+' : ''}${pct}%`;
}

// 报表 (accountant, teacher; PHASE-1.md §7.9): one period (今天, 本周, 本月, 上月 or any days up to a year), optionally
// one 时段 of each day, for the whole bank, a 学部, a class or one student, in four tabs of charts and tables: 营业
// (businesses by day, hour and teller), 账户 (students and balances by class), 财务 (the balance check and its
// trend, counter cash) and 商品 (exchanges and stock). Each figure is set beside the period of the same length just
// before. 打印 / 导出 prints the report or keeps it as a PDF, one table or chart to a page.
export default function Reports() {
  const now = today();
  const [[from, to], setRange] = useState(periodOf('month', now));
  const [[timeFrom, timeTo], setTimes] = useState(['', '']);
  const [timed, setTimed] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [tab, setTab] = useState<Tab>('business');
  const [output, setOutput] = useState(false);
  const tooLong = span(from, to) > 366;
  const badTime = !!timeFrom && !!timeTo && timeFrom >= timeTo;
  const read = (f: string, t: string) => call<Report>('bank_report', {
    p_from: f, p_to: t, ...scopeArgs(scope), p_time_from: timeFrom || null, p_time_to: timeTo || null,
  }, 30_000);
  const report = useQuery({ queryKey: ['report', from, to, scope, timeFrom, timeTo], enabled: !tooLong && !badTime, queryFn: () => read(from, to) });
  // The period before, of as many days.
  const before = [shiftDay(from, -span(from, to) - 1), shiftDay(from, -1)];
  const previous = useQuery({ queryKey: ['report', ...before, scope, timeFrom, timeTo], enabled: !tooLong && !badTime, queryFn: () => read(before[0], before[1]) });
  const r = report.data;
  const period = (from === to ? from : `${from} 至 ${to}`) + (timeFrom || timeTo ? ` · 每天 ${timeFrom || '0:00'}–${timeTo || '24:00'}` : '');
  const scopeText = !scope ? '全部学生' : scope.kind === 'student' ? `${scope.label} · 学号 ${scope.student_no}` : scope.label;

  return (
    <Desk title="报表">
      {/* Laid out as the FilterBar: the search, the days, then the chips with 打印 / 导出 at the bottom right. */}
      <form className="dc-card dc-stack fl-bar dc-enter" aria-label="报表条件" onSubmit={(e) => e.preventDefault()}>
        <ScopePicker value={scope} onChange={setScope} />
        <div className="fl-row">
          <span className="rp-pair fl-dates">
            <DatePicker short label="从" value={from} max={to} rule="不能晚于结束日期" onChange={(f) => setRange([f, to])} />
            <DatePicker short label="到" value={to} min={from} max={now} rule="不能早于开始日期，也不能晚于今天" onChange={(t) => setRange([from, t])} />
          </span>
          {timed && <TimeRange from={timeFrom} to={timeTo} onChange={(f, t) => setTimes([f, t])} />}
        </div>
        <div className="fl-row">
          <div className="dc-chips" role="group" aria-label="期间">
            {PERIODS.map(([k, label]) => {
              const [f, t] = periodOf(k, now);
              return (
                <button key={k} className="dc-chip" type="button" aria-pressed={f === from && t === to} onClick={() => setRange([f, t])}>
                  <Icon name="check" />{label}
                </button>
              );
            })}
            <button className="dc-chip" type="button" aria-pressed={timed} onClick={() => { if (timed) setTimes(['', '']); setTimed(!timed); }}>
              <Icon name="check" />按时段
            </button>
          </div>
          <div className="fl-actions">
            <button className="dc-btn dc-btn-secondary dc-btn-sm" type="button" disabled={!r} onClick={() => setOutput(true)}>
              <Icon name="passbook" />打印 / 导出
            </button>
          </div>
        </div>
      </form>

      {tooLong ? <Notice tone="danger" title="期间太长">一份报表最长一年，请缩短日期范围。</Notice>
        : badTime ? <Notice tone="danger" title="时段有误">结束时间要晚于开始时间。</Notice>
        : report.error ? <Notice tone="danger" title="暂时无法读取报表">请检查网络后刷新页面。</Notice>
        : !r ? <KvLoading rows={6} />
        : (
          <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="报表">
            <p className="dc-list-title">{period} · {scopeText} <span className="dc-top-sub">对比 {before[0] === before[1] ? before[0] : `${before[0]} 至 ${before[1]}`}</span></p>
            <div className="dc-tabs" role="tablist" aria-label="报表">
              {(Object.keys(TABS) as Tab[]).map((k) => (
                <button key={k} id={`report-tab-${k}`} className="dc-tabs-item" role="tab" type="button" aria-selected={tab === k}
                  aria-controls="report-panel" onClick={() => setTab(k)}>{TABS[k]}</button>
              ))}
            </div>
            <div id="report-panel" className="dc-stack" role="tabpanel" aria-labelledby={`report-tab-${tab}`}>
              <Panel tab={tab} r={r} p={previous.data} scoped={!!scope} />
            </div>
          </section>
        )}
      {output && r && (
        <OutputSheet title="打印报表" name={`银行报表-${from}至${to}${scope ? `-${scope.kind === 'student' ? `学号${scope.student_no}` : scope.label}` : ''}.pdf`}
          text={`${period} · ${scopeText}`}
          make={() => reportPages(r, period, scopeText)} onClose={() => setOutput(false)} onDone={() => setOutput(false)} />
      )}
    </Desk>
  );
}

function Panel({ tab, r, p, scoped }: { tab: Tab; r: Report; p: Prev; scoped: boolean }) {
  if (tab === 'business') return <Business r={r} p={p} />;
  if (tab === 'accounts') return <Accounts r={r} p={p} />;
  if (tab === 'finance') return <Finance r={r} />;
  return <Goods r={r} scoped={scoped} />;
}

function Business({ r, p }: { r: Report; p: Prev }) {
  const b = r.business;
  const pb = p?.business;
  const hours = r.hours.length ? Array.from({ length: r.hours.at(-1)!.hour - r.hours[0].hour + 1 }, (_, i) => r.hours[0].hour + i) : [];
  const daily = (key: 'deposit' | 'withdraw' | 'purchase', label: string) => r.days.map((d) => ({
    label: dayLabel(d.day), value: d[key], tip: `${dayLabel(d.day)} ${label} ${formatAmount(d[key])} HTB · ${d[`${key}_count`]} 笔`,
  }));
  return (
    <>
      <Stats items={[
        ['存款', formatAmount(b.deposit.amount), `HTB · ${b.deposit.count} 笔`, delta(b.deposit.amount, pb?.deposit.amount)],
        ['取款', formatAmount(b.withdraw.amount), `HTB · ${b.withdraw.count} 笔`, delta(b.withdraw.amount, pb?.withdraw.amount)],
        ['兑换', formatAmount(b.purchase_account.amount + b.purchase_cash.amount), `HTB · ${b.purchase_account.count + b.purchase_cash.count} 笔`,
          delta(b.purchase_account.amount + b.purchase_cash.amount, pb && pb.purchase_account.amount + pb.purchase_cash.amount)],
        ['冲正', r.reversals.count, `笔 · ${formatAmount(r.reversals.amount)} HTB`, delta(r.reversals.count, p?.reversals.count)],
        ['办理业务的学生', b.students, '人', delta(b.students, pb?.students)],
      ]} />
      <p className="dc-top-sub">兑换含账户支付 {formatAmount(b.purchase_account.amount)} HTB、现金支付 {formatAmount(b.purchase_cash.amount)} HTB；另有 {r.reversed} 笔已冲正。</p>
      {r.days.length > 1 && (
        <Section title="每日业务">
          <div className="rp-charts">
            <Columns title="存款" kind="dc-kind-save" unit="HTB" data={daily('deposit', '存款')} />
            <Columns title="取款" kind="dc-kind-withdraw" unit="HTB" data={daily('withdraw', '取款')} />
            <Columns title="兑换" kind="dc-kind-exchange" unit="HTB" data={daily('purchase', '兑换')} />
          </div>
          <details>
            <summary className="dc-btn dc-btn-ghost dc-btn-sm" style={{ paddingInline: 0 }}>按日明细</summary>
            <Table label="按日" head={['日期', '存款笔数', '存款', '取款笔数', '取款', '兑换笔数', '兑换', '学生']}
              rows={r.days.map((d) => [d.day, d.deposit_count, d.deposit, d.withdraw_count, d.withdraw, d.purchase_count, d.purchase, d.students])} />
          </details>
        </Section>
      )}
      {hours.length > 0 && (
        <Section title="营业时段">
          <Columns title="业务笔数" unit="笔" data={hours.map((h) => {
            const n = r.hours.find((x) => x.hour === h)?.count ?? 0;
            return { label: `${h}时`, value: n, tip: `${h}:00–${h + 1}:00 · ${n} 笔` };
          })} />
        </Section>
      )}
      <Section title="按柜员">
        {r.tellers.length ? (
          <>
            <Bars title="业务笔数" data={r.tellers.filter((t) => t.count).map((t) => ({ label: t.name, value: t.count, text: `${t.count} 笔` }))} />
            <Table label="按柜员" head={['经办人', '业务笔数', '存款', '取款', '兑换', '被冲正', '办理冲正']}
              rows={r.tellers.filter((t) => t.count || t.reversed || t.reversals).map((t) => [t.name, t.count, t.deposit, t.withdraw, t.purchase, t.reversed, t.reversals])} />
            <p className="dc-top-sub">存款、取款、兑换为金额（HTB）。被冲正：本人办理、之后被冲正的笔数；办理冲正：本人冲正的笔数。</p>
          </>
        ) : <p className="dc-top-sub">这段时间没有办理业务。</p>}
      </Section>
    </>
  );
}

function Accounts({ r, p }: { r: Report; p: Prev }) {
  const s = r.students;
  const ps = p?.students;
  return (
    <>
      <Stats items={[
        ['学生', s.total, '人'], ['本期办理过业务', s.active, '人', delta(s.active, ps?.active)],
        ['期末账面余额', formatAmount(s.balance), 'HTB', delta(s.balance, ps?.balance)],
        ['余额中位数', formatAmount(s.median), 'HTB', delta(s.median, ps?.median)], ['最高余额', formatAmount(s.max), 'HTB'],
        // 学生 counts every account in scope; the rest of it are the ones closed (注销).
        ['已冻结 / 已毕业 / 已注销', `${s.frozen} / ${s.graduated} / ${s.total - s.normal - s.frozen - s.graduated}`, '人'],
      ]} />
      <Section title="期末余额分布">
        <Columns title="学生" unit="人" data={r.distribution.map((d) => ({ label: d.label, value: d.count, tip: `${d.label} HTB · ${d.count} 人` }))} />
      </Section>
      <Section title="按班级">
        <Bars title="期末余额（HTB）" data={r.classes.map((c) => {
          return { label: classLabel(c), value: c.balance, text: formatAmount(c.balance) };
        })} />
        <Table label="按班级" head={['班级', '学生', '办理过业务', '期末余额', '存款', '取款', '账户兑换']}
          rows={r.classes.map((c) => [classLabel(c), c.students, c.active, c.balance, c.deposit, c.withdraw, c.spent])}
          foot={['合计', s.total, s.active, s.balance, r.business.deposit.amount, r.business.withdraw.amount, r.business.purchase_account.amount]} />
      </Section>
    </>
  );
}

function Finance({ r }: { r: Report }) {
  const ch = r.balance.changes;
  const sum = r.balance.opening + Object.values(ch).reduce((a, n) => a + (n ?? 0), 0);
  const signed = (n = 0) => `${n ? formatSigned(n) : 0} HTB`;
  return (
    <>
      <Section title="余额核对">
        <Summary rows={[['期初账面余额', `${formatAmount(r.balance.opening)} HTB`],
          ...CHANGES.filter(([k]) => k !== 'closing' || ch.closing).map(([k, label]): [string, string] => [label, signed(ch[k])])]}
          total={['期末账面余额', r.balance.closing]} />
        {sum === r.balance.closing
          ? <Notice tone="success" title="核对一致">期初 {formatAmount(r.balance.opening)} + 本期变动 {formatSigned(sum - r.balance.opening)} = 期末 {formatAmount(r.balance.closing)} HTB。</Notice>
          : <Notice tone="danger" title="核对不一致">按流水计算的期末余额是 {formatAmount(sum)} HTB，请银行管理员运行余额自检。</Notice>}
        {r.days.length > 1 && (
          <Line title="日终账面余额" unit="HTB" data={dailyBalance(r).map(({ d, balance }) => ({
            label: dayLabel(d.day), value: balance, tip: `${dayLabel(d.day)} 日终 ${formatAmount(balance)} HTB（${formatSigned(d.change)}）`,
          }))} />
        )}
      </Section>
      <Section title="柜面现金">
        <Summary rows={[['收入（存款、现金兑换）', `${formatAmount(r.cash.in)} HTB`], ['付出（取款、冲正退回）', `${formatAmount(r.cash.out)} HTB`]]}
          total={['净额', r.cash.in - r.cash.out]} />
      </Section>
    </>
  );
}

function Goods({ r, scoped }: { r: Report; scoped: boolean }) {
  const p = r.products;
  const total = (k: 'qty' | 'amount' | 'account' | 'cash') => p.reduce((a, x) => a + x[k], 0);
  const costKnown = p.every((x) => x.cost !== null);
  const cost = costKnown ? p.reduce((a, x) => a + x.cost!, 0) : null;
  return (
    <>
      <Section title="商品兑换">
        {p.length ? (
          <>
            <Bars title="兑换数量" kind="dc-kind-exchange" data={p.map((x) => ({ label: x.name, value: x.qty, text: `${x.qty} 件` }))} />
            <Table label="商品兑换" head={['商品', '数量', '金额', '账户支付', '现金支付', '成本', '毛利']}
              rows={p.map((x) => [x.name, x.qty, x.amount, x.account, x.cash, x.cost, x.cost === null ? null : x.amount - x.cost])}
              foot={['合计', total('qty'), total('amount'), total('account'), total('cash'), cost, cost === null ? null : total('amount') - cost]} />
            {!costKnown && <p className="dc-top-sub">有商品没有填写成本价，成本和毛利显示为「—」。</p>}
          </>
        ) : <p className="dc-top-sub">这段时间没有兑换。</p>}
      </Section>
      <Section title="库存" sub={scoped ? '全行库存' : undefined}>
        <Table label="库存" head={['商品', '期初', '入库', '出库', '兑出', '期末']}
          rows={r.stock.map((s) => [s.name, s.opening, s.stock_in, s.stock_out, s.sold, s.closing])} />
      </Section>
    </>
  );
}
