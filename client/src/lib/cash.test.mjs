// node src/lib/cash.test.mjs — counting notes, payout and change.
import assert from 'node:assert/strict';
const { cashTotal, makeChange, describeCash, nonEmpty, cashCell } = await import('./cash.ts');
assert.equal(cashTotal({ 10: 2, 5: 1, 1: 0 }), 25);
assert.deepEqual(makeChange(28, [1, 2, 5, 10]), { 10: 2, 5: 1, 2: 1, 1: 1 });
assert.deepEqual(makeChange(0, [1, 2, 5, 10]), {});
assert.equal(describeCash({ 5: 1, 10: 2, 2: 0 }), '10 元 × 2 张、5 元 × 1 张');
assert.deepEqual(nonEmpty({ 10: 0, 5: 2 }), { 5: 2 });
assert.deepEqual(cashCell(1200, false), { text: '1,200', short: false });
assert.deepEqual(cashCell(0, true), { text: '0', short: false });
assert.deepEqual(cashCell(-1, true), { text: '少 1 张', short: true });
assert.deepEqual(cashCell(-1500, false), { text: '−1,500', short: true });
console.log('cash ok');

// 轧账: counted − expected per face; a face short in the box (expected −1) counts against nothing.
const { compareCash, isBalanced, diffNotes, diffAmount, diffFaces, cashNotes } = await import('./cash.ts');
const expected = { 1: 30, 2: 14, 5: 2, 10: 3 };
assert.deepEqual(compareCash(expected, { 1: 30, 2: 14, 5: 2, 10: 3 }), { 1: 0, 2: 0, 5: 0, 10: 0 });
assert.deepEqual(compareCash(expected, { 1: 30, 2: 15, 5: 1 }), { 1: 0, 2: 1, 5: -1, 10: -3 });
assert.deepEqual(compareCash({ 1: 19, 10: -1 }, { 1: 19, 10: 0 }), { 1: 0, 10: 1 });
assert.equal(isBalanced({ 1: 0, 2: 0 }), true);
assert.equal(isBalanced({ 1: 0, 2: -1 }), false);
assert.equal(diffNotes(0), '相符');
assert.equal(diffNotes(2), '多 2 张');
assert.equal(diffNotes(-1), '少 1 张');
assert.equal(diffAmount({ 1: 0, 5: 0 }), '平');
assert.equal(diffAmount({ 1: 0, 10: -1 }), '少 10 HTB');
assert.equal(diffAmount({ 5: 1 }), '多 5 HTB');
assert.equal(diffAmount({ 1: 1, 2: 2, 5: -1 }), '面额不对');
assert.equal(diffFaces({ 1: 0, 2: 1, 5: -1, 10: 0 }), '5 元少 1 张，2 元多 1 张');
assert.equal(cashNotes({ 5: 1, 10: 2 }, null, 'deposit'), '收 10 元 × 2、5 元 × 1');
assert.equal(cashNotes(null, { 1: 1, 2: 1, 10: 1 }, 'withdraw'), '付 10 元 × 1、2 元 × 1、1 元 × 1');
assert.equal(cashNotes({ 10: 2 }, { 2: 1 }, 'purchase'), '收 10 元 × 2，找 2 元 × 1');
assert.equal(cashNotes({ 10: 2 }, {}, 'purchase'), '收 10 元 × 2');
assert.equal(cashNotes(null, { 10: 2 }, 'reversal'), '付 10 元 × 2');
console.log('cash diff ok');
