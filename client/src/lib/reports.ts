import type { LedgerRow } from '@/components/Ledger';
import { formatTime, maskName } from './format';
import type { Scope } from './search';
import { readAll, supabase } from './supabase';

// 报表 (PHASE-1.md §6.8, §7.9): the shape bank_report returns, the periods it is read for, and the Excel files that
// 报表 and 流水 export. Student names in a file are masked (张*明) unless the exporter asks for full names.

type Count = { count: number; amount: number };
export type Report = {
  business: { deposit: Count; withdraw: Count; purchase_account: Count; purchase_cash: Count; students: number };
  reversals: Count; reversed: number; openings: Count;
  balance: { opening: number; closing: number; changes: Partial<Record<'opening' | 'deposit' | 'withdraw' | 'purchase' | 'reversal' | 'salary', number>> };
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
  issues: { total: number; batches: { batch_no: string; issued_on: string; total: number; purpose: string; approver: string; denominations: Record<string, number> }[] };
};

// The arguments bank_report takes for a scope (null: the whole bank).
export function scopeArgs(scope: Scope | null) {
  if (!scope) return {};
  if (scope.kind === 'student') return { p_student_no: scope.student_no };
  if (scope.kind === 'division') return { p_division: scope.division };
  return { p_division: scope.division, p_cohort: scope.cohort, p_class_no: scope.class_no };
}

// 流水's filters; the same ones choose the rows an export writes.
export type LedgerFilter = {
  scope: Scope | null; from: string; to: string; timeFrom: string; timeTo: string; kinds: string[]; operator: string; txnNo: string;
  payment: '' | 'account' | 'cash'; status: '' | 'normal' | 'reversed'; min: string; max: string;
};
export const NO_FILTER: LedgerFilter = { scope: null, from: '', to: '', timeFrom: '', timeTo: '', kinds: [], operator: '', txnNo: '', payment: '', status: '', min: '', max: '' };

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
  if (f.payment) q = q.eq('payment', f.payment);
  if (f.status) q = q.eq('status', f.status);
  if (/^\d+$/.test(f.min)) q = q.gte('amount', Number(f.min));
  if (/^\d+$/.test(f.max)) q = q.lte('amount', Number(f.max));
  return q;
}

type Cell = string | number | null;
type Sheet = [string, Cell[][]];
const TYPE = { opening: '期初余额', deposit: '存款', withdraw: '取款', purchase: '兑换', reversal: '冲正', salary: '工资' } as const;
const PAYMENT = { account: '账户', cash: '现金' } as const;

// Every transaction the filters choose, oldest first, as the 流水明细 sheet.
export async function ledgerSheet(select: string, f: LedgerFilter, fullNames: boolean): Promise<Sheet> {
  const rows = await readAll((from, to) => ledgerQuery(select, f).order('seq').range(from, to) as unknown as
    PromiseLike<{ data: LedgerRow[] | null; error: unknown }>);
  return ['流水明细', [
    ['交易号', '时间', '学号', '姓名', '班级', '业务', '金额', '支付方式', '余额变动', '办理后余额', '商品', '经办人', '状态', '冲正原因'],
    // formatTime against 1970 always writes the year.
    ...rows.map((r) => [
      r.txn_no, formatTime(r.created_at, new Date(0)), r.student_no, fullNames ? r.students?.name ?? '' : maskName(r.students?.name ?? ''),
      r.students?.class_label ?? '', TYPE[r.type], r.amount, r.payment && r.type !== 'opening' ? PAYMENT[r.payment] : '', r.balance_delta,
      r.balance_after, r.txn_items?.map((i) => `${i.name} × ${i.qty}`).join('、') ?? '', r.operator?.display_name ?? '',
      r.status === 'reversed' ? '已冲正' : '正常', r.reason ?? '',
    ]),
  ]];
}

// Each day with the balance at its end: the opening balance plus every change up to that day.
export function dailyBalance(r: Report) {
  let balance = r.balance.opening;
  return r.days.map((d) => ({ d, balance: (balance += d.change) }));
}

