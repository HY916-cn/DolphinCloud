import type { Counts } from './cash';

// 补录 and 编辑 (PHASE-2.md §10.11, design system ManualEntry): what an entry changes, what manual_entry and correct_txn
// are sent, and how the pages say it. No runtime imports, so the unit tests load it on its own.

export type EntryType = 'deposit' | 'withdraw' | 'purchase' | 'adjust';
export const ENTRY_TYPES: [EntryType, string][] = [['deposit', '存款'], ['withdraw', '取款'], ['purchase', '兑换'], ['adjust', '调账']];
export const ENTRY_NAME: Record<EntryType, string> = Object.fromEntries(ENTRY_TYPES) as Record<EntryType, string>;
export const ADJUST_MAX = 100000;
export const REASON_MAX = 100;

// One entry as the form holds it: `amount` is the business's (signed for a 调账); `denominations` the notes received
// (存款, 现金兑换) or paid out (取款, empty for the counter's usual notes); `items` the products of a 兑换.
export type Entry = {
  type: EntryType; amount: number; payment: 'account' | 'cash' | null; denominations: Counts | null;
  items: { product_id: string; qty: number }[] | null;
};

const total = (c: Counts | null) => Object.entries(c ?? {}).reduce((s, [face, n]) => s + Number(face) * n, 0);
const notes = (c: Counts | null) => {
  const kept = Object.fromEntries(Object.entries(c ?? {}).filter(([, n]) => n > 0));
  return Object.keys(kept).length ? kept : null;
};

// The change to 活期: a cash 兑换 leaves it as it is.
export const entryDelta = (e: Entry) =>
  e.type === 'deposit' ? e.amount : e.type === 'adjust' ? e.amount : e.type === 'withdraw' || e.payment === 'account' ? -e.amount : 0;

// What is still missing or wrong before the entry can be sent, or null.
export function entryProblem(e: Entry): string | null {
  if (e.type === 'adjust') return !e.amount ? '请输入调账金额' : Math.abs(e.amount) > ADJUST_MAX ? `调账金额最多 ${ADJUST_MAX} HTB` : null;
  if (e.type === 'purchase') {
    if (!e.items?.length) return '请选择商品';
    return e.payment === 'cash' && total(e.denominations) < e.amount ? `收款不足，还差 ${e.amount - total(e.denominations)} HTB` : null;
  }
  if (!e.amount) return e.type === 'deposit' ? '请录入张数' : '请输入取款金额';
  if (e.type === 'withdraw' && notes(e.denominations) && total(e.denominations) !== e.amount) return `面额合计 ${total(e.denominations)} HTB，要等于取款金额`;
  return null;
}

// manual_entry's p_amount, p_payment, p_denominations and p_items; correct_txn's p_new takes the same without the p_.
export function entryArgs(e: Entry) {
  return {
    amount: e.type === 'withdraw' || e.type === 'adjust' ? e.amount : null,
    payment: e.type === 'purchase' ? e.payment : null,
    denominations: e.type === 'adjust' || (e.type === 'purchase' && e.payment !== 'cash') ? null : notes(e.denominations),
    items: e.type === 'purchase' ? e.items : null,
  };
}

// The same business as the original: nothing to 编辑. Products in any order.
export function sameEntry(a: Entry & { student_no: string }, b: Entry & { student_no: string }) {
  const key = (e: Entry & { student_no: string }) => {
    const args = entryArgs(e);
    const items = args.items && [...args.items].sort((x, y) => x.product_id.localeCompare(y.product_id));
    const cash = args.denominations && Object.fromEntries(Object.entries(args.denominations).sort(([x], [y]) => Number(x) - Number(y)));
    return JSON.stringify([e.student_no, e.type, { ...args, items, denominations: cash }]);
  };
  return key(a) === key(b);
}

// A date and a time of day on the school's clock as an instant.
export const occurredAt = (date: string, time: string) => `${date}T${time}:00+08:00`;

function shanghai(iso: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}
// 11月12日 14:20 on the school's clock.
export const atText = (iso: string) => { const t = shanghai(iso); return `${Number(t.month)}月${Number(t.day)}日 ${t.hour}:${t.minute}`; };
// The day and the time of day of an instant, for the pickers.
export const dayAndTime = (iso: string) => {
  const t = shanghai(iso);
  return { date: `${t.year}-${t.month.padStart(2, '0')}-${t.day.padStart(2, '0')}`, time: `${t.hour}:${t.minute}` };
};
export const rangeHint = (from: string) => `可补录 ${atText(from)} 以后的业务`;

const htb = (n: number) => Math.abs(n).toLocaleString('en-US');
const signed = (n: number) => `${n < 0 ? '−' : '+'}${htb(n)}`;
// +0.15, −0.08: an interest correction in 0.01 HTB.
export const signedCenti = (c: number) => `${c < 0 ? '−' : '+'}${Math.trunc(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;

// 已补录，利息更正 +0.15 HTB: the toast after 补录 or 编辑, with the interest corrected for every student it touched.
export function doneText(verb: '补录' | '编辑', interest: { centi: number }[]) {
  const centi = interest.reduce((s, i) => s + i.centi, 0);
  return interest.length ? `已${verb}，利息更正 ${signedCenti(centi)} HTB` : `已${verb}`;
}

// 存款 25 HTB, 调账 −20 HTB: the business and its amount, a 调账 with its sign.
export const entryAmount = (e: Pick<Entry, 'type' | 'amount'>) => `${e.type === 'adjust' ? signed(e.amount) : htb(e.amount)} HTB`;
// The confirmation's title: 补录张小明的存款 25 HTB？ or 给张小明调账 −20 HTB？
export const entryQuestion = (name: string, e: Pick<Entry, 'type' | 'amount'>) =>
  e.type === 'adjust' ? `给${name}调账 ${entryAmount(e)}？` : `补录${name}的${ENTRY_NAME[e.type]} ${entryAmount(e)}？`;
// 415 → 440 HTB.
export const balanceMove = (from: number, delta: number) => `${htb(from)} → ${from + delta < 0 ? '−' : ''}${htb(from + delta)} HTB`;
