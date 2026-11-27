// node src/lib/offline-queue.test.mjs — the upload rules of the offline deposit queue.
import assert from 'node:assert/strict';
const { createQueue, retryDelay, transient } = await import('./offline-queue.ts');
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
  if (e.id === '2') throw new AppError('STUDENT_NOT_FOUND', {}, 400);
});
assert.deepEqual(sent, ['1', '2', '4'], 'only this teller, oldest first');
assert.deepEqual(booked, { booked: 2, retry: false });
assert.deepEqual((await q.list()).map((e) => [e.id, e.error]), [['2', 'STUDENT_NOT_FOUND'], ['3', undefined]], 'refused stays marked; other teller untouched');

const again = await q.upload('t2', async () => { throw new AppError('NETWORK'); });
assert.deepEqual(again, { booked: 0, retry: true });
assert.equal((await q.list()).length, 2, 'a network failure keeps the entry unmarked for the next try');
assert.equal((await q.list()).find((e) => e.id === '3').error, undefined);

// A server error (5xx) is not a refusal: the entry stays waiting, and the ones after it wait their turn.
await q.add(entry('6', 't2', '2026-10-28T09:05:00Z'));
const order = [];
for (const status of [500, 502, 503]) {
  assert.deepEqual(await q.upload('t2', async (e) => { order.push(e.id); throw new AppError('could not serialize access', {}, status); }), { booked: 0, retry: true });
}
assert.deepEqual(order, ['3', '3', '3'], 'stops at the first, keeping the order taken');
assert.deepEqual((await q.list()).filter((e) => e.operator_id === 't2').map((e) => [e.id, e.error]), [['3', undefined], ['6', undefined]]);
// A timeout (no status) and anything that is not an AppError also wait.
assert.deepEqual(await q.upload('t2', async () => { throw new TypeError('Failed to fetch'); }), { booked: 0, retry: true });
assert.equal(transient(new AppError('STUDENT_FROZEN', {}, 400)), false);
assert.equal(transient(new AppError('LIMIT_EXCEEDED')), true, 'no status: the client never heard the server');
assert.deepEqual(await q.upload('t2', async () => {}), { booked: 2, retry: false });

const resent = [];
await q.add(entry('5', 't1', '2026-10-28T09:04:00Z'));
assert.deepEqual(await q.upload('t1', async (e) => void resent.push(e.id)), { booked: 1, retry: false });
assert.deepEqual(resent, ['5'], 'a refused entry is not sent again');

// 重试 puts a refused entry back in line; the next upload sends it.
await q.add(entry('7', 't1', '2026-10-28T09:06:00Z'));
await q.add(entry('8', 't1', '2026-10-28T09:07:00Z'));
await q.upload('t1', async (e) => { if (e.id === '7') throw new AppError('STUDENT_FROZEN', {}, 400); });
await q.retry('2');
assert.deepEqual((await q.list()).map((e) => [e.id, e.error]), [['2', undefined], ['7', 'STUDENT_FROZEN']], 'only that entry');
const retried = [];
assert.deepEqual(await q.upload('t1', async (e) => void retried.push(e.id)), { booked: 1, retry: false });
assert.deepEqual(retried, ['2']);
await q.remove('7');
assert.deepEqual(await q.list(), [], 'remove takes out only that entry');

assert.deepEqual([1, 2, 3, 4, 5, 9].map(retryDelay), [5_000, 15_000, 60_000, 300_000, 300_000, 300_000]);
console.log('offline queue ok');
