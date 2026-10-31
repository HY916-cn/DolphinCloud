// node src/lib/offline-queue.test.mjs — the upload rules of the offline deposit queue.
import assert from 'node:assert/strict';
const { createQueue } = await import('./offline-queue.ts');
const { AppError } = await import('./errors.ts');

const memory = new Map();
const q = createQueue({ get: async (k) => memory.get(k), set: async (k, v) => void memory.set(k, v) });
const entry = (id, operator, at) => ({ id, student_no: 's' + id, name: '', class: '', cash: { 5: 1 }, amount: 5, operator_id: operator, operator_name: operator, created_at: at });
await q.add(entry('2', 't1', '2026-10-28T09:02:00Z'));
await q.add(entry('1', 't1', '2026-10-28T09:01:00Z'));
await q.add(entry('3', 't2', '2026-10-28T09:00:00Z'));
await q.add(entry('4', 't1', '2026-10-28T09:03:00Z'));

const sent = [];
const booked = await q.upload('t1', async (e) => {
  sent.push(e.id);
  if (e.id === '2') throw new AppError('STUDENT_NOT_FOUND');
});
assert.deepEqual(sent, ['1', '2', '4'], 'only this teller, oldest first');
assert.equal(booked, 2);
assert.deepEqual((await q.list()).map((e) => [e.id, e.error]), [['2', 'STUDENT_NOT_FOUND'], ['3', undefined]], 'rejected stays marked; other teller untouched');

const again = await q.upload('t2', async () => { throw new AppError('NETWORK'); });
assert.equal(again, 0);
assert.equal((await q.list()).length, 2, 'a network failure keeps the entry unmarked for the next try');
assert.equal((await q.list()).find((e) => e.id === '3').error, undefined);

const resent = [];
await q.add(entry('5', 't1', '2026-10-28T09:04:00Z'));
assert.equal(await q.upload('t1', async (e) => void resent.push(e.id)), 1);
assert.deepEqual(resent, ['5'], 'a rejected entry is not sent again');
await q.remove('2');
assert.deepEqual((await q.list()).map((e) => e.id), ['3'], 'remove takes out only that entry');
console.log('offline queue ok');
