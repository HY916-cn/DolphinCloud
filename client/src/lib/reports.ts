import { NO_FILTER, type Filter } from '@/components/Filter';
import type { LedgerRow } from '@/components/Ledger';
import { renderDoc, type Block } from './doc';
import { formatAmount, formatTime, maskName } from './format';
import type { Scope } from './search';
import { readAll, supabase } from './supabase';

// 报表 (PHASE-1.md §6.8, §7.9): the shape bank_report returns and the arguments it is read with; the report printed
// or kept as a PDF, one table or chart to a page; and 流水 as an Excel file or a printed list. Student names in a
// 流水 export are masked (张*明) unless the exporter asks for full names.

type Count = { count: number; amount: number };
export type Report = {
  business: { deposit: Count; withdraw: Count; purchase_account: Count; purchase_cash: Count; students: number };
  reversals: Count; reversed: number; openings: Count;
  balance: { opening: number; closing: number; changes: Partial<Record<'opening' | 'deposit' | 'withdraw' | 'purchase' | 'reversal' | 'salary' | 'closing', number>> };
  cash: { in: number; out: number };
  days: { day: string; deposit: number; deposit_count: number; withdraw: number; withdraw_count: number; purchase: number; purchase_count: number; students: number; change: number }[];
  hours: { hour: number; count: number }[];
  tellers: { name: string; count: number; deposit_count: number; deposit: number; withdraw_count: number; withdraw: number;
    purchase_count: number; purchase: number; reversed: number; reversals: number }[];
  classes: { division: 'primary' | 'junior'; cohort: number; class_no: number; class_label: string | null; students: number; active: number;
    balance: number; deposit: number; withdraw: number; spent: number }[];
  students: { total: number; active: number; normal: number; frozen: number; graduated: number; balance: number; median: number; max: number };
  distribution: { label: string; count: number }[];
  products: { name: string; qty: number; amount: number; account: number; cash: number; cost: number | null }[];
  stock: { name: string; price: number; cost: number | null; opening: number; stock_in: number; stock_out: number; sold: number; closing: number }[];
};

// The arguments bank_report takes for a scope (null: the whole bank).
export function scopeArgs(scope: Scope | null) {
  if (!scope) return {};
  if (scope.kind === 'student') return { p_student_no: scope.student_no };
  if (scope.kind === 'division') return { p_division: scope.division };
  return { p_division: scope.division, p_cohort: scope.cohort, p_class_no: scope.class_no };
}

// 流水's filters: the filter bar's days, 时段 and types, and what its search picked (a student, class or 学部, a teller,
// part of a 交易号). The same ones choose the rows an export writes.
export type LedgerFilter = Filter & { scope: Scope | null; operator: string; txnNo: string };
export const NO_LEDGER: LedgerFilter = { ...NO_FILTER, scope: null, operator: '', txnNo: '' };

// A txns read with the filters applied; a class or 学部 is matched on the embedded student, so it must be inner.
export function ledgerQuery(select: string, f: LedgerFilter, count?: 'exact') {
  const s = f.scope;
  const inner = s && s.kind !== 'student';
  let q = supabase.from('txns').select(inner ? select.replace('students(', 'students!inner(') : select, { count });
  if (s?.kind === 'student') q = q.eq('student_no', s.student_no);
  if (inner) q = q.eq('students.division', s.division);
  if (s?.kind === 'class') q = q.eq('students.cohort', s.cohort).eq('students.class_no', s.class_no);
  if (f.from) q = q.gte('created_at', `${f.from}T00:00:00+08:00`);
  if (f.to) q = q.lte('created_at', `${f.to}T23:59:59.999+08:00`);
  if (f.timeFrom) q = q.gte('cn_time', f.timeFrom); // the time of day, Asia/Shanghai (public.cn_time)
  if (f.timeTo) q = q.lt('cn_time', f.timeTo);
  if (f.kinds.length) q = q.in('type', f.kinds);
  if (f.operator) q = q.eq('operator_id', f.operator);
  if (f.txnNo.trim()) q = q.ilike('txn_no', `%${f.txnNo.trim().replace(/[%_\\]/g, '')}%`);
  return q;
}

