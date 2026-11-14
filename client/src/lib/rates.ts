// 利率 (PHASE-2.md §9.2): the 罚息 a loan rate gives, as the database makes it (app_private.penalty_rate), for the
// 罚息 column of 利率; the student's examples on 100 HTB; and the checks set_setting makes on the three anchor_params
// and the term_rates the 参数 page edits (§14.3), so a wrong value is marked before anything is sent.

export type AnchorParams = Record<
  'initial' | 'min' | 'max' | 'ratio_target' | 'ratio_step' | 'growth_target' | 'growth_step' | 'weight' | 'max_adjust', number>;
// term_rates (PHASE-2.md §14.3): the fixed weekly rate of each 定期 length, keyed by its weeks ("2", "4", "12", …).
export type TermRates = Record<string, number>;
// [weeks, value] of an object keyed by weeks, shortest first.
export const byWeeks = <T>(r: Record<string, T>) => Object.entries(r).map(([w, v]) => [Number(w), v] as const).sort((a, b) => a[0] - b[0]);

// Every value in ten-thousandths and the product in BigInt, so a rate rounds once, exactly, as SQL's numeric does.
const e4 = (x: number) => BigInt(Math.round(x * 10_000));
// numerator / denominator (both positive) to 4 decimals, half away from zero as SQL's round(…, 4).
const round4 = (n: bigint, d: bigint) => Number((2n * n * 10_000n + d) / (2n * d)) / 10_000;

export const penaltyRate = (loan: number, penalty: number) => round4(e4(loan) * e4(penalty), 10n ** 8n);

// The student's examples on 100 HTB (design system StudentCreditPage 本周利率), in 0.01 HTB from the rate in
// ten-thousandths of a percent, in integers (4.16 × 8 is 33.28, not 33.279…): a week's 活期 interest or loan interest,
// rounded half up; what a 定期 of `weeks` pays back, the interest truncated as at maturity (PHASE-2.md §9.5).
export const weekCenti = (rate: number) => Math.round(Math.round(rate * 10_000) / 100);
export const maturityCenti = (rate: number, weeks: number) => 10_000 + Math.floor((Math.round(rate * 10_000) * weeks) / 100);

// When 攒着的利息 (interest_profile's pending_centi) is paid in: each Monday, the whole HTB of it.
export const pendingNote = (centi: number) => (centi >= 100 ? '下周一存进余额' : '满 1 HTB 再存进余额');

// The anchor_params the 参数 page edits, in its order; set_setting takes each from 0.01 to 100 with 2 decimals and
// refuses any change to the other keys.
const EDITABLE = ['initial', 'min', 'max'] as const;
export const ANCHOR_RANGE = '请输入 0.01 到 100 的数，最多 2 位小数';
export const ANCHOR_ORDER = '要满足：下限 ≤ 初始锚点 ≤ 上限';

const outsideRange = (v: string) => !/^\d+(\.\d{1,2})?$/.test(v) || Number(v) < 0.01 || Number(v) > 100;

// The 利率 group as the page edits it: each value as typed.
export type RateDraft = Record<(typeof EDITABLE)[number], string>;
export const rateDraft = (a: AnchorParams): RateDraft => ({ initial: String(a.initial), min: String(a.min), max: String(a.max) });
// The whole anchor_params set_setting takes: the three as typed, the others as read.
export const rateValues = (d: RateDraft, saved: AnchorParams): AnchorParams =>
  ({ ...saved, initial: Number(d.initial), min: Number(d.min), max: Number(d.max) });

// What is wrong with each value being edited: its range first, then the bounds against the start. An empty result
// means the group can be saved.
export function rateProblems(d: RateDraft) {
  const p: Partial<RateDraft> = {};
  for (const k of EDITABLE) if (outsideRange(d[k])) p[k] = ANCHOR_RANGE;
  const n = (k: keyof RateDraft) => (p[k] ? NaN : Number(d[k]));
  if (n('min') > n('initial') || n('initial') > n('max') || n('min') > n('max')) EDITABLE.forEach((k) => { p[k] ??= ANCHOR_ORDER; });
  return p;
}

// 定期周利率 as the page edits it, each length's rate as typed, and the whole term_rates set_setting takes. Each is
// marked with ANCHOR_RANGE when out of range; an empty result means it can be saved.
export const termDraft = (t: TermRates): Record<string, string> => Object.fromEntries(Object.entries(t).map(([w, r]) => [w, String(r)]));
export const termValues = (d: Record<string, string>): TermRates => Object.fromEntries(Object.entries(d).map(([w, r]) => [w, Number(r)]));
export const termProblems = (d: Record<string, string>) =>
  Object.fromEntries(Object.entries(d).filter(([, v]) => outsideRange(v)).map(([w]) => [w, ANCHOR_RANGE])) as Record<string, string>;