// The report's sheets, the same tables 报表 shows.
export function reportSheets(r: Report, period: string, scope: string): Sheet[] {
  const b = r.business;
  const ch = r.balance.changes;
  return [
    ['汇总', [
      ['海豚银行报表'], ['期间', period], ['范围', scope], [],
      ['营业', '笔数', '金额'],
      ['存款', b.deposit.count, b.deposit.amount], ['取款', b.withdraw.count, b.withdraw.amount],
      ['兑换（账户）', b.purchase_account.count, b.purchase_account.amount], ['兑换（现金）', b.purchase_cash.count, b.purchase_cash.amount],
      ['冲正', r.reversals.count, r.reversals.amount], ['期初余额导入', r.openings.count, r.openings.amount], ['办理业务的学生', b.students, null], [],
      ['余额核对', '金额'],
      ['期初账面余额', r.balance.opening], ['期初余额导入', ch.opening ?? 0], ['存款', ch.deposit ?? 0], ['取款', ch.withdraw ?? 0],
      ['兑换（账户）', ch.purchase ?? 0], ['冲正', ch.reversal ?? 0], ['工资', ch.salary ?? 0], ['期末账面余额', r.balance.closing], [],
      ['柜面现金', '金额'], ['收入', r.cash.in], ['付出', r.cash.out], ['净额', r.cash.in - r.cash.out], [],
      ['账户', '数值'], ['学生', r.students.total], ['本期办理过业务', r.students.active], ['正常', r.students.normal],
      ['已冻结', r.students.frozen], ['已毕业', r.students.graduated], ['账面余额', r.students.balance],
      ['余额中位数', r.students.median], ['最高余额', r.students.max], [],
      ['货币发行', '金额'], ['累计发行（至期末）', r.issues.total], ['本期发行', r.issues.batches.reduce((s, i) => s + i.total, 0)],
    ]],
    ['按日', [['日期', '存款笔数', '存款', '取款笔数', '取款', '兑换笔数', '兑换', '学生', '余额变动', '日终账面余额'],
      ...dailyBalance(r).map(({ d, balance }) => [d.day, d.deposit_count, d.deposit, d.withdraw_count, d.withdraw, d.purchase_count, d.purchase,
        d.students, d.change, balance])]],
    ['按时段', [['时段', '业务笔数'], ...r.hours.map((h) => [`${h.hour}:00–${h.hour + 1}:00`, h.count])]],
    ['按柜员', [['经办人', '业务笔数', '存款笔数', '存款', '取款笔数', '取款', '兑换笔数', '兑换', '被冲正', '办理冲正'],
      ...r.tellers.filter((t) => t.count || t.reversed || t.reversals).map((t) => [t.name, t.count, t.deposit_count, t.deposit, t.withdraw_count, t.withdraw, t.purchase_count, t.purchase, t.reversed, t.reversals])]],
    ['按班级', [['学部', '班级', '学届', '学生', '办理过业务', '期末余额', '存款', '取款', '账户兑换'],
      ...r.classes.map((c) => [c.division === 'primary' ? '小学部' : '初中部', c.class_label ?? `${c.class_no}班`, c.cohort, c.students,
        c.active, c.balance, c.deposit, c.withdraw, c.spent])]],
    ['余额分布', [['期末余额（HTB）', '学生'], ...r.distribution.map((d) => [d.label, d.count])]],
    ['商品兑换', [['商品', '数量', '金额', '账户支付', '现金支付', '成本', '毛利'],
      ...r.products.map((p) => [p.name, p.qty, p.amount, p.account, p.cash, p.cost, p.cost === null ? null : p.amount - p.cost])]],
    ['库存', [['商品', '单价', '成本价', '期初', '入库', '出库', '兑出', '期末'],
      ...r.stock.map((s) => [s.name, s.price, s.cost, s.opening, s.stock_in, s.stock_out, s.sold, s.closing])]],
    ['货币发行', [['批次号', '发行日期', '面额 × 张数', '金额', '用途', '审批人'],
      ...r.issues.batches.map((i) => [i.batch_no, i.issued_on,
        Object.entries(i.denominations).map(([d, n]) => `${d} × ${n}`).join('、'), i.total, i.purpose, i.approver])]],
  ];
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
