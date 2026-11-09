// node src/lib/motion.test.mjs — checks which rows of a list count as new.
import assert from 'node:assert/strict';
const { newRows } = await import('./motion.ts');
const seen = new Set(['c', 'b']);
assert.deepEqual(newRows(seen, ['e', 'd', 'c', 'b']), ['e', 'd']); // arrived on top
assert.deepEqual(newRows(seen, ['c', 'b', 'a']), []); // an earlier page at the foot
assert.deepEqual(newRows(seen, ['x', 'y']), []); // another list altogether
assert.deepEqual(newRows(new Set(), ['a']), ['a']); // the first row of an empty list

console.log('motion ok');
