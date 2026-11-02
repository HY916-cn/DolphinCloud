import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Bars, Columns, DatePicker, Desk, Icon, KvLoading, Line, Notice, ScopePicker, Stats, Summary, Table, TimeRange, today } from '@/components';
import { LEDGER } from '@/components/Ledger';
import { AppError, explain } from '@/lib/errors';
import { formatAmount, formatSigned, formatTime, maskName, PERIODS, periodOf } from '@/lib/format';
import { dailyBalance, ledgerSheet, NO_FILTER, reportSheets, saveWorkbook, scopeArgs, type Report } from '@/lib/reports';
import { call } from '@/lib/rpc';
import type { Scope } from '@/lib/search';

const TABS = { business: '营业', accounts: '账户', finance: '财务', goods: '商品' } as const;
type Tab = keyof typeof TABS;
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;
const span = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="dc-card dc-stack" aria-label={title}>
      <h2 className="heading">{title}{sub && <span className="dc-top-sub"> {sub}</span>}</h2>
      {children}
    </section>
  );
}

// 报表 (accountant, teacher; PHASE-1.md §7.9): one period (今天, 本周, 本月, 上月 or any days up to a year), optionally
// one 时段 of each day, for the whole bank, a 学部, a class or one student, in four tabs of charts and tables: 营业
// (businesses by day, hour and teller), 账户 (students and balances by class), 财务 (the balance check and its
// trend, counter cash, currency issued) and 商品 (exchanges and stock). 导出 Excel writes every table and the
// period's 流水明细 into one workbook; 打印 / 存为 PDF prints all four tabs, charts and tables.
export default function Reports() {
  const now = today();
  const [[from, to], setRange] = useState(periodOf('month', now));
  const [[timeFrom, timeTo], setTimes] = useState(['', '']);
  const [printing, setPrinting] = useState(false);
  const [scope, setScope] = useState<Scope | null>(null);
  const [tab, setTab] = useState<Tab>('business');
  const [fullNames, setFullNames] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const tooLong = span(from, to) > 366;
  const badTime = !!timeFrom && !!timeTo && timeFrom >= timeTo;

  const report = useQuery({
    queryKey: ['report', from, to, scope, timeFrom, timeTo],
    enabled: !tooLong && !badTime,
    queryFn: () => call<Report>('bank_report', {
      p_from: from, p_to: to, ...scopeArgs(scope), p_time_from: timeFrom || null, p_time_to: timeTo || null,
    }, 30_000),
  });
  const r = report.data;
  const period = (from === to ? from : `${from} 至 ${to}`) + (timeFrom || timeTo ? ` · 每天 ${timeFrom || '0:00'}–${timeTo || '24:00'}` : '');
  // Printing renders every tab; the browser's dialog blocks until it closes.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done, { once: true });
    window.print();
    return () => window.removeEventListener('afterprint', done);
  }, [printing]);
  const scopeText = !scope ? '全部学生'
    : scope.kind === 'student' ? `${fullNames ? scope.label : maskName(scope.label)} · 学号 ${scope.student_no}` : scope.label;

  async function exportAll() {
    if (!r) return;
    setExporting(true);
    setProblem(null);
    try {
      const ledger = await ledgerSheet(LEDGER, { ...NO_FILTER, scope, from, to, timeFrom, timeTo }, fullNames);
      const tag = scope?.kind === 'student' ? `-学号${scope.student_no}` : scope ? `-${scope.label}` : '';
      await saveWorkbook(`银行报表-${from}至${to}${tag}.xlsx`, [...reportSheets(r, period, scopeText), ledger]);
    } catch (err) {
      setProblem(err instanceof AppError ? explain(err.code, err.detail) : { title: '报表未能导出', text: '请检查网络后再导出一次。' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Desk title="报表">
      <form className="dc-card dc-stack dc-enter rp-no-print" aria-label="报表条件" onSubmit={(e) => e.preventDefault()}>
        <div className="dc-chips" role="group" aria-label="期间">
          {PERIODS.map(([k, label]) => {
            const [f, t] = periodOf(k, now);
            return (
              <button key={k} className="dc-chip" type="button" aria-pressed={f === from && t === to} onClick={() => setRange([f, t])}>
                <Icon name="check" />{label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <DatePicker label="开始日期" value={from} max={to} rule="不能晚于结束日期" onChange={(f) => setRange([f, to])} />
          <DatePicker label="结束日期" value={to} min={from} max={now} rule="不能早于开始日期，也不能晚于今天" onChange={(t) => setRange([from, t])} />
        </div>
        <TimeRange from={timeFrom} to={timeTo} onChange={(f, t) => setTimes([f, t])} />
        <ScopePicker value={scope} onChange={setScope} />
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <label className="dc-check">
            <input type="checkbox" checked={fullNames} onChange={(e) => setFullNames(e.target.checked)} />
            <span className="dc-check-box" />
            <span>导出完整姓名<small>不勾选时，导出的文件里学生姓名显示为「张*明」</small></span>
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <button className="dc-btn dc-btn-secondary" type="button" disabled={!r} onClick={() => setPrinting(true)}>
              <Icon name="inbox" />打印 / 存为 PDF
            </button>
            <button className="dc-btn dc-btn-primary" type="button" disabled={!r || exporting} onClick={exportAll}>
              <Icon name="passbook" />{exporting ? '正在导出' : '导出 Excel'}
            </button>
          </div>
        </div>
        {problem && <Notice tone="danger" title={problem.title}>{problem.text}</Notice>}
      </form>

      {tooLong ? <Notice tone="danger" title="期间太长">一份报表最长一年，请缩短日期范围。</Notice>
        : badTime ? <Notice tone="danger" title="时段有误">结束时间要晚于开始时间。</Notice>
        : report.error ? <Notice tone="danger" title="暂时无法读取报表">请检查网络后刷新页面。</Notice>
        : !r ? <KvLoading rows={6} />
        : (
          <section className="dc-stack dc-enter" style={{ '--i': 1 } as React.CSSProperties} aria-label="报表">
            <div className="rp-print-only">
              <h2 className="title">海豚银行报表</h2>
              <p className="dc-top-sub">打印于 {formatTime(new Date().toISOString(), new Date(0))}</p>
            </div>
            <p className="dc-list-title">{period} · {scope ? scope.kind === 'student' ? `${scope.label} · 学号 ${scope.student_no}` : scope.label : '全部学生'}</p>
            {printing ? (Object.keys(TABS) as Tab[]).map((k) => (
              <div key={k} className="dc-stack">
                <h2 className="title">{TABS[k]}</h2>
                <Panel tab={k} r={r} scoped={!!scope} />
              </div>
            )) : <>
            <div className="dc-tabs rp-no-print" role="tablist" aria-label="报表">
              {(Object.keys(TABS) as Tab[]).map((k) => (
                <button key={k} id={`report-tab-${k}`} className="dc-tabs-item" role="tab" type="button" aria-selected={tab === k}
                  aria-controls="report-panel" onClick={() => setTab(k)}>{TABS[k]}</button>
              ))}
            </div>
            <div id="report-panel" className="dc-stack" role="tabpanel" aria-labelledby={`report-tab-${tab}`}>
              <Panel tab={tab} r={r} scoped={!!scope} />
            </div>
            </>}
          </section>
        )}
    </Desk>
  );
}

function Panel({ tab, r, scoped }: { tab: Tab; r: Report; scoped: boolean }) {
  if (tab === 'business') return <Business r={r} />;
  if (tab === 'accounts') return <Accounts r={r} />;
  if (tab === 'finance') return <Finance r={r} scoped={scoped} />;
  return <Goods r={r} scoped={scoped} />;
}

function Business({ r }: { r: Report }) {
  const b = r.business;
  const hours = r.hours.length ? Array.from({ length: r.hours.at(-1)!.hour - r.hours[0].hour + 1 }, (_, i) => r.hours[0].hour + i) : [];
  const daily = (key: 'deposit' | 'withdraw' | 'purchase', label: string) => r.days.map((d) => ({
    label: dayLabel(d.day), value: d[key], tip: `${dayLabel(d.day)} ${label} ${formatAmount(d[key])} HTB · ${d[`${key}_count`]} 笔`,
  }));
  return (
    <>
      <Stats items={[
        ['存款', formatAmount(b.deposit.amount), `HTB · ${b.deposit.count} 笔`],
        ['取款', formatAmount(b.withdraw.amount), `HTB · ${b.withdraw.count} 笔`],
        ['兑换', formatAmount(b.purchase_account.amount + b.purchase_cash.amount), `HTB · ${b.purchase_account.count + b.purchase_cash.count} 笔`],
        ['冲正', r.reversals.count, `笔 · ${formatAmount(r.reversals.amount)} HTB`],
        ['办理业务的学生', b.students, '人'],
      ]} />
      <p className="dc-top-sub">笔数和金额不含已冲正的业务（本期 {r.reversed} 笔）；兑换含账户支付 {formatAmount(b.purchase_account.amount)} HTB、现金支付 {formatAmount(b.purchase_cash.amount)} HTB。</p>
      {r.days.length > 1 && (
        <Section title="每日业务" sub="金额（HTB），悬停看当天笔数">
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
        <Section title="营业时段" sub="每个小时办理的业务笔数">
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
              rows={r.tellers.map((t) => [t.name, t.count, t.deposit, t.withdraw, t.purchase, t.reversed, t.reversals])} />
            <p className="dc-top-sub">存款、取款、兑换为金额（HTB）。被冲正：本人办理、之后被冲正的笔数；办理冲正：本人冲正的笔数。</p>
          </>
        ) : <p className="dc-top-sub">这段时间没有办理业务。</p>}
      </Section>
    </>
  );
}

function Accounts({ r }: { r: Report }) {
  const s = r.students;
  return (
    <>
      <Stats items={[
        ['学生', s.total, '人'], ['本期办理过业务', s.active, '人'], ['期末账面余额', formatAmount(s.balance), 'HTB'],
        ['余额中位数', formatAmount(s.median), 'HTB'], ['最高余额', formatAmount(s.max), 'HTB'],
        ['已冻结 / 已毕业', `${s.frozen} / ${s.graduated}`, '人'],
      ]} />
      <Section title="期末余额分布" sub="每档的学生人数">
        <Columns title="学生" unit="人" data={r.distribution.map((d) => ({ label: d.label, value: d.count, tip: `${d.label} HTB · ${d.count} 人` }))} />
      </Section>
      <Section title="按班级">
        <Bars title="期末余额（HTB）" data={r.classes.map((c) => {
          const label = c.class_label ?? `${c.cohort} 届 ${c.class_no} 班`;
          return { label, value: c.balance, text: formatAmount(c.balance) };
        })} />
        <Table label="按班级" head={['班级', '学生', '办理过业务', '期末余额', '存款', '取款', '账户兑换']}
          rows={r.classes.map((c) => [c.class_label ?? `${c.cohort} 届 ${c.class_no} 班`, c.students, c.active, c.balance, c.deposit, c.withdraw, c.spent])}
          foot={['合计', s.total, s.active, s.balance, r.business.deposit.amount, r.business.withdraw.amount, r.business.purchase_account.amount]} />
      </Section>
    </>
  );
}

function Finance({ r, scoped }: { r: Report; scoped: boolean }) {
  const ch = r.balance.changes;
  const sum = r.balance.opening + Object.values(ch).reduce((a, n) => a + (n ?? 0), 0);
  const signed = (n = 0) => `${n ? formatSigned(n) : 0} HTB`;
  const issued = r.issues.batches.reduce((a, i) => a + i.total, 0);
  return (
    <>
      <Section title="余额核对" sub="期初账面余额加上本期每笔余额变动，等于期末账面余额；按整天计算，不受时段影响">
        <Summary rows={[
          ['期初账面余额', `${formatAmount(r.balance.opening)} HTB`], ['期初余额导入', signed(ch.opening)], ['存款', signed(ch.deposit)],
          ['取款', signed(ch.withdraw)], ['兑换（账户支付）', signed(ch.purchase)], ['冲正', signed(ch.reversal)],
        ]} total={['期末账面余额', r.balance.closing]} />
        {sum === r.balance.closing
          ? <Notice tone="success" title="核对一致">期初 {formatAmount(r.balance.opening)} + 本期变动 {formatSigned(sum - r.balance.opening)} = 期末 {formatAmount(r.balance.closing)} HTB。</Notice>
          : <Notice tone="danger" title="核对不一致">按流水计算的期末余额是 {formatAmount(sum)} HTB，请银行管理员运行余额自检。</Notice>}
        {r.days.length > 1 && (
          <Line title="日终账面余额" unit="HTB" data={dailyBalance(r).map(({ d, balance }) => ({
            label: dayLabel(d.day), value: balance, tip: `${dayLabel(d.day)} 日终 ${formatAmount(balance)} HTB（${formatSigned(d.change)}）`,
          }))} />
        )}
      </Section>
      <Section title="柜面现金" sub="柜台收进和付出的海豚币现金">
        <Summary rows={[['收入（存款、现金兑换）', `${formatAmount(r.cash.in)} HTB`], ['付出（取款、冲正退回）', `${formatAmount(r.cash.out)} HTB`]]}
          total={['净额', r.cash.in - r.cash.out]} />
        {r.cash.in < r.cash.out && <p className="dc-top-sub">付出多于收入 {formatAmount(r.cash.out - r.cash.in)} HTB。</p>}
      </Section>
      <Section title="货币发行" sub={scoped ? '全行数据，不按学生范围筛选' : undefined}>
        <Stats items={[['累计发行（至期末）', formatAmount(r.issues.total), 'HTB'], ['本期发行', formatAmount(issued), `HTB · ${r.issues.batches.length} 批`]]} />
        {r.issues.batches.length > 0 && (
          <Table label="本期发行批次" head={['批次号', '发行日期', '面额 × 张数', '金额', '用途', '审批人']}
            rows={r.issues.batches.map((i) => [i.batch_no, i.issued_on,
              Object.entries(i.denominations).map(([d, n]) => `${d} × ${n}`).join('、'), i.total, i.purpose, i.approver])} />
        )}
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
      <Section title="商品兑换" sub="不含已冲正的兑换">
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
      <Section title="库存" sub={scoped ? '全行数据，不按学生范围筛选' : '期初 + 入库 − 出库 − 兑出 = 期末'}>
        <Table label="库存" head={['商品', '期初', '入库', '出库', '兑出', '期末']}
          rows={r.stock.map((s) => [s.name, s.opening, s.stock_in, s.stock_out, s.sold, s.closing])} />
      </Section>
    </>
  );
}
