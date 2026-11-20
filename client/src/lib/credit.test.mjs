// node src/lib/credit.test.mjs — the curve's sums against PHASE-2.md §8.1, and the checks on an edited curve.
import assert from 'node:assert/strict';
const { creditLimit, creditNext, curveDraft, curveProblems, LIMIT_ORDER, LOAN_ORDER, loanFactor, preview, rulesDraft, rulesValue, switchToast } = await import('./credit.ts');

const curve = { min_score: 400, limit_min: 50, limit_max: 300, limit_step: 5, loan_max: 1.8, loan_min: 1.1 };
const at = (s) => [creditLimit(curve, s), loanFactor(curve, s), creditNext(curve, s)];

// The table of §8.1.
assert.deepEqual(at(0), [null, null, null]);
assert.deepEqual(at(399), [null, null, null]);
assert.deepEqual(at(400), [50, 1.8, 12]);
assert.deepEqual(at(600), [130, 1.5667, 4]);
assert.deepEqual(at(750), [195, 1.3917, 10]); // 200 HTB from 760
assert.deepEqual(at(900), [255, 1.2167, 4]); // 260 HTB from 904
assert.deepEqual(at(1000), [300, 1.1, null]);
assert.equal(creditLimit(curve, 604), 135);
assert.equal(creditLimit(curve, 603), 130);

// A limit right on a multiple of the step keeps it: at 412 points 50 + 12 × 250 / 600 = 55 exactly.
assert.equal(creditLimit(curve, 412), 55);
assert.equal(creditLimit(curve, 411), 50);
// Where floating point loses a step: 30 + 726 / 990 × 300 is 250 exactly, but (726 / 990) × 300 comes to 249.99….
const edge = { ...curve, min_score: 10, limit_min: 30, limit_max: 330, limit_step: 10 };
assert.equal(Math.floor((30 + (736 - 10) / 990 * 300) / 10) * 10, 240);
assert.equal(creditLimit(edge, 736), 250);
assert.equal(creditLimit(edge, 735), 240);

// Every score: the limit never drops, and the next step is reached in exactly 「再涨 N 分」.
for (let s = 400; s < 1000; s++) {
  const n = creditNext(curve, s);
  if (n === null) { assert.equal(creditLimit(curve, s), 300); continue; }
  assert.equal(creditLimit(curve, s + n), creditLimit(curve, s) + 5, `score ${s}`);
  assert.equal(creditLimit(curve, s + n - 1), creditLimit(curve, s), `score ${s}`);
}

assert.deepEqual(preview(curve), [
  { score: 400, limit: 50, loan: 1.8 },
  { score: 600, limit: 130, loan: 1.5667 },
  { score: 800, limit: 215, loan: 1.3333 },
  { score: 1000, limit: 300, loan: 1.1 },
]);
// Below a raised minimum: no loan.
assert.deepEqual(preview({ ...curve, min_score: 500 })[0], { score: 400, limit: null, loan: null });

// Checks.
assert.deepEqual(curveProblems(curveDraft(curve)), {});
assert.deepEqual(Object.keys(curveProblems({ ...curveDraft(curve), min_score: '1000' })), ['min_score']);
assert.deepEqual(Object.keys(curveProblems({ ...curveDraft(curve), limit_max: '' })), ['limit_max']);
assert.deepEqual(curveProblems({ ...curveDraft(curve), limit_step: '60' }), { limit_step: LIMIT_ORDER, limit_min: LIMIT_ORDER });
assert.deepEqual(curveProblems({ ...curveDraft(curve), limit_max: '40' }), { limit_min: LIMIT_ORDER, limit_max: LIMIT_ORDER });
assert.deepEqual(curveProblems({ ...curveDraft(curve), loan_min: '2' }), { loan_max: LOAN_ORDER, loan_min: LOAN_ORDER });
assert.deepEqual(Object.keys(curveProblems({ ...curveDraft(curve), loan_min: '1.23456' })), ['loan_min']);
assert.deepEqual(Object.keys(curveProblems({ ...curveDraft(curve), loan_max: '0.05' })), ['loan_max']);
// A key the page no longer shows goes back as it came.
assert.deepEqual(curveDraft({ ...curve, saving_min: 0.8, saving_max: 1.2 }).saving_min, '0.8');
assert.deepEqual(curveProblems({ ...curveDraft(curve), loan_max: '10', loan_min: '0.1' }), {});

// Rules: shown unsigned, saved with losses negative.
const rules = { repay_on_time: 5, repay_early: 10, overdue: -50, overdue_week: -30, deposit_week: 3, deposit_streak: 10, withdraw_half: -5, account_age: 2, balance_100: 2, balance_300: 2 };
assert.equal(rulesDraft(rules).overdue, '50');
assert.deepEqual(rulesValue(rulesDraft(rules)), rules);
assert.equal(Object.is(rulesValue({ ...rulesDraft(rules), overdue: '0' }).overdue, 0), true);

// The 信用分开关 Toast.
assert.equal(switchToast({ enabled: false, changed: true, students: 12 }), '已暂停，12 位学生按 600 分计');
assert.equal(switchToast({ enabled: true, changed: true, students: 12 }), '已重新开启，12 位学生恢复原来的分数');
assert.equal(switchToast({ enabled: true, changed: false, students: 0 }), '信用分本来就是这个状态');
