// node src/lib/term-deposits.test.mjs — 定期 as the counter and 我的定期 write them, the interest as maturity pays it.
import assert from 'node:assert/strict';
const { amountHint, depositLine, flows, maxWeeks, nextMaturity, shownDeposits, termInterestCenti } = await import('./term-deposits.ts');

// ⌊金额 × round(周利率 × 10000) × 周数 ÷ 10000⌋ (PHASE-2 §9.5), the same as expected_centi.
assert.equal(termInterestCenti(100, 3.12, 4), 1248);
assert.equal(termInterestCenti(100, 4.2, 8), 3360);
assert.equal(termInterestCenti(7, 2.6123, 2), 36); // 7 × 26123 × 2 / 10000 = 36.57
assert.equal(termInterestCenti(1, 0.0001, 2), 0);
assert.equal(termInterestCenti(999999, 4.5678, 8), Math.floor(999999 * 45678 * 8 / 10000));

const four = { weeks: 4, rate: 3.12, matures_on: '2026-12-10' };
assert.equal(maxWeeks([{ weeks: 2, rate: 2.6, matures_on: '2026-11-26' }, four]), 4);
assert.equal(maxWeeks([four, four, four]), null);
assert.equal(maxWeeks([]), null);

assert.deepEqual(amountHint(0, 415, undefined), { text: '1 HTB 起，最多 415 HTB（活期余额）', error: false });
assert.deepEqual(amountHint(500, 415, four), { text: '余额不足：活期余额 415 HTB，还差 85 HTB', error: true });
assert.deepEqual(amountHint(100, 415, undefined), { text: '选好存期后显示到期拿回多少', error: false });
assert.deepEqual(amountHint(100, 415, four), { text: '到期拿回 112.48 HTB · 3.12%/周', error: false });

const dep = { id: 'd', student_no: '1', principal: 100, weeks: 4, rate: 3.12, opened_on: '2026-11-12', matures_on: '2026-12-10',
  status: 'open', open_txn: 'o', close_txn: null, interest_centi: null, expected_centi: 1248 };
assert.deepEqual(depositLine(dep, '2026-12-10'),
  { lead: '定期 4 周存 100 HTB，到期拿回 ', amount: '112.48 HTB', note: '12月10日 到期 · 3.12%/周', tag: 'open', canWithdraw: true });
assert.equal(depositLine(dep, '2026-12-11').canWithdraw, false); // past maturity, waiting for run_daily
assert.deepEqual(depositLine({ ...dep, status: 'matured' }, '2026-12-11'),
  { lead: '定期 4 周存 100 HTB，到期拿回 ', amount: '112.48 HTB', note: '12月10日 已转回活期 · 3.12%/周', tag: 'matured', canWithdraw: false });
assert.deepEqual(depositLine({ ...dep, status: 'early', interest_centi: 37 }, '2026-11-20'),
  { lead: '定期 4 周存 100 HTB，提前取出，利息 ', amount: '0.37 HTB', note: '原定 12月10日 到期 · 只按活期算利息', tag: 'early', canWithdraw: false });

assert.deepEqual(shownDeposits([
  { ...dep, id: 'a', opened_on: '2026-11-01' }, { ...dep, id: 'b', status: 'reversed' }, { ...dep, id: 'c', opened_on: '2026-11-05' },
]).map((d) => d.id), ['c', 'a']);

// 开定期, 定期转回 and their 冲正 are neither 存入 nor 支出.
assert.deepEqual(flows([
  { balance_delta: 22, term_id: null }, { balance_delta: -15, term_id: null }, { balance_delta: -100, term_id: 'a' },
  { balance_delta: 102, term_id: 'a' }, { balance_delta: -20, term_id: 'b' }, { balance_delta: 20, term_id: 'b' }, { balance_delta: 0, term_id: null },
]), { saved: 22, spent: -15, moved: 2 });
assert.deepEqual(flows([]), { saved: 0, spent: 0, moved: 0 });
// So are 放款, 还款 and their 冲正.
assert.deepEqual(flows([
  { balance_delta: 22, term_id: null, loan_id: null }, { balance_delta: 130, term_id: null, loan_id: 'l' }, { balance_delta: -33, term_id: null, loan_id: 'l' },
]), { saved: 22, spent: 0, moved: 97 });

assert.equal(nextMaturity([{ ...dep, matures_on: '2026-12-24' }, dep, { ...dep, status: 'matured', matures_on: '2026-11-26' }]), '12月10日 到期');
assert.equal(nextMaturity([{ ...dep, status: 'early' }]), null);
assert.equal(nextMaturity([]), null);

console.log('term-deposits ok');
