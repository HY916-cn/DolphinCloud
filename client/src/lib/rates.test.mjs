// node src/lib/rates.test.mjs — the 罚息 and the examples against PHASE-2.md §9.2, and the checks on an edited 利率 group.
import assert from 'node:assert/strict';
const { ANCHOR_ORDER, ANCHOR_RANGE, maturityCenti, pendingNote, penaltyRate, rateDraft, rateProblems, rateValues, weekCenti } = await import('./rates.ts');

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

// 罚息 = 贷款利率 × 1.5, rounding once: 6.2667 × 1.5 = 9.40005 → 9.4001; the widest values stay exact.
assert.equal(penaltyRate(6.2667, 1.5), 9.4001);
assert.equal(penaltyRate(7.05, 1.5), 10.575);
assert.equal(penaltyRate(10_000, 10), 100_000);

// The defaults pass and save unchanged; only the three typed values change, the other keys stay as read.
const anchor = { initial: 2, ratio_target: 30, ratio_step: 10, growth_target: 2, growth_step: 1, weight: 0.25, max_adjust: 0.5, min: 1, max: 4 };
const d = rateDraft(anchor);
assert.deepEqual(d, { initial: '2', min: '1', max: '4' });
assert.deepEqual(rateProblems(d), {});
assert.deepEqual(rateValues(d, anchor), anchor);
assert.deepEqual(rateValues({ initial: '2.5', min: '1.25', max: '5' }, anchor), { ...anchor, initial: 2.5, min: 1.25, max: 5 });
// Each range, then the bounds against the start, marked on every value not already wrong.
assert.deepEqual(rateProblems({ ...d, initial: '2.005' }), { initial: ANCHOR_RANGE });
assert.deepEqual(rateProblems({ ...d, initial: '0' }), { initial: ANCHOR_RANGE });
assert.deepEqual(rateProblems({ ...d, max: '100.01' }), { max: ANCHOR_RANGE });
assert.deepEqual(rateProblems({ ...d, min: '' }), { min: ANCHOR_RANGE });
assert.deepEqual(rateProblems({ ...d, initial: '5' }), { min: ANCHOR_ORDER, initial: ANCHOR_ORDER, max: ANCHOR_ORDER });
assert.deepEqual(rateProblems({ ...d, min: '0', initial: '5' }), { min: ANCHOR_RANGE, initial: ANCHOR_ORDER, max: ANCHOR_ORDER });
assert.deepEqual(rateProblems({ initial: '0.01', min: '0.01', max: '100' }), {});
assert.equal(pendingNote(37), '满 1 HTB 再存进余额');
assert.equal(pendingNote(99), '满 1 HTB 再存进余额');
assert.equal(pendingNote(100), '下周一存进余额');
console.log('rates ok');