type Cell = string | number | null;
type Sheet = [string, Cell[][]];
const TYPE = { opening: '期初余额', deposit: '存款', withdraw: '取款', purchase: '兑换', reversal: '冲正', salary: '工资', closing: '注销清零' } as const;
const PAYMENT = { account: '账户', cash: '现金' } as const;

// Every transaction the filters choose, oldest first.
const ledgerRows = (select: string, f: LedgerFilter) => readAll((from, to) => ledgerQuery(select, f).order('seq').range(from, to) as unknown as
  PromiseLike<{ data: LedgerRow[] | null; error: unknown }>);
const shownName = (r: LedgerRow, fullNames: boolean) => (fullNames ? r.students?.name ?? '' : maskName(r.students?.name ?? ''));
const business = (r: LedgerRow) => TYPE[r.type] + (r.type === 'purchase' && r.payment ? `（${PAYMENT[r.payment]}）` : '');

// The 流水明细 sheet.
export async function ledgerSheet(select: string, f: LedgerFilter, fullNames: boolean): Promise<Sheet> {
  const rows = await ledgerRows(select, f);
  return ['流水明细', [
    ['交易号', '时间', '学号', '姓名', '班级', '业务', '金额', '支付方式', '余额变动', '办理后余额', '商品', '经办人', '状态', '冲正原因'],
    // formatTime against 1970 always writes the year.
    ...rows.map((r) => [
      r.txn_no, formatTime(r.created_at, new Date(0)), r.student_no, shownName(r, fullNames),
      r.students?.class_label ?? '', TYPE[r.type], r.amount, r.payment && r.type !== 'opening' ? PAYMENT[r.payment] : '', r.balance_delta,
      r.balance_after, r.txn_items?.map((i) => `${i.name} × ${i.qty}`).join('、') ?? '', r.operator?.display_name ?? '',
      r.status === 'reversed' ? '已冲正' : '正常', r.reason ?? '',
    ]),
  ]];
}

// The same rows as a printed list, with the totals of what was not reversed.
export async function ledgerPages(select: string, f: LedgerFilter, fullNames: boolean, about: string) {
  const rows = await ledgerRows(select, f);
  const live = rows.filter((r) => r.status === 'normal' && r.type !== 'reversal');
  const sum = (type: string) => live.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);
  return renderDoc('海豚银行流水', `打印于 ${formatTime(new Date().toISOString(), new Date(0))}`, [
    { kind: 'heading', text: `${about} · 共 ${rows.length} 笔` },
    { kind: 'stats', items: [['存款', `${formatAmount(sum('deposit'))} HTB`], ['取款', `${formatAmount(sum('withdraw'))} HTB`],
      ['兑换', `${formatAmount(sum('purchase'))} HTB`], ['已冲正', `${rows.filter((r) => r.status === 'reversed').length} 笔`]] },
    { kind: 'table', head: ['时间', '交易号', '学生', '班级', '业务', '金额', '余额变动', '经办人', '状态'],
      rows: rows.map((r) => [formatTime(r.created_at, new Date(0)), r.txn_no, shownName(r, fullNames), r.students?.class_label ?? '', business(r),
        r.amount, r.balance_delta, r.operator?.display_name ?? '', r.status === 'reversed' ? '已冲正' : '正常']) },
  ]);
}

// Each day with the balance at its end: the opening balance plus every change up to that day.
export function dailyBalance(r: Report) {
  let balance = r.balance.opening;
  return r.days.map((d) => ({ d, balance: (balance += d.change) }));
}

// The changes of the balance check, in the order 报表 shows them.
export const CHANGES = [['opening', '期初余额导入'], ['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换（账户支付）'],
  ['reversal', '冲正'], ['salary', '工资'], ['closing', '注销清零']] as const;
