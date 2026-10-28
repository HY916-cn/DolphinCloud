// node src/lib/cash.test.mjs — counting notes, payout and change.
import assert from 'node:assert/strict';
const { cashTotal, makeChange, describeCash, nonEmpty } = await import('./cash.ts');
assert.equal(cashTotal({ 10: 2, 5: 1, 1: 0 }), 25);
assert.deepEqual(makeChange(28, [1, 2, 5, 10]), { 10: 2, 5: 1, 2: 1, 1: 1 });
assert.deepEqual(makeChange(0, [1, 2, 5, 10]), {});
assert.equal(describeCash({ 5: 1, 10: 2, 2: 0 }), '10 元 × 2 张、5 元 × 1 张');
assert.deepEqual(nonEmpty({ 10: 0, 5: 2 }), { 5: 2 });
console.log('cash ok');
