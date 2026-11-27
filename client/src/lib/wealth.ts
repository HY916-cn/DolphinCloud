// lib/format's and lib/term's writing, copied so this file loads on its own, as the unit tests load it: 1,280; 0.37;
// 2026-12-10 → 12月10日; the day after 2026-11-26.
const formatAmount = (n: number) => Math.abs(n).toLocaleString('en-US');
const formatCenti = (c: number) => `${formatAmount(Math.trunc(c / 100))}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
// The school's date (Asia/Shanghai) of a moment: 2026-11-26.
const CN_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export const cnDay = (iso: string) => CN_DAY.format(new Date(iso));

// 理财 (PHASE-2.md §10.10, §15; design system Invest): six products, each with a net value a day; a holding is bought at
// its product's net value and sold whole from the next day. Ones bought for a term before the six products (weeks set)
// stay listed with their length and tier. Net values have 6 decimals; rates and changes are percentages with 4;
// amounts in 0.01 HTB end in _centi; dates are YYYY-MM-DD and compare as strings.
export type Product = { key: string; name: string; nav: number | null; nav_day: string | null; change: number | null; waiting: boolean };
export type Holding = {
  id: string; product: string; name: string; principal: number; buy_nav: number | null; bought_at: string; value_centi: number;
  gain_centi: number; sellable_on: string; status: 'open' | 'redeemed' | 'matured'; closed_on: string | null; returned_centi: number | null;
  weeks?: number; tier_name?: string; multiplier?: number; matures_on?: string;
};
// wealth_quote (the counter); my_wealth is the same without balance.
export type WealthQuote = {
  student_no: string; today: string; products: Product[]; balance: number; wealth_total: number; value_centi: number; gain_centi: number;
  holdings: Holding[];
};
export type MyWealth = Omit<WealthQuote, 'balance'>;
export type ProductParams = { key: string; name: string; symbol: string; multiplier: number; premium: number };
export type WealthParams = { cap: number; products: ProductParams[] };
export type OverviewDay = {
  day: string; status: 'open' | 'closed' | 'pending' | 'none'; close: number | null; prev_close: number | null; change: number | null;
  source: string | null; source_name: string | null; note: string | null; created_by_name: string | null; created_at: string | null;
  rate: number | null; nav: number | null;
};
export type Totals = { count: number; principal: number; value_centi: number };
// `inferred`: the weekdays among its last 30 days of net values taken as closed with no close (oldest first), not to be entered.
export type OverviewProduct = Product & Totals & { missing: string[]; inferred: string[]; days: OverviewDay[] };
export type WealthOverview = { params: WealthParams; products: OverviewProduct[]; term: Totals; open: Totals };

// A percentage to 2 decimals, half away from zero, with its sign: +1.23%, −0.80%, 0.00%.
export function signedPct(r: number) {
  const hundredths = Math.round(Math.round(Math.abs(r) * 10_000) / 100);
  return `${r > 0 && hundredths ? '+' : r < 0 && hundredths ? '−' : ''}${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}%`;
}
// A percentage to 2 decimals with a sign only below zero: 4.00%, −8.00%.
export const fixedPct = (r: number) => signedPct(r).replace('+', '');
// dc-pl's direction: is-up above zero, is-down below, none at zero (as shown, to 2 decimals).
export const plClass = (r: number) => (Math.round(Math.abs(r) * 100) === 0 ? '' : r > 0 ? 'is-up' : 'is-down');
// A net value as the counter writes it, to 4 decimals: 1.0565.
export const nav4 = (n: number) => (Math.round(n * 10_000) / 10_000).toFixed(4);
// A gain in 0.01 HTB with its sign and word: 盈 +3.20 HTB, 亏 −3.50 HTB, 持平.
export function gain(centi: number) {
  if (!centi) return { text: '持平', cls: '' };
  return centi > 0 ? { text: `盈 +${formatCenti(centi)} HTB`, cls: 'is-up' } : { text: `亏 −${formatCenti(-centi)} HTB`, cls: 'is-down' };
}
// 今天 for today, else 11月14日.
export const dayName = (day: string, today: string) => (day === today ? '今天' : monthDay(day));
// A product's day and that day's rate, as one dc-pl: 今天 +0.84%; null before its first day.
export function productDay(p: Pick<Product, 'nav_day' | 'change'>, today: string) {
  if (!p.nav_day || p.change == null) return null;
  return { text: `${dayName(p.nav_day, today)} ${signedPct(p.change)}`, cls: plClass(p.change) };
}
// The day a holding may be sold, while it may not yet: 明天可卖, 11月28日可卖; null once it may (and for one bought for a term).
export function sellableTag(h: Pick<Holding, 'status' | 'sellable_on' | 'weeks'>, today: string) {
  if (h.status !== 'open' || h.weeks != null || h.sellable_on <= today) return null;
  return h.sellable_on === nextDay(today) ? '明天可卖' : `${monthDay(h.sellable_on)}可卖`;
}

// The amount field's hint: the range before an amount, then the shortfall over 活期.
export function amountHint(amount: number, balance: number) {
  if (amount > balance) return { text: `余额不足：活期余额 ${formatAmount(balance)} HTB，还差 ${formatAmount(amount - balance)} HTB`, error: true };
  return { text: `1 HTB 起，最多 ${formatAmount(balance)} HTB（活期余额）`, error: false };
}
// The line under the amount once a product and an amount are chosen.
export const buyText = (p: Pick<Product, 'name' | 'nav'>, amount: number) =>
  `按${p.name}当前净值 ${nav4(p.nav ?? 1)} 买入 ${formatAmount(amount)} HTB。净值涨 1%，这笔理财也涨 1%；明天起可以卖出。`;

// A holding's name: 黄金, or 沪深 300 · 12 周 · 平衡 ×2 for one bought for a term.
export const holdingName = (h: Pick<Holding, 'name' | 'weeks' | 'tier_name' | 'multiplier'>) =>
  h.weeks != null ? `${h.name} · ${h.weeks} 周 · ${h.tier_name} ×${Number(h.multiplier)}` : h.name;

// One line of a 理财 list (design system Invest 持仓列表): the sentence before the bold value, the value, the gain, the day
// after it, and what stands on the right: 卖出 (the counter, `sell`), the day it may be sold, or the status. The student's
// line (`student`) leaves out the net value.
export function holdingLine(h: Holding, today: string, student = false) {
  const open = h.status === 'open';
  const value = open ? h.value_centi : (h.returned_centi ?? h.value_centi);
  const bought = dayName(cnDay(h.bought_at), today);
  const day = h.status === 'redeemed' ? `${monthDay(h.closed_on ?? today)} 卖出`
    : h.weeks != null ? `${monthDay(h.matures_on ?? h.closed_on ?? today)} 到期`
    : student || h.buy_nav == null ? `${bought} 买入` : `${bought} 按净值 ${nav4(h.buy_nav)} 买入`;
  const wait = sellableTag(h, today);
  return {
    lead: `${holdingName(h)} · 本金 ${formatAmount(h.principal)} HTB，${open ? '现在值' : '拿回'} `, amount: `${formatCenti(value)} HTB`,
    gain: gain(value - 100 * h.principal), day,
    tag: open ? (wait ? 'wait' as const : 'open' as const) : h.status === 'matured' ? 'matured' as const : 'redeemed' as const, wait,
  };
}

// The 理财 a list shows: the open ones first, latest bought first, then the closed ones, latest closed first.
export function shownHoldings<T extends Pick<Holding, 'status' | 'bought_at' | 'closed_on'>>(list: T[]) {
  const cmp = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  const open = list.filter((h) => h.status === 'open').sort((a, b) => cmp(a.bought_at, b.bought_at));
  const closed = list.filter((h) => h.status === 'redeemed' || h.status === 'matured').sort((a, b) => cmp(a.closed_on ?? '', b.closed_on ?? ''));
  return [...open, ...closed];
}

// What the open ones are worth, with their gain, as 我的理财, the 首页 and the 存折 write 理财; null with none open.
export function heldValue(w: Pick<MyWealth, 'value_centi' | 'gain_centi' | 'holdings'>) {
  if (!w.holdings.some((h) => h.status === 'open')) return null;
  return { text: `${formatCenti(w.value_centi)} HTB`, gain: gain(w.gain_centi) };
}

// The days still to enter, as the back office's notice lists them: 黄金 11月21日；恒生指数 11月21日、11月24日; with their count.
export function missingText(products: Pick<OverviewProduct, 'name' | 'missing'>[]) {
  const waiting = products.filter((p) => p.missing.length);
  return {
    count: waiting.reduce((s, p) => s + p.missing.length, 0),
    text: waiting.map((p) => `${p.name} ${p.missing.map(monthDay).join('、')}`).join('；'),
  };
}

// 行情涨跌 as typed (− or -), a percentage from −50 to 50 with 4 decimals at most; null when it is not one.
export function parseChange(text: string) {
  const t = text.trim().replace('−', '-');
  if (!/^-?\d{1,2}(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return Math.abs(n) <= 50 ? n : null;
}

// 理财 on the 参数 page (set_setting's checks on wealth_params, §14.3): each product's multiplier and premium as typed;
// cap and each product's key, name and symbol are the system's, sent back as read.
export type WealthDraft = { key: string; name: string; multiplier: string; premium: string }[];
export const wealthDraft = (p: WealthParams): WealthDraft =>
  p.products.map((x) => ({ key: x.key, name: x.name, multiplier: String(x.multiplier), premium: String(x.premium).replace('-', '−') }));
const toNumber = (v: string) => Number(v.trim().replace('−', '-'));
export const wealthValues = (d: WealthDraft, saved: WealthParams): WealthParams => ({
  ...saved,
  products: saved.products.map((p, i) => ({ ...p, multiplier: toNumber(d[i].multiplier), premium: toNumber(d[i].premium) || 0 })),
});
const decimal = (v: string, min: number, max: number, signed = false) => {
  const t = v.trim().replace('−', '-');
  return (signed ? /^-?\d+(\.\d{1,4})?$/ : /^\d+(\.\d{1,4})?$/).test(t) && Number(t) >= min && Number(t) <= max;
};
// What is wrong with each value, keyed "1.multiplier", "4.premium"…; empty when it can be saved.
export function wealthProblems(d: WealthDraft) {
  const p: Record<string, string> = {};
  d.forEach((x, i) => {
    if (!decimal(x.multiplier, 0.1, 20)) p[`${i}.multiplier`] = '倍率在 0.1～20 之间，最多 4 位小数。';
    if (!decimal(x.premium, -10, 10, true)) p[`${i}.premium`] = '基准加成在 −10～10 之间，最多 4 位小数。';
  });
  return p;
}
// This week's base of a product: the week's anchor plus its premium as typed; null while the premium is not a number.
export function weekBase(anchor: number, premium: string) {
  const n = toNumber(premium);
  return premium.trim() && Number.isFinite(n) ? fixedPct(Math.round((anchor + n) * 10_000) / 10_000) : null;
}
