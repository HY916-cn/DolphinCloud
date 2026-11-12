// node src/lib/rates.test.mjs — the rates against PHASE-2.md §9.2 and rate_overview, and the checks on an edited 利率 group.
import assert from 'node:assert/strict';
const { ANCHOR_ORDER, maturityCenti, penaltyRate, previewScores, rateDraft, rateProblems, ratesAt, rateValues, weekCenti } = await import('./rates.ts');

// The examples on 100 HTB, in 0.01 HTB: rounded half up for a week, truncated at maturity.
assert.equal(weekCenti(2.08), 208);
assert.equal(weekCenti(6.2667), 627);
assert.equal(weekCenti(2.125), 213);
assert.equal(weekCenti(2.1249), 212);
assert.equal(weekCenti(1.005), 101);
assert.equal(weekCenti(0.0049), 0);
assert.equal(maturityCenti(4.16, 8), 13_328);
assert.equal(maturityCenti(2.6, 2), 10_520);
assert.equal(maturityCenti(3.12, 4), 11_248);
assert.equal(maturityCenti(6.2667, 8), 15_013);
assert.equal(maturityCenti(3.1255, 4), 11_250);
assert.equal(maturityCenti(1.0049, 2), 10_200);
assert.equal(maturityCenti(4.19, 8), 13_352);

const curve = { min_score: 400, limit_min: 50, limit_max: 300, limit_step: 5, loan_max: 1.8, loan_min: 1.1, saving_min: 0.8, saving_max: 1.2 };
const m = { term: { 2: 1.25, 4: 1.5, 8: 2 }, loan: 2, penalty: 1.5 };

// rate_overview() at anchor 2 (§9.2's table, 4 decimals).
const table = {
  0: [1.6, 2, 2.4, 3.2, null], 400: [1.92, 2.4, 2.88, 3.84, 7.2], 600: [2.08, 2.6, 3.12, 4.16, 6.2667],
  750: [2.2, 2.75, 3.3, 4.4, 5.5667], 900: [2.32, 2.9, 3.48, 4.64, 4.8667], 1000: [2.4, 3, 3.6, 4.8, 4.4],
};
for (const [score, want] of Object.entries(table)) {
  const r = ratesAt(2, Number(score), curve, m);
  assert.deepEqual([r.current, r.term[2], r.term[4], r.term[8], r.loan], want, `score ${score}`);
}
assert.equal(ratesAt(2, 399, curve, m).loan, null);
assert.equal(ratesAt(2, 399, curve, m).penalty, null);
// 罚息 = 贷款利率 × 1.5, rounding once: 6.2667 × 1.5 = 9.40005 → 9.4001.
assert.equal(penaltyRate(6.2667, 1.5), 9.4001);
assert.equal(ratesAt(2, 600, curve, m).penalty, 9.4001);
assert.equal(ratesAt(2.25, 600, curve, m).current, 2.34);
// The widest values set_setting allows stay exact.
assert.equal(ratesAt(100, 1000, { ...curve, saving_max: 10, loan_min: 10, loan_max: 10 }, { term: { 2: 10, 4: 10, 8: 10 }, loan: 10, penalty: 10 }).penalty, 100000);

assert.deepEqual(previewScores(curve), [0, 400, 600, 1000]);
assert.deepEqual(previewScores({ ...curve, min_score: 600 }), [0, 600, 1000]);

// The defaults pass; each range and the bounds are checked as set_setting checks them.
const anchor = { initial: 2, ratio_target: 30, ratio_step: 10, growth_target: 2, growth_step: 1, weight: 0.25, max_adjust: 0.5, min: 1, max: 4 };
const d = rateDraft(anchor, m);
assert.deepEqual(rateProblems(d), {});
assert.deepEqual(rateValues(d).anchor_params, anchor);
assert.deepEqual(rateValues(d).multipliers, m);
assert.deepEqual(rateProblems({ ...d, initial: '2.005' }), { initial: '请输入 0.01 到 100 的数，最多 2 位小数' });
assert.deepEqual(rateProblems({ ...d, initial: '0' }), { initial: '请输入 0.01 到 100 的数，最多 2 位小数' });
assert.deepEqual(rateProblems({ ...d, initial: '5' }), { min: ANCHOR_ORDER, initial: ANCHOR_ORDER, max: ANCHOR_ORDER });
assert.deepEqual(rateProblems({ ...d, growth_target: '−5' }), {});
assert.equal(rateValues({ ...d, growth_target: '−5' }).anchor_params.growth_target, -5);
assert.deepEqual(rateProblems({ ...d, growth_target: '-100.5' }), { growth_target: '请输入 −100 到 100 的数，最多 4 位小数' });
assert.deepEqual(rateProblems({ ...d, ratio_step: '0' }), { ratio_step: '请输入 0.01 到 100 的数，最多 4 位小数' });
assert.deepEqual(rateProblems({ ...d, weight: '10.5' }), { weight: '请输入 0 到 10 的数，最多 4 位小数' });
assert.deepEqual(rateProblems({ ...d, weight: '0.12345' }), { weight: '请输入 0 到 10 的数，最多 4 位小数' });
assert.deepEqual(rateProblems({ ...d, term_8: '11' }), { term_8: '请输入 0.1 到 10 的数，最多 4 位小数' });
assert.deepEqual(rateProblems({ ...d, loan: '' }), { loan: '请输入 0.1 到 10 的数，最多 4 位小数' });
assert.deepEqual(rateProblems({ ...d, penalty: '0.9' }), { penalty: '请输入 1 到 10 的数，最多 4 位小数' });
console.log('rates ok');