export const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;
export const classLabel = (c: Report['classes'][number]) => c.class_label ?? `${c.cohort} 届 ${c.class_no} 班`;

// The report on paper: a summary page, then each chart with its table on a page of its own.
export function reportPages(r: Report, period: string, scope: string) {
  const b = r.business;
  const ch = r.balance.changes;
  const s = r.students;
  const sub = `${period} · ${scope}`;
  const stock = r.stock;
  const products = r.products;
  const tellers = r.tellers.filter((t) => t.count || t.reversed || t.reversals);
  const pages: Block[][] = [
    [
      { kind: 'heading', text: '营业概况' },
      { kind: 'stats', items: [['存款', `${formatAmount(b.deposit.amount)} HTB`], ['取款', `${formatAmount(b.withdraw.amount)} HTB`],
        ['兑换', `${formatAmount(b.purchase_account.amount + b.purchase_cash.amount)} HTB`], ['办理业务的学生', `${b.students} 人`]] },
      { kind: 'table', head: ['业务', '笔数', '金额（HTB）'], rows: [
        ['存款', b.deposit.count, b.deposit.amount], ['取款', b.withdraw.count, b.withdraw.amount],
        ['兑换（账户支付）', b.purchase_account.count, b.purchase_account.amount], ['兑换（现金支付）', b.purchase_cash.count, b.purchase_cash.amount],
        ['冲正', r.reversals.count, r.reversals.amount], ['期初余额导入', r.openings.count, r.openings.amount]] },
      { kind: 'heading', text: '余额核对' },
      { kind: 'table', head: ['项目', '金额（HTB）'], rows: [['期初账面余额', r.balance.opening], ...CHANGES.map(([k, label]) => [label, ch[k] ?? 0])],
        foot: ['期末账面余额', r.balance.closing] },
      { kind: 'heading', text: '柜面现金' },
      { kind: 'table', head: ['项目', '金额（HTB）'], rows: [['收入（存款、现金兑换）', r.cash.in], ['付出（取款、冲正退回）', r.cash.out]],
        foot: ['净额', r.cash.in - r.cash.out] },
    ],
    ...(r.days.length > 1 ? [[
      { kind: 'heading', text: '每日业务', sub: '金额（HTB）' },
      { kind: 'columns', title: '存款', unit: 'HTB', color: 'sea-ink', data: r.days.map((d) => ({ label: dayLabel(d.day), value: d.deposit })) },
      { kind: 'columns', title: '取款', unit: 'HTB', color: 'grape-ink', data: r.days.map((d) => ({ label: dayLabel(d.day), value: d.withdraw })) },
      { kind: 'columns', title: '兑换', unit: 'HTB', color: 'rose-ink', data: r.days.map((d) => ({ label: dayLabel(d.day), value: d.purchase })) },
      { kind: 'page' },
      { kind: 'heading', text: '按日明细' },
      { kind: 'table', head: ['日期', '存款笔数', '存款', '取款笔数', '取款', '兑换笔数', '兑换', '学生', '日终余额'],
        rows: dailyBalance(r).map(({ d, balance }) => [d.day, d.deposit_count, d.deposit, d.withdraw_count, d.withdraw, d.purchase_count, d.purchase, d.students, balance]) },
    ] as Block[]] : []),
    ...(r.hours.length ? [[
      { kind: 'heading', text: '营业时段' },
      { kind: 'columns', title: '业务笔数', unit: '笔', data: r.hours.map((h) => ({ label: `${h.hour}时`, value: h.count })) },
      { kind: 'table', head: ['时段', '业务笔数'], rows: r.hours.map((h) => [`${h.hour}:00–${h.hour + 1}:00`, h.count]) },
    ] as Block[]] : []),
    [
      { kind: 'heading', text: '按柜员', sub: '金额为 HTB；被冲正：本人办理、之后被冲正的笔数；办理冲正：本人冲正的笔数。' },
      { kind: 'bars', title: '业务笔数', unit: '笔', data: tellers.map((t) => ({ label: t.name, value: t.count })) },
      { kind: 'table', head: ['经办人', '业务笔数', '存款', '取款', '兑换', '被冲正', '办理冲正'],
        rows: tellers.map((t) => [t.name, t.count, t.deposit, t.withdraw, t.purchase, t.reversed, t.reversals]) },
    ],
    [
      { kind: 'heading', text: '账户' },
      { kind: 'stats', items: [['学生', `${s.total} 人`], ['本期办理过业务', `${s.active} 人`], ['期末账面余额', `${formatAmount(s.balance)} HTB`],
        ['余额中位数', `${formatAmount(s.median)} HTB`]] },
      { kind: 'columns', title: '期末余额分布（人）', unit: '人', data: r.distribution.map((d) => ({ label: d.label, value: d.count })) },
      { kind: 'table', head: ['期末余额（HTB）', '学生'], rows: r.distribution.map((d) => [d.label, d.count]) },
    ],
    [
      { kind: 'heading', text: '按班级' },
      { kind: 'bars', title: '期末余额', unit: 'HTB', data: r.classes.map((c) => ({ label: classLabel(c), value: c.balance })) },
      { kind: 'table', head: ['班级', '学生', '办理过业务', '期末余额', '存款', '取款', '账户兑换'],
        rows: r.classes.map((c) => [classLabel(c), c.students, c.active, c.balance, c.deposit, c.withdraw, c.spent]),
        foot: ['合计', s.total, s.active, s.balance, b.deposit.amount, b.withdraw.amount, b.purchase_account.amount] },
    ],
    ...(r.days.length > 1 ? [[
      { kind: 'heading', text: '日终账面余额' },
      { kind: 'line', title: '日终账面余额', unit: 'HTB', data: dailyBalance(r).map(({ d, balance }) => ({ label: dayLabel(d.day), value: balance })) },
    ] as Block[]] : []),
    [
      { kind: 'heading', text: '商品兑换', sub: '成本未填写的商品，成本和毛利为「—」。' },
      { kind: 'bars', title: '兑换数量', unit: '件', color: 'rose-ink', data: products.map((x) => ({ label: x.name, value: x.qty })) },
      { kind: 'table', head: ['商品', '数量', '金额', '账户支付', '现金支付', '成本', '毛利'],
        rows: products.map((x) => [x.name, x.qty, x.amount, x.account, x.cash, x.cost, x.cost === null ? null : x.amount - x.cost]) },
    ],
    [
      { kind: 'heading', text: '库存' },
      { kind: 'table', head: ['商品', '单价', '成本价', '期初', '入库', '出库', '兑出', '期末'],
        rows: stock.map((x) => [x.name, x.price, x.cost, x.opening, x.stock_in, x.stock_out, x.sold, x.closing]) },
    ],
  ];
  return renderDoc('海豚银行报表', sub, pages.flatMap((p, i) => (i ? [{ kind: 'page' } as Block, ...p] : p)));
}

// Writes the sheets to an .xlsx download; each column is as wide as its longest cell (a CJK character counts double).
export async function saveWorkbook(name: string, sheets: Sheet[]) {
  const XLSX = await import('xlsx'); // SheetJS loads only when a file is exported
  const book = XLSX.utils.book_new();
  for (const [title, rows] of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const width = (v: Cell) => [...String(v ?? '')].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
    sheet['!cols'] = Array.from({ length: Math.max(...rows.map((r) => r.length)) }, (_, i) =>
      ({ wch: Math.min(Math.max(8, ...rows.map((r) => width(r[i] ?? null) + 2)), 60) }));
    XLSX.utils.book_append_sheet(book, sheet, title);
  }
  XLSX.writeFile(book, name);
}
