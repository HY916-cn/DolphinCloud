// 货币 (PHASE-2.md §11, design system Currency): the bank's notes and electronic money, the bank admin's records, and the
// 经营看板 on 总览. Written without lib/format, so this file loads on its own, as the unit tests load it.
import type { IconName } from '../theme/icons';

export type Counts = Record<string, number>;
export type Kind = 'baseline' | 'issue' | 'recover' | 'destroy' | 'correction';
export type Move = {
  id: string; kind: Kind; batch_no: string | null; on_date: string; denominations: Counts; total: number; reason: string | null;
  approver_name: string | null; corrects: string | null; created_at: string; creator: { display_name: string } | null;
};
type Note = { note: number; baseline: number; issued: number; recovered: number; destroyed: number; flow: number; bank: number; students: number; counted: number | null };
export type Payout = { ratio: number | null; min: number; low: boolean };
export type Overview = {
  baseline: { id: string; on_date: string; created_at: string } | null;
  notes: Note[];
  paper: { baseline: number; issued: number; recovered: number; destroyed: number; flow: number; bank: number; students: number };
  counted: { boxes: number; at: string | null; total: number };
  electronic: { current: number; term: number; wealth: number; total: number; new: { salary: number; interest: number; wealth: number; loan: number; repay: number; total: number } };
  payout: Payout;
};
export type Dashboard = {
  balance: { current: number; term: number; wealth: number; total: number };
  bank_cash: number;
  payout: Payout;
  loans: { count: number; remaining: number; overdue: { count: number; remaining: number } };
  stock: { qty: number; cost: number; uncosted: number };
  week: { week_start: string; count: number };
  anchor: { week_start: string | null; anchor: number };
  weeks: { week_start: string; count: number }[];
};

// The kinds of a record, in the order the form offers them, with their icon and the ChoiceCard's note.
export const KINDS: Record<Kind, { name: string; icon: IconName; note: string }> = {
  baseline: { name: '期初现金', icon: 'balance', note: '金库和储蓄盒现有的' },
  issue: { name: '发行', icon: 'coin', note: '新的纸币开始流通' },
  recover: { name: '回收', icon: 'back', note: '从银行现金里取出' },
  destroy: { name: '销毁', icon: 'close', note: '损毁的纸币' },
  correction: { name: '更正', icon: 'passbook', note: '冲抵登错的一笔' },
};
// The caption at the top of the form; 发行 has none.
export const CAPTIONS: Partial<Record<Kind, string>> = {
  baseline: '银行现有的全部纸币：金库加各储蓄盒。上线当天开门营业前登记，只登记一次。',
  recover: '从银行现金里取出，不再流通，如旧版回收。',
  destroy: '损毁、不再流通的纸币。',
  correction: '多登的面额写负数，少登的写正数，合计可以为 0。记在今天。',
};
export const COUNT_MAX = 100_000;
export const TOTAL_MAX = 10_000_000;

const amount = (n: number) => Math.abs(n).toLocaleString('en-US');
// 1,200 and −12; signed: +2,310, −36 and 0.
export const net = (n: number) => `${n < 0 ? '−' : ''}${amount(n)}`;
export const signed = (n: number) => (n ? `${n < 0 ? '−' : '+'}${amount(n)}` : '0');
export const htb = (n: number) => `${net(n)} HTB`;
export const signedHtb = (n: number) => `${signed(n)} HTB`;
// 回收 and 销毁 take notes out of the bank: −120 HTB.
export const outHtb = (n: number) => signedHtb(-n);
// 2026-12-07 → 12月7日.
export const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

// "5 元 × 10、10 元 × 30", smallest note first, notes of 0 left out; a 更正's signed: "5 元 −2、10 元 +1".
export function notesText(counts: Counts, correction = false) {
  return Object.entries(counts).filter(([, n]) => n).sort(([a], [b]) => Number(a) - Number(b))
    .map(([note, n]) => (correction ? `${note} 元 ${signed(n)}` : `${note} 元 × ${n}`)).join('、');
}
export const countsTotal = (counts: Counts) => Object.entries(counts).reduce((s, [note, n]) => s + Number(note) * n, 0);
// What a record says, its 合计 included, "发行 350 HTB" or "更正 −10 HTB".
export const kindTotal = (kind: Kind, total: number) => `${KINDS[kind].name} ${kind === 'correction' ? signedHtb(total) : htb(total)}`;

