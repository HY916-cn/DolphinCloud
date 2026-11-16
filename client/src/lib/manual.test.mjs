// node src/lib/manual.test.mjs — 补录 and 编辑 against PHASE-2.md §10.11 and design system ManualEntry.
import assert from 'node:assert/strict';
const {
  balanceMove, dayAndTime, doneText, entryArgs, entryDelta, entryProblem, entryQuestion, occurredAt, rangeHint, sameEntry, signedCenti,
} = await import('./manual.ts');

const deposit = { type: 'deposit', amount: 25, payment: null, denominations: { 10: 2, 5: 1, 1: 0 }, items: null };
const withdraw = { type: 'withdraw', amount: 30, payment: null, denominations: null, items: null };
const shop = { type: 'purchase', amount: 18, payment: 'cash', denominations: { 10: 2 }, items: [{ product_id: 'b', qty: 1 }, { product_id: 'a', qty: 2 }] };
const adjust = { type: 'adjust', amount: -20, payment: null, denominations: null, items: null };

// The change to 活期: a cash exchange leaves it, a 调账 by its sign.
assert.equal(entryDelta(deposit), 25);
assert.equal(entryDelta(withdraw), -30);
assert.equal(entryDelta(shop), 0);
assert.equal(entryDelta({ ...shop, payment: 'account' }), -18);
assert.equal(entryDelta(adjust), -20);

// What each type sends: empty faces dropped, notes only where they count.
assert.deepEqual(entryArgs(deposit), { amount: null, payment: null, denominations: { 10: 2, 5: 1 }, items: null });
assert.deepEqual(entryArgs(withdraw), { amount: 30, payment: null, denominations: null, items: null });
assert.deepEqual(entryArgs({ ...shop, payment: 'account' }).denominations, null);
assert.deepEqual(entryArgs(shop).denominations, { 10: 2 });
assert.deepEqual(entryArgs(adjust), { amount: -20, payment: null, denominations: null, items: null });

// Not ready until filled in right.
assert.equal(entryProblem(deposit), null);
assert.equal(entryProblem({ ...deposit, amount: 0 }), '请录入张数');
assert.equal(entryProblem({ ...withdraw, denominations: { 10: 2 } }), '面额合计 20 HTB，要等于取款金额');
assert.equal(entryProblem({ ...withdraw, denominations: { 10: 3 } }), null);
assert.equal(entryProblem({ ...shop, denominations: { 10: 1 } }), '收款不足，还差 8 HTB');
assert.equal(entryProblem({ ...shop, items: [] }), '请选择商品');
assert.equal(entryProblem({ ...adjust, amount: 0 }), '请输入调账金额');
assert.equal(entryProblem({ ...adjust, amount: 100001 }), '调账金额最多 100000 HTB');

// 编辑 only when something changed; products and faces in any order.
const a = { ...shop, student_no: '20260001' };
assert.ok(sameEntry(a, { ...a, items: [{ product_id: 'a', qty: 2 }, { product_id: 'b', qty: 1 }] }));
assert.ok(!sameEntry(a, { ...a, student_no: '20260002' }));
assert.ok(!sameEntry({ ...adjust, student_no: '1' }, { ...adjust, amount: 20, student_no: '1' }));
assert.ok(sameEntry({ ...deposit, student_no: '1' }, { ...deposit, denominations: { 5: 1, 10: 2 }, student_no: '1' }));

// The school's clock.
assert.equal(occurredAt('2026-11-12', '14:20'), '2026-11-12T14:20:00+08:00');
assert.deepEqual(dayAndTime('2026-11-12T06:20:00Z'), { date: '2026-11-12', time: '14:20' });
assert.deepEqual(dayAndTime('2026-10-31T16:05:00Z'), { date: '2026-11-01', time: '00:05' });
assert.equal(rangeHint('2026-10-31T16:00:00+00:00'), '可补录 11月1日 00:00 开户以后的业务');
assert.equal(rangeHint(null), '选好学生后，可补录开户以后的业务');

// The words.
assert.equal(signedCenti(15), '+0.15');
assert.equal(signedCenti(-8), '−0.08');
assert.equal(signedCenti(-120), '−1.20');
assert.equal(doneText('补录', [{ centi: 15 }]), '已补录，利息更正 +0.15 HTB');
assert.equal(doneText('编辑', [{ centi: -10 }, { centi: 2 }]), '已编辑，利息更正 −0.08 HTB');
assert.equal(doneText('补录', []), '已补录');
assert.equal(entryQuestion('张小明', deposit), '补录张小明的存款 25 HTB？');
assert.equal(entryQuestion('张小明', adjust), '给张小明调账 −20 HTB？');
assert.equal(balanceMove(415, 25), '415 → 440 HTB');
assert.equal(balanceMove(415, -10), '415 → 405 HTB');

console.log('manual ok');
