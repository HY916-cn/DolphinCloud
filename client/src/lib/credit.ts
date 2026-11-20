// 海豚信用分 (PHASE-2.md §8): the curve's sums as the database makes them (app_private.credit_limit, credit_next,
// loan_factor), for the 参数 page's preview of a curve being edited, and the checks set_setting makes on
// credit_curve and credit_rules (§14.3), so a wrong value is marked before anything is sent.

export type Curve = {
  min_score: number; limit_min: number; limit_max: number; limit_step: number;
  loan_max: number; loan_min: number;
};
export type CreditProfile = {
  student_no?: string; score: number; loan_limit: number | null; points_to_next: number | null;
  loan_factor: number | null;
};

// Integer division, rounding toward zero as SQL's integer `/` does.
const div = (a: number, b: number) => (a - (a % b)) / b;
// A factor with up to 4 decimals in ten-thousandths, so the sums below stay whole numbers.
const e4 = (x: number) => Math.round(x * 10_000);
// numerator / denominator (both positive) to 4 decimals, half away from zero as SQL's round(…, 4), back as a number.
const round4 = (n: number, d: number) => div(2 * n + d, 2 * d) / 10_000;

// 单笔贷款额度: from limit_min at min_score to limit_max at 1000, down to a multiple of limit_step, in integers so a
// limit right on a multiple keeps it; null below min_score.
export function creditLimit(c: Curve, score: number) {
  if (score < c.min_score) return null;
  const d = 1000 - c.min_score;
  return div(c.limit_min * d + (score - c.min_score) * (c.limit_max - c.limit_min), d * c.limit_step) * c.limit_step;
}

// 「再涨 N 分，额度加 5 HTB」: the fewest points that raise the limit by a step; null below min_score and at the top.
export function creditNext(c: Curve, score: number) {
  const l = creditLimit(c, score);
  if (l === null || l >= creditLimit(c, 1000)!) return null;
  const r = c.limit_max - c.limit_min;
  return c.min_score + div((l + c.limit_step - c.limit_min) * (1000 - c.min_score) + r - 1, r) - score;
}

// 贷款系数 from loan_max at min_score to loan_min at 1000; null below min_score.
export function loanFactor(c: Curve, score: number) {
  if (score < c.min_score) return null;
  const d = 1000 - c.min_score;
  return round4(e4(c.loan_max) * d - (score - c.min_score) * (e4(c.loan_max) - e4(c.loan_min)), d);
}

// The 参数 page's preview: what 400, 600, 800 and 1000 points give under the curve being edited.
export const PREVIEW_SCORES = [400, 600, 800, 1000];
export const preview = (c: Curve) =>
  PREVIEW_SCORES.map((score) => ({ score, limit: creditLimit(c, score), loan: loanFactor(c, score) }));

// The curve as the page edits it: each value as typed. Every key read is kept, so one the page no longer shows (until
// the backend drops it) goes back to set_setting as it came.
export type CurveDraft = Record<keyof Curve, string>;
export const curveDraft = (c: Curve) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v)])) as CurveDraft;

const whole = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
const factor = (v: string) => /^\d+(\.\d{1,4})?$/.test(v) && Number(v) >= 0.1 && Number(v) <= 10;
export const LIMIT_ORDER = '要满足：取整单位 ≤ 最低分时的额度 ≤ 1000 分时的额度';
export const LOAN_ORDER = '1000 分时的贷款系数不能大于最低分时的';

// What is wrong with each value of a curve being edited (set_setting's checks): its range first, then how it stands
// against the others. An empty result means the curve can be saved.
export function curveProblems(d: CurveDraft) {
  const p: Partial<Record<keyof Curve, string>> = {};
  if (!whole(d.min_score, 0, 999)) p.min_score = '请输入 0 到 999 的整数';
  for (const k of ['limit_min', 'limit_max', 'limit_step'] as const) if (!whole(d[k], 1, 10_000)) p[k] = '请输入 1 到 10000 的整数';
  for (const k of ['loan_max', 'loan_min'] as const) if (!factor(d[k])) p[k] = '请输入 0.1 到 10 的数，最多 4 位小数';
  const n = (k: keyof Curve) => (p[k] ? NaN : Number(d[k]));
  const mark = (keys: (keyof Curve)[], text: string) => keys.forEach((k) => { p[k] ??= text; });
  if (n('limit_step') > n('limit_min')) mark(['limit_step', 'limit_min'], LIMIT_ORDER);
  if (n('limit_min') > n('limit_max')) mark(['limit_min', 'limit_max'], LIMIT_ORDER);
  if (n('loan_min') > n('loan_max')) mark(['loan_max', 'loan_min'], LOAN_ORDER);
  return p;
}

// The rules of §8.2 in its order: what earns or costs the points, when they are counted, and whether they are lost.
export const RULES = [
  { key: 'repay_on_time', event: '按时还清一期', when: '还清那一期时', loss: false },
  { key: 'repay_early', event: '提前还清一笔贷款（放款满 7 天后）', when: '结清时', loss: false },
  { key: 'overdue', event: '逾期（应还日结束仍未还清）', when: '逾期当天结束时', loss: true },
  { key: 'overdue_week', event: '逾期后仍未还清，每满一周', when: '每周一', loss: true },
  { key: 'deposit_week', event: '上周有存款', when: '每周一', loss: false },
  { key: 'deposit_streak', event: '连续 4 周都有存款', when: '每周一（第 4、8、12……周）', loss: false },
  { key: 'withdraw_half', event: '上周取款合计超过上周初余额的一半', when: '每周一', loss: true },
  { key: 'account_age', event: '开户每满 4 周', when: '每周一', loss: false },
  { key: 'balance_100', event: '上周日均余额 100 HTB 以上', when: '每周一', loss: false },
  { key: 'balance_300', event: '上周日均余额 300 HTB 以上', when: '每周一', loss: false },
] as const;
export type Rules = Record<(typeof RULES)[number]['key'], number>;

// The rules as the page shows them, unsigned, and back as credit_rules keeps them: a loss is negative. 0 stays 0.
export const rulesDraft = (r: Rules) => Object.fromEntries(RULES.map(({ key }) => [key, String(Math.abs(r[key]))])) as Record<keyof Rules, string>;
export const rulesValue = (d: Record<keyof Rules, string>) =>
  Object.fromEntries(RULES.map(({ key, loss }) => [key, loss && Number(d[key]) ? -Number(d[key]) : Number(d[key])])) as Rules;
export const ruleProblem = (v: string) => (whole(v, 0, 100) ? undefined : '请输入 0 到 100 的整数');

// 信用分开关 (PHASE-2.md §8.5): what set_credit_enabled answers, and the Toast it gets.
export type CreditSwitchResult = { enabled: boolean; changed: boolean; students: number };
export const switchToast = (r: CreditSwitchResult) =>
  !r.changed ? '信用分本来就是这个状态'
  : r.enabled ? `已重新开启，${r.students} 位学生恢复原来的分数` : `已暂停，${r.students} 位学生按 600 分计`;
