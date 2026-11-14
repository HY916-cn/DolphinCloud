// lib/format's and lib/term's writing, copied so this file loads on its own, as the unit tests load it: 1,280; 0.37;
// 2026-12-10 → 12月10日.
const formatAmount = (n: number) => Math.abs(n).toLocaleString('en-US');
const formatCenti = (c: number) => `${formatAmount(Math.trunc(c / 100))}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

// 理财 (PHASE-2.md §10.10; design system Invest): a wealth_holdings row, a day of the index (wealth_days, as wealth_quote
// and wealth_overview give it), the counter's wealth_quote, the back office's wealth_overview, and how the pages write
// them. Rates and changes are percentages with 4 decimals; dates are YYYY-MM-DD and compare as strings.
export type WealthHolding = {
  id: string; student_no: string; principal: number; weeks: number; opened_on: string; starts_on: string; matures_on: string;
  value_centi: number; valued_to: string; status: 'open' | 'matured' | 'redeemed' | 'reversed'; open_txn: string; close_txn: string | null;
  tier: string; tier_name: string; multiplier: number; factor: number; base: number; min_rate: number; max_rate: number;
};
export type WealthDay = {
  day: string; close: number | null; prev_close: number | null; change: number; source: string; source_name: string; note: string | null; created_at: string;
};
export type Tier = { key: string; name: string; multiplier: number; min: number; max: number };
export type WealthOption = { weeks: number; starts_on: string; matures_on: string; base: number; day_base: number; tiers: (Tier & { rate: number | null })[] };
export type WealthQuote = {
  student_no: string; today: { day: string; closed: boolean | null }; index: { symbol: string; name: string }; factor: number; tiers: Tier[];
  options: WealthOption[]; latest: WealthDay | null; recent: WealthDay[]; balance: number; wealth_total: number; holdings: WealthHolding[];
};
export type WealthParams = { symbol: string; name: string; factor: number; base: Record<string, number>; tiers: Tier[] };
export type OverviewDay = {
  day: string; status: 'open' | 'closed' | 'pending' | 'none'; close: number | null; change: number | null; source_name: string | null;
  created_by_name: string | null; rates: Record<string, Record<string, number>> | null;
};
export type WealthOverview = {
  params: WealthParams & { day_base: Record<string, number> }; days: OverviewDay[]; missing: string[];
  open: { count: number; principal: number; value_centi: number };
};

// A percentage to 2 decimals, half away from zero, with its sign: +1.23%, −0.80%, 0.00%.
export function signedPct(r: number) {
  const hundredths = Math.round(Math.round(Math.abs(r) * 10_000) / 100);
  return `${r > 0 && hundredths ? '+' : r < 0 && hundredths ? '−' : ''}${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}%`;
}
// A bound or a base without a sign, to 2 decimals at most: 10%, 0.52%.
export const plainPct = (r: number) => `${Number((Math.round(Math.round(Math.abs(r) * 10_000) / 100) / 100).toFixed(2))}%`;
// dc-pl's direction: is-up above zero, is-down below, none at zero (as shown, to 2 decimals).
export const plClass = (r: number) => (Math.round(Math.abs(r) * 100) === 0 ? '' : r > 0 ? 'is-up' : 'is-down');
// A gain in 0.01 HTB with its sign and word: 盈 +3.20 HTB, 亏 −3.50 HTB, 持平.
export function gain(centi: number) {
  if (!centi) return { text: '持平', cls: '' };
  return centi > 0 ? { text: `盈 +${formatCenti(centi)} HTB`, cls: 'is-up' } : { text: `亏 −${formatCenti(-centi)} HTB`, cls: 'is-down' };
}
// 平衡 ×2.
export const tierLabel = (t: { name?: string; tier_name?: string; multiplier: number }) => `${t.name ?? t.tier_name} ×${Number(t.multiplier)}`;
// A tier's daily bounds as its card writes them.
export const bounds = (t: Pick<Tier, 'min' | 'max'>) => [`每天最多赚 ${plainPct(t.max)}`, `每天最多亏 ${plainPct(t.min)}`] as const;
// 今天 for today, else 11月14日.
export const dayName = (day: string, today: string) => (day === today ? '今天' : monthDay(day));

// The amount field's hint: the range before an amount, then the shortfall over 活期.
export function amountHint(amount: number, balance: number) {
  if (amount > balance) return { text: `余额不足：活期余额 ${formatAmount(balance)} HTB，还差 ${formatAmount(amount - balance)} HTB`, error: true };
  return { text: `1 HTB 起，最多 ${formatAmount(balance)} HTB（活期余额）`, error: false };
}

// One line of a 理财 list: the sentence before the bold value, the value, the gain, the day after it, the status tag,
// and whether 赎回 is offered. A redeemed one names the day it was redeemed when `closedOn` knows it.
export function holdingLine(h: WealthHolding, closedOn?: string | null) {
  const head = `理财 ${h.weeks} 周 · ${tierLabel(h)} · 本金 ${formatAmount(h.principal)} HTB，`;
  const g = gain(h.value_centi - 100 * h.principal);
  const day = h.status === 'redeemed' ? (closedOn ? `${monthDay(closedOn)} 赎回` : null) : `${monthDay(h.matures_on)} 到期`;
  return {
    lead: `${head}${h.status === 'open' ? '现在值' : '拿回'} `, amount: `${formatCenti(h.value_centi)} HTB`, gain: g, day,
    tag: h.status === 'open' ? 'open' as const : h.status === 'matured' ? 'matured' as const : 'redeemed' as const, canRedeem: h.status === 'open',
  };
}

// The 理财 a list shows: not the reversed ones, latest bought first.
export const shownHoldings = <T extends Pick<WealthHolding, 'status' | 'opened_on'>>(list: T[]) =>
  list.filter((h) => h.status !== 'reversed').sort((a, b) => (a.opened_on < b.opened_on ? 1 : a.opened_on > b.opened_on ? -1 : 0));

// What the open ones are worth, with their gain, as the 首页 and the 存折 write 理财; null with none.
export function heldValue(list: Pick<WealthHolding, 'status' | 'principal' | 'value_centi'>[]) {
  const open = list.filter((h) => h.status === 'open');
  if (!open.length) return null;
  const value = open.reduce((s, h) => s + h.value_centi, 0);
  return { text: `${formatCenti(value)} HTB`, gain: gain(value - 100 * open.reduce((s, h) => s + h.principal, 0)) };
}

// A rate cut by its tier's daily bounds, which 每日收益 prints in bold.
export const clipped = (rate: number, t: Pick<Tier, 'min' | 'max'>) => rate <= t.min || rate >= t.max;

// 指数涨跌 as typed (− or -), a percentage from −50 to 50 with 4 decimals at most; null when it is not one.
export function parseChange(text: string) {
  const t = text.trim().replace('−', '-');
  if (!/^-?\d{1,2}(\.\d{1,4})?$/.test(t)) return null;
  const n = Number(t);
  return Math.abs(n) <= 50 ? n : null;
}

// 理财 on the 参数 page (set_setting's checks on wealth_params, §14.3): each value as typed, a tier's 每天最多亏 without its
// sign. The tiers keep their keys and number.
export type WealthDraft = {
  symbol: string; name: string; factor: string; base: Record<string, string>;
  tiers: { key: string; name: string; multiplier: string; loss: string; profit: string }[];
};
export const wealthDraft = (p: WealthParams): WealthDraft => ({
  symbol: p.symbol, name: p.name, factor: String(p.factor), base: Object.fromEntries(Object.entries(p.base).map(([w, r]) => [w, String(r)])),
  tiers: p.tiers.map((t) => ({ key: t.key, name: t.name, multiplier: String(t.multiplier), loss: String(-t.min), profit: String(t.max) })),
});
export const wealthValues = (d: WealthDraft): WealthParams => ({
  symbol: d.symbol.trim(), name: d.name.trim(), factor: Number(d.factor),
  base: Object.fromEntries(Object.entries(d.base).map(([w, r]) => [w, Number(r)])),
  tiers: d.tiers.map((t) => ({ key: t.key, name: t.name.trim(), multiplier: Number(t.multiplier), min: t.loss === '0' ? 0 : -Number(t.loss), max: Number(t.profit) })),
});
const decimal = (v: string, min: number, max: number) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) >= min && Number(v) <= max;
const range = (min: number, max: number) => `请输入 ${min} 到 ${max} 的数，最多 4 位小数`;
// What is wrong with each value, keyed "symbol", "name", "factor", "base.12", "tiers.1.loss"…; empty when it can be saved.
export function wealthProblems(d: WealthDraft) {
  const p: Record<string, string> = {};
  if (!/^(sh|sz)\d{6}$/.test(d.symbol.trim())) p.symbol = '请输入 sh 或 sz 加 6 位数字，如 sh000300';
  if (!d.name.trim() || d.name.trim().length > 20) p.name = '请输入 1 到 20 个字';
  if (!decimal(d.factor, 0.01, 10)) p.factor = range(0.01, 10);
  for (const [w, v] of Object.entries(d.base)) if (!decimal(v, 0, 100)) p[`base.${w}`] = range(0, 100);
  d.tiers.forEach((t, i) => {
    if (!t.name.trim() || t.name.trim().length > 10) p[`tiers.${i}.name`] = '请输入 1 到 10 个字';
    if (!decimal(t.multiplier, 0.1, 20)) p[`tiers.${i}.multiplier`] = range(0.1, 20);
    if (!decimal(t.loss, 0, 100)) p[`tiers.${i}.loss`] = range(0, 100);
    if (!decimal(t.profit, 0, 100)) p[`tiers.${i}.profit`] = range(0, 100);
  });
  return p;
}
