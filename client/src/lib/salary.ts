import type { Role } from './session';

// 工资标准 (PHASE-1.md §5.2, PHASE-2.md §16.2): pay per identity and shift. Tellers, accountants, storekeepers and
// presidents are counted, not the bank admin or the sysadmin; a shift is paid at the rate of the identity it was
// signed under (attendance.role). Kept apart from lib/attendance so the unit tests load it on its own.
export type Shift = 'am' | 'pm';
export type PaidRole = Exclude<Role, 'teacher' | 'sysadmin'>;
export type Rates = Record<PaidRole, Record<Shift, number>>;
type Counted = { role: PaidRole; shift: Shift; status: string; pay?: number | null };

// The rows of the 工资标准 table and the groups of the 考勤 page, in this order.
export const PAID_ROLES: PaidRole[] = ['teller', 'accountant', 'storekeeper', 'president'];
export const SALARY_RANGE = { min: 1, max: 10_000 };

// The salary_rates rows as one table; null while any identity or shift is missing (nothing is paid on a guess).
export function ratesOf(rows: { role: string; shift: string; amount: number }[]): Rates | null {
  const rates = Object.fromEntries(PAID_ROLES.map((r) => [r, {}])) as Record<PaidRole, Partial<Record<Shift, number>>>;
  for (const row of rows) if (row.role in rates) rates[row.role as PaidRole][row.shift as Shift] = row.amount;
  return PAID_ROLES.every((r) => rates[r].am != null && rates[r].pm != null) ? rates as Rates : null;
}

// The state a shift shows: 已作废 once voided (voided_at, PHASE-1.md §6.9), else its status; a rejected one never
// voided was not passed at review (未通过).
export const shiftState = <S extends string>(row: { status: S; voided_at: string | null }): S | 'void' => (row.voided_at ? 'void' : row.status);

// What confirmed shifts pay: their own pay once paid, the current rate of their identity and kind until then.
export const earned = (rows: Counted[], rates: Rates) =>
  rows.filter((r) => r.status === 'confirmed').reduce((s, r) => s + (r.pay ?? rates[r.role][r.shift]), 0);

// One person's confirmed shifts as a payout counts them: 中午班 and 下午班, and the amount.
export const tally = (rows: Counted[], rates: Rates) => {
  const confirmed = rows.filter((r) => r.status === 'confirmed');
  return { am: confirmed.filter((r) => r.shift === 'am').length, pm: confirmed.filter((r) => r.shift === 'pm').length, amount: earned(confirmed, rates) };
};

// Whose shifts a president or the bank admin signs in from the 考勤 table and voids (作废): anyone counted but
// themselves, and a president's only by the bank admin.
export const maySign = (mine: Role | undefined, theirs: Role | null | undefined, self: boolean) =>
  !self && !!theirs && (PAID_ROLES as Role[]).includes(theirs) && (mine === 'teacher' || (mine === 'president' && theirs !== 'president'));

// The 工资标准 as typed: a cell's problem, if any, and the table set_salary_rates takes once every cell is right.
export type RatesDraft = Record<PaidRole, Record<Shift, string>>;
export const ratesDraft = (rates: Rates): RatesDraft =>
  Object.fromEntries(PAID_ROLES.map((r) => [r, { am: String(rates[r].am), pm: String(rates[r].pm) }])) as RatesDraft;
export const rateWrong = (v: string) =>
  !/^\d+$/.test(v) || Number(v) < SALARY_RANGE.min || Number(v) > SALARY_RANGE.max;
export const ratesValue = (draft: RatesDraft): Rates | null =>
  PAID_ROLES.some((r) => rateWrong(draft[r].am) || rateWrong(draft[r].pm)) ? null
    : Object.fromEntries(PAID_ROLES.map((r) => [r, { am: Number(draft[r].am), pm: Number(draft[r].pm) }])) as Rates;
