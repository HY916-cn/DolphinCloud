// node src/lib/term.test.mjs — checks the term's start as the school reads it.
import assert from 'node:assert/strict';
const { inTerm, jobFailure, openItem, termStart, termState } = await import('./term.ts');
assert.equal(termStart(new Date('2026-11-03T04:00:00Z')), '2026-09-01');
assert.equal(termStart(new Date('2026-08-31T15:59:00Z')), '2026-02-01'); // 23:59 on 8月31日 in Shanghai
assert.equal(termStart(new Date('2026-08-31T16:00:00Z')), '2026-09-01'); // 00:00 on 9月1日 in Shanghai
assert.equal(termStart(new Date('2027-01-15T04:00:00Z')), '2026-09-01');

const term = { id: 't', name: '2026 学年第一学期', starts_on: '2026-09-01', ends_on: '2027-01-20', closed_at: null };
assert.equal(termState(term, '2026-08-31'), 'upcoming');
assert.equal(termState(term, '2026-09-01'), 'current');
assert.equal(termState(term, '2027-01-20'), 'current');
assert.equal(termState(term, '2027-01-21'), 'ended');
assert.equal(termState({ ...term, closed_at: '2027-01-22T02:00:00Z' }, '2027-01-22'), 'closed');

assert.deepEqual(openItem({ kind: 'job', job: 'daily', done_to: '2027-01-18' }, '2027-01-20'), ['每天的任务', '已处理到 1月18日，需处理到 1月20日']);
assert.deepEqual(openItem({ kind: 'term_deposit', id: 'x', student_no: '20260001', name: '张小明', principal: 100, matures_on: '2026-12-10' }, '2027-01-20'),
  ['张小明', '定期 100 HTB · 12月10日 到期']);
assert.deepEqual(openItem({ kind: 'loan' }, '2027-01-20'), ['其他事项', '处理完后再结转']);

assert.deepEqual(jobFailure({ job: 'daily', done_to: '2026-11-09', last_err: '2026-11-10: division by zero' }),
  { job: '每天的任务', done: '11月9日', day: '11月10日', reason: 'division by zero' });
assert.deepEqual(jobFailure({ job: 'weekly', done_to: '2026-11-02', last_err: 'boom' }), { job: '每周的任务', done: '11月2日', day: null, reason: 'boom' });

console.log('term ok');

// 学期内 from the first day to the last, both included; between terms it is the holidays.
const terms = [{ starts_on: '2026-09-01', ends_on: '2027-01-20' }, { starts_on: '2027-02-15', ends_on: '2027-06-30' }];
assert.equal(inTerm(terms, '2026-09-01'), true);
assert.equal(inTerm(terms, '2027-01-20'), true);
assert.equal(inTerm(terms, '2027-01-21'), false);
assert.equal(inTerm(terms, '2027-02-15'), true);
assert.equal(inTerm([], '2026-11-12'), false);
