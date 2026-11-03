// node src/lib/term.test.mjs — checks the term's start as the school reads it.
import assert from 'node:assert/strict';
const { termStart } = await import('./term.ts');
assert.equal(termStart(new Date('2026-11-03T04:00:00Z')), '2026-09-01');
assert.equal(termStart(new Date('2026-08-31T15:59:00Z')), '2026-02-01'); // 23:59 on 8月31日 in Shanghai
assert.equal(termStart(new Date('2026-08-31T16:00:00Z')), '2026-09-01'); // 00:00 on 9月1日 in Shanghai
assert.equal(termStart(new Date('2027-01-15T04:00:00Z')), '2026-09-01');

console.log('term ok');
