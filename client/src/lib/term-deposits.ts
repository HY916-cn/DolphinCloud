// lib/format's and lib/term's writing, copied so this file loads on its own, as the unit tests load it: 1,280; 0.37; 3.12%;
// 2026-12-10 → 12月10日.
const formatAmount = (n: number) => Math.abs(n).toLocaleString('en-US');
const formatCenti = (c: number) => `${formatAmount(Math.trunc(c / 100))}.${String(c % 100).padStart(2, '0')}`;
const formatRate = (r: number) => `${Number(r.toFixed(4))}%`;
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;

// 定期 (PHASE-2.md §9.5, §10.2; design system TermDeposit): a term_deposits row, the counter's term_quote, and how the
// counter panel and 我的定期 write them. Dates are YYYY-MM-DD and compare as strings.
export type TermDeposit = {
  id: string; student_no: string; principal: number; weeks: number; rate: number; opened_on: string; matures_on: string;
  status: 'open' | 'matured' | 'early' | 'reversed'; open_txn: string; close_txn: string | null;
  interest_centi: number | null; expected_centi: number;
};
export type TermOption = { weeks: number; rate: number; matures_on: string };
export type TermQuote = {
  student_no: string; score: number | null; term: { id: string; name: string; ends_on: string } | null;
  options: TermOption[]; balance: number; term_total: number; deposits: TermDeposit[];
};

// 到期利息 in 0.01 HTB, in whole numbers as maturity pays it (expected_centi): ⌊金额 × round(周利率 × 10000) × 周数 ÷ 10000⌋.
export const termInterestCenti = (amount: number, rate: number, weeks: number) =>
  Math.floor((amount * Math.round(rate * 10_000) * weeks) / 10_000);

// The amount field's hint: the range before an amount, the shortfall over 活期, then what comes back at maturity.
export function amountHint(amount: number, balance: number, option: TermOption | undefined): { text: string; error: boolean } {
  if (!amount) return { text: `1 HTB 起，最多 ${formatAmount(balance)} HTB（活期余额）`, error: false };
  if (amount > balance) return { text: `余额不足：活期余额 ${formatAmount(balance)} HTB，还差 ${formatAmount(amount - balance)} HTB`, error: true };
  if (!option) return { text: '选好存期后显示到期拿回多少', error: false };
  return { text: `到期拿回 ${backCenti(amount, option)} HTB · ${formatRate(option.rate)}/周`, error: false };
}

// 112.48: the principal and its interest at maturity.
export const backCenti = (amount: number, o: Pick<TermOption, 'rate' | 'weeks'>) => formatCenti(amount * 100 + termInterestCenti(amount, o.rate, o.weeks));

// One line of a 定期 list: the sentence before the bold amount, the amount, the small line, the status tag, and
// whether 提前支取 is offered (open and not past its maturity day). Reversed ones are not listed (shownDeposits).
export function depositLine(d: TermDeposit, today: string) {
  const lead = `定期 ${d.weeks} 周存 ${formatAmount(d.principal)} HTB，`;
  const rate = `${formatRate(d.rate)}/周`;
  if (d.status === 'early') {
    return { lead: `${lead}提前取出，利息 `, amount: `${formatCenti(d.interest_centi ?? 0)} HTB`,
      note: `原定 ${monthDay(d.matures_on)} 到期 · 只按活期算利息`, tag: 'early' as const, canWithdraw: false };
  }
  return { lead: `${lead}到期拿回 `, amount: `${formatCenti(d.principal * 100 + d.expected_centi)} HTB`,
    note: d.status === 'matured' ? `${monthDay(d.matures_on)} 已转回活期 · ${rate}` : `${monthDay(d.matures_on)} 到期 · ${rate}`,
    tag: d.status === 'matured' ? 'matured' as const : 'open' as const, canWithdraw: d.status === 'open' && today <= d.matures_on };
}

// The 定期 a list shows: not the reversed ones, latest opened first.
export const shownDeposits = (list: TermDeposit[]) =>
  list.filter((d) => d.status !== 'reversed').sort((a, b) => (a.opened_on < b.opened_on ? 1 : a.opened_on > b.opened_on ? -1 : 0));

// The 存期中 定期 that matures first, as the 存折's 定期合计 notes it: "12月10日 到期"; null with none.
export function nextMaturity(list: Pick<TermDeposit, 'status' | 'matures_on'>[]) {
  const day = list.filter((d) => d.status === 'open').map((d) => d.matures_on).sort()[0];
  return day ? `${monthDay(day)} 到期` : null;
}

// 存入 and 支出 of some transactions (spent is negative): the ones of a 定期 (term_id: 开定期, 定期转回 and their 冲正) move
// the student's own money between 活期 and 定期, and the ones of a 贷款 (loan_id: 放款, 还款 and their 冲正) are borrowing and
// paying back; they count as neither, and `moved` is their change to 活期.
export function flows(rows: { balance_delta: number; term_id: string | null; loan_id?: string | null }[]) {
  let saved = 0, spent = 0, moved = 0;
  for (const r of rows) {
    if (r.term_id || r.loan_id) moved += r.balance_delta;
    else if (r.balance_delta > 0) saved += r.balance_delta;
    else spent += r.balance_delta;
  }
  return { saved, spent, moved };
}
