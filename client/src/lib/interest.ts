// 利息 (design system StudentInterestPage, PHASE-2.md §9.3–9.4): a student's daily 活期 interest by week, the corrections
// a 补录 made, and how 攒着的利息 adds up. Loads on its own, as the unit tests load it.

// One day's interest (interest_accruals): the balance at the day's end, the weekly rate in percent (0 while 活期 was
// paused) and the interest in 0.01 HTB; settled_txn is the 利息 business that paid it in.
export type Accrual = { day: string; balance: number; rate: number; centi: number; settled_txn: string | null };
// A correction of an earlier day's interest (interest_adjustments): the day's corrected balance and the difference.
export type Adjustment = { day: string; txn_id: string; balance: number; centi: number; settled_txn: string | null };
// A 利息 business: what it paid in (HTB) and when (Monday 00:00 Shanghai).
export type Settlement = { id: string; amount: number; created_at: string };

const DAY = 86_400_000;
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
export const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
// The Monday of a day's week.
export const weekOf = (day: string) => shiftDay(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
// The Shanghai date of a moment: a 利息 business at Monday 00:00 belongs to that Monday.
export const cnDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(iso));
const md = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
// 11月13日 星期五.
export const dayTitle = (day: string) => `${md(day)} ${WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]}`;
// 本周, or 11月2日至11月8日 for an earlier week.
export const weekTitle = (monday: string, thisWeek: string) => (monday === thisWeek ? '本周' : `${md(monday)}至${md(shiftDay(monday, 6))}`);

// 4 weeks a page: page 0 is this week and the 3 before it; [from, to) by day, `to` null for the newest.
export const WEEKS_A_PAGE = 4;
export const pageRange = (thisWeek: string, page: number) => ({
  from: shiftDay(thisWeek, -7 * (WEEKS_A_PAGE * page + WEEKS_A_PAGE - 1)),
  to: page ? shiftDay(thisWeek, -7 * (WEEKS_A_PAGE * page - 1)) : null,
});

export type InterestRow =
  | { kind: 'day'; key: string; title: string; balance: number; rate: number; centi: number }
  | { kind: 'adjust'; key: string; day: string; balance: number; centi: number };
export type InterestWeek = { monday: string; title: string; total: number; paid: number | null; rows: InterestRow[] };

// The week a correction is listed in: unsettled ones in this week; settled ones in the week before the Monday that
// paid them in, as that Monday's 利息 settled that week.
function adjustmentWeek(a: Adjustment, paid: Map<string, Settlement>, thisWeek: string) {
  const s = a.settled_txn ? paid.get(a.settled_txn) : undefined;
  return s ? weekOf(shiftDay(cnDay(s.created_at), -1)) : thisWeek;
}

// The days and corrections in weeks, newest first, from `oldest` (a Monday) on: each day its own row, newest first,
// the week's corrections after them. A week's total is the sum of its rows; `paid` the 利息 business that settled it
// (whole HTB, the earlier odd cents included), null while it is still saved up.
export function interestWeeks(days: Accrual[], adjustments: Adjustment[], settlements: Settlement[], thisWeek: string, oldest: string) {
  const paid = new Map(settlements.map((s) => [s.id, s]));
  const weeks = new Map<string, { days: Accrual[]; adjustments: Adjustment[] }>();
  const at = (monday: string) => {
    if (!weeks.has(monday)) weeks.set(monday, { days: [], adjustments: [] });
    return weeks.get(monday)!;
  };
  for (const d of days) at(weekOf(d.day)).days.push(d);
  for (const a of adjustments) {
    const monday = adjustmentWeek(a, paid, thisWeek);
    if (monday >= oldest) at(monday).adjustments.push(a);
  }
  return [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([monday, w]): InterestWeek => {
    const rows: InterestRow[] = [
      ...[...w.days].sort((a, b) => (a.day < b.day ? 1 : -1))
        .map((d) => ({ kind: 'day' as const, key: d.day, title: dayTitle(d.day), balance: d.balance, rate: d.rate, centi: d.centi })),
      ...[...w.adjustments].sort((a, b) => (a.day < b.day ? 1 : -1))
        .map((a) => ({ kind: 'adjust' as const, key: `${a.day}/${a.txn_id}`, day: md(a.day), balance: a.balance, centi: a.centi })),
    ];
    const settled = [...w.days, ...w.adjustments].find((r) => r.settled_txn && paid.has(r.settled_txn));
    return {
      monday, title: weekTitle(monday, thisWeek), rows,
      total: rows.reduce((s, r) => s + r.centi, 0),
      paid: settled ? paid.get(settled.settled_txn!)!.amount : null,
    };
  });
}

// How 攒着的利息 (interest_profile's pending_centi) adds up: this week's days, the corrections not yet paid in (null when
// there are none) and what is left, the odd cents of the last 利息 and interest still under 1 HTB; all in 0.01 HTB.
export function pendingParts(pending: number, days: Accrual[], adjustments: Adjustment[], thisWeek: string) {
  const week = days.filter((d) => d.day >= thisWeek).reduce((s, d) => s + d.centi, 0);
  const open = adjustments.filter((a) => !a.settled_txn);
  const corrections = open.length ? open.reduce((s, a) => s + a.centi, 0) : null;
  return { week, corrections, carry: pending - week - (corrections ?? 0) };
}
