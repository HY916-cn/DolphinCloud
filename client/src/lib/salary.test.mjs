// node src/lib/salary.test.mjs — 工资标准 by identity and shift (PHASE-2.md §16.2), and who registers whose shifts.
import assert from 'node:assert/strict';
const { earned, maySign, shiftState, PAID_ROLES, ratesDraft, ratesOf, ratesValue, tally } = await import('./salary.ts');

const rows = PAID_ROLES.flatMap((role, i) => [{ role, shift: 'am', amount: 10 + i }, { role, shift: 'pm', amount: 20 + i }]);
const rates = ratesOf(rows);
assert.deepEqual(rates.teller, { am: 10, pm: 20 });
assert.deepEqual(rates.president, { am: 13, pm: 23 });
assert.equal(ratesOf(rows.slice(1)), null); // a missing cell: no table to pay by

// Each shift at the rate of the identity it was signed under; a paid one at what it paid; others nothing.
const shifts = [
  { role: 'accountant', shift: 'am', status: 'confirmed' },
  { role: 'accountant', shift: 'pm', status: 'confirmed' },
  { role: 'teller', shift: 'pm', status: 'confirmed' },
  { role: 'president', shift: 'am', status: 'confirmed', pay: 5 },
  { role: 'storekeeper', shift: 'am', status: 'rejected' },
  { role: 'storekeeper', shift: 'pm', status: 'pending' },
];
assert.equal(earned(shifts, rates), 11 + 21 + 20 + 5);
assert.deepEqual(tally(shifts.slice(0, 3), rates), { am: 1, pm: 2, amount: 52 });
assert.deepEqual(tally(shifts.slice(4), rates), { am: 0, pm: 0, amount: 0 });

// The president and the bank admin sign anyone counted but themselves; a president's only by the bank admin.
for (const role of PAID_ROLES) assert.equal(maySign('teacher', role, false), true, role);
assert.equal(maySign('president', 'teller', false), true);
assert.equal(maySign('president', 'accountant', false), true);
assert.equal(maySign('president', 'storekeeper', false), true);
assert.equal(maySign('president', 'president', false), false);
assert.equal(maySign('president', 'accountant', true), false); // their own row
assert.equal(maySign('teacher', 'teacher', false), false);
assert.equal(maySign('teacher', 'sysadmin', false), false);
assert.equal(maySign('teacher', null, false), false);
assert.equal(maySign('accountant', 'teller', false), false);

// 已作废 is read from voided_at, whoever signed the shift; rejected without it is 未通过.
assert.equal(shiftState({ status: 'rejected', voided_at: '2026-12-01T05:00:00Z' }), 'void');
assert.equal(shiftState({ status: 'rejected', voided_at: null }), 'rejected');
assert.equal(shiftState({ status: 'confirmed', voided_at: null }), 'confirmed');
assert.equal(shiftState({ status: 'pending', voided_at: null }), 'pending');

// The table as typed: every cell an integer from 1 to 10000, or nothing to save.
const draft = ratesDraft(rates);
assert.deepEqual(ratesValue(draft), rates);
for (const bad of ['', '0', '10001', '1.5', '-3']) assert.equal(ratesValue({ ...draft, storekeeper: { am: bad, pm: '20' } }), null, bad);
assert.equal(ratesValue({ ...draft, storekeeper: { am: '10000', pm: '1' } }).storekeeper.am, 10000);

console.log('salary ok');