// 兑付能力 to one decimal, 25.3%; — without balances. The line is whole: 30%.
export const ratioText = (r: number | null) => (r === null ? '—' : `${r.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
export const payoutLow = (p: Payout) => `兑付能力 ${ratioText(p.ratio)}，低于 ${p.min}%`;
// The Notice when 兑付能力 is under the line.
export const payoutText = (bank: number, total: number, p: Payout) => `银行应有现金 ${htb(bank)}，是账户余额合计 ${htb(total)} 的 ${ratioText(p.ratio)}。`;

// A record's first line: "期初现金", "发行 FX-1", "更正 · 对应 发行 FX-1".
export const moveName = (m: Pick<Move, 'kind' | 'batch_no'>) => (m.kind === 'issue' ? `发行 ${m.batch_no}` : KINDS[m.kind].name);
export const moveTitle = (m: Move, target?: Move) => (m.kind === 'correction' ? `更正 · 对应 ${target ? moveName(target) : '一笔登记'}` : moveName(m));
// A record to correct, in the 对应的登记 Select: "发行 FX-1 · 12月7日 · 350 HTB".
export const moveOption = (m: Move) => `${moveName(m)} · ${monthDay(m.on_date)} · ${htb(m.total)}`;
// Its third line: what for, who approved, who entered it and when ("开学发行 · 审批 王老师 · 银行管理员 12月7日 09:00 登记").
export const moveBy = (m: Move, at: string) =>
  [m.reason, m.approver_name && `审批 ${m.approver_name}`, `${m.creator?.display_name ?? '银行管理员'} ${at} 登记`].filter(Boolean).join(' · ');

// Whether the notes may be recorded: each count in range, not all 0, the total within 10,000,000 HTB and, but for a 更正, above 0.
export function countsOk(kind: Kind, counts: Counts) {
  const min = kind === 'correction' ? -COUNT_MAX : 0;
  const values = Object.values(counts);
  const total = countsTotal(counts);
  return values.every((n) => Number.isInteger(n) && n >= min && n <= COUNT_MAX) && values.some((n) => n !== 0)
    && Math.abs(total) <= TOTAL_MAX && (kind === 'correction' || total > 0);
}
// The confirmation's title: "登记期初现金 1,200 HTB？", "登记发行 FX-1，350 HTB？", "登记更正 −10 HTB？".
export const confirmTitle = (kind: Kind, total: number, batch = '') =>
  kind === 'issue' ? `登记发行 ${batch}，${htb(total)}？` : `登记${kindTotal(kind, total)}？`;

// 经营看板: the notes under its figures.
export const cashNote = (p: Payout) => (p.ratio === null ? undefined : p.low ? payoutLow(p) : `兑付能力 ${ratioText(p.ratio)}`);
export const loanNote = (l: Dashboard['loans']) =>
  l.overdue.count ? `逾期 ${l.overdue.count} 笔 · ${htb(l.overdue.remaining)}` : l.count ? `${l.count} 笔未结清` : undefined;
export const stockNote = (s: Dashboard['stock']) => `成本 ${htb(s.cost)}${s.uncosted ? ` · ${s.uncosted} 种没填成本` : ''}`;
export const anchorNote = (a: Dashboard['anchor']) => (a.week_start ? `${monthDay(a.week_start)}公布` : '还没有公布，按初始锚点');
export const anchorText = (n: number) => String(Number(n.toFixed(4)));
// This week against the last: "比上周 +12%", "比上周 −5%", "和上周持平", "上周 0 笔".
export function weekChange(now: number, last: number) {
  if (now === last) return '和上周持平';
  if (!last) return '上周 0 笔';
  const pct = Math.round(((now - last) / last) * 100);
  return `比上周 ${now > last ? '+' : '−'}${Math.abs(pct)}%`;
}
// A week on the chart: its axis label "11/16" and its tip "11月16日起 · 128 笔".
export const weekLabel = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
export const weekTip = (d: string, n: number) => `${monthDay(d)}起 · ${n} 笔`;
// The top of a count's scale: 1, 2 or 5 times a power of ten as lib/format's niceMax, with a whole half for the middle line.
export function countTop(max: number) {
  if (max <= 0) return 2;
  const p = 10 ** Math.floor(Math.log10(max));
  const top = ([1, 2, 5, 10].find((m) => m * p >= max) ?? 10) * p;
  return top === 1 ? 2 : top === 5 ? 6 : top;
}
