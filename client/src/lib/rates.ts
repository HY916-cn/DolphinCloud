import type { Curve } from './credit';

// 利率 (PHASE-2.md §9.2): weekly percentages from the week's anchor and a score, as the database makes them
// (app_private.saving_rate, term_rate, loan_rate, penalty_rate), for the 参数 page's preview of values being edited and
// the 罚息 column of 利率; and the checks set_setting makes on anchor_params, term_multipliers, loan_multiplier and
// penalty_multiplier (§14.3), so a wrong value is marked before anything is sent.

export type AnchorParams = Record<(typeof ANCHOR)[number]['key'], number>;
export type Multipliers = { term: Record<Weeks, number>; loan: number; penalty: number };
export type Weeks = '2' | '4' | '8';
export const WEEKS: Weeks[] = ['2', '4', '8'];

// Every value in ten-thousandths and the sums in BigInt, so a rate rounds once, exactly, as SQL's numeric does.
const e4 = (x: number) => BigInt(Math.round(x * 10_000));
const TEN = (n: number) => 10n ** BigInt(n);
// numerator / denominator (both positive) to 4 decimals, half away from zero as SQL's round(…, 4).
const round4 = (n: bigint, d: bigint) => Number((2n * n * TEN(4) + d) / (2n * d)) / 10_000;

export const penaltyRate = (loan: number, penalty: number) => round4(e4(loan) * e4(penalty), TEN(8));

// The rates a score gets under an anchor, with the curve's factors unrounded (the 储蓄系数 from saving_min at 0 to
// saving_max at 1000, the 贷款系数 from loan_max at min_score to loan_min at 1000); no loan below min_score.
export function ratesAt(anchor: number, score: number, c: Curve, m: Multipliers) {
  const a = e4(anchor);
  const s = e4(c.saving_min) * 1000n + BigInt(score) * (e4(c.saving_max) - e4(c.saving_min)); // 储蓄系数 × 10^7
  const term = Object.fromEntries(WEEKS.map((w) => [w, round4(a * e4(m.term[w]) * s, TEN(15))])) as Record<Weeks, number>;
  let loan: number | null = null;
  if (score >= c.min_score) {
    const d = BigInt(1000 - c.min_score);
    const l = e4(c.loan_max) * d - BigInt(score - c.min_score) * (e4(c.loan_max) - e4(c.loan_min)); // 贷款系数 × 10^4 × d
    loan = round4(a * e4(m.loan) * l, TEN(12) * d);
  }
  return { current: round4(a * s, TEN(11)), term, loan, penalty: loan === null ? null : penaltyRate(loan, m.penalty) };
}

// anchor_params in the order the 参数 page shows them, with set_setting's range of each.
export const ANCHOR = [
  { key: 'initial', min: 0.01, max: 100, cents: true },
  { key: 'min', min: 0.01, max: 100, cents: true },
  { key: 'max', min: 0.01, max: 100, cents: true },
  { key: 'ratio_target', min: 0, max: 100 },
  { key: 'ratio_step', min: 0.01, max: 100 },
  { key: 'growth_target', min: -100, max: 100 },
  { key: 'growth_step', min: 0.01, max: 100 },
  { key: 'weight', min: 0, max: 10 },
  { key: 'max_adjust', min: 0, max: 100 },
] as const;
export const ANCHOR_ORDER = '要满足：下限 ≤ 初始锚点 ≤ 上限';

// The 利率 group as the page edits it: each value as typed.
export type RateDraft = Record<keyof AnchorParams | `term_${Weeks}` | 'loan' | 'penalty', string>;
export const rateDraft = (a: AnchorParams, m: Multipliers): RateDraft => ({
  ...(Object.fromEntries(ANCHOR.map(({ key }) => [key, String(a[key])])) as Record<keyof AnchorParams, string>),
  term_2: String(m.term['2']), term_4: String(m.term['4']), term_8: String(m.term['8']), loan: String(m.loan), penalty: String(m.penalty),
});
const num = (v: string) => Number(v.replace('−', '-'));
export const rateValues = (d: RateDraft) => ({
  anchor_params: Object.fromEntries(ANCHOR.map(({ key }) => [key, num(d[key])])) as AnchorParams,
  multipliers: { term: { '2': num(d.term_2), '4': num(d.term_4), '8': num(d.term_8) }, loan: num(d.loan), penalty: num(d.penalty) } as Multipliers,
});

const typed = (v: string, decimals: number) => new RegExp(`^[-−]?\\d+(\\.\\d{1,${decimals}})?$`).test(v);
const range = (min: number, max: number) => `${min < 0 ? `−${-min}` : min} 到 ${max}`;

// What is wrong with each value of the group being edited (set_setting's checks): its range first, then the anchor's
// bounds against the start. An empty result means the group can be saved.
export function rateProblems(d: RateDraft) {
  const p: Partial<Record<keyof RateDraft, string>> = {};
  for (const r of ANCHOR) {
    const cents = 'cents' in r;
    if (!typed(d[r.key], cents ? 2 : 4) || num(d[r.key]) < r.min || num(d[r.key]) > r.max) {
      p[r.key] = `请输入 ${range(r.min, r.max)} 的数，最多 ${cents ? 2 : 4} 位小数`;
    }
  }
  const factor = (k: keyof RateDraft, min: number) => {
    if (!typed(d[k], 4) || num(d[k]) < min || num(d[k]) > 10) p[k] = `请输入 ${min} 到 10 的数，最多 4 位小数`;
  };
  (['term_2', 'term_4', 'term_8', 'loan'] as const).forEach((k) => factor(k, 0.1));
  factor('penalty', 1);
  const n = (k: keyof RateDraft) => (p[k] ? NaN : num(d[k]));
  if (n('min') > n('initial') || n('initial') > n('max') || n('min') > n('max')) {
    (['min', 'initial', 'max'] as const).forEach((k) => { p[k] ??= ANCHOR_ORDER; });
  }
  return p;
}

// The 参数 page's preview: 0, the lowest score to borrow, 600 and 1000 under this week's anchor.
export const previewScores = (c: Curve) => [...new Set([0, c.min_score, 600, 1000])].sort((a, b) => a - b);
