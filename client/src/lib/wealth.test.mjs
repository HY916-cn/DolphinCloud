// node src/lib/wealth.test.mjs — 理财 as the counter, 我的理财, the 首页 and the back office write it.
import assert from 'node:assert/strict';
const {
  amountHint, bounds, clipped, dayName, gain, heldValue, holdingLine, parseChange, plClass, plainPct, shownHoldings, signedPct, tierLabel,
  wealthDraft, wealthProblems, wealthValues,
} = await import('./wealth.ts');

// Percentages to 2 decimals with the minus sign −, half away from zero.
assert.equal(signedPct(0.4237), '+0.42%');
assert.equal(signedPct(-0.6835), '−0.68%');
assert.equal(signedPct(1.005), '+1.01%');
assert.equal(signedPct(-4.9168), '−4.92%');
assert.equal(signedPct(0.004), '0.00%');
assert.equal(signedPct(12), '+12.00%');
assert.equal(plainPct(-10), '10%');
assert.equal(plainPct(0.5153), '0.52%');
assert.equal(plClass(0.42), 'is-up');
assert.equal(plClass(-0.8), 'is-down');
assert.equal(plClass(0.001), '');

assert.deepEqual(gain(320), { text: '盈 +3.20 HTB', cls: 'is-up' });
assert.deepEqual(gain(-350), { text: '亏 −3.50 HTB', cls: 'is-down' });
assert.deepEqual(gain(0), { text: '持平', cls: '' });
assert.equal(tierLabel({ name: '平衡', multiplier: 2 }), '平衡 ×2');
assert.equal(tierLabel({ tier_name: '稳健', multiplier: 0.5 }), '稳健 ×0.5');
assert.deepEqual(bounds({ min: -10, max: 10 }), ['每天最多赚 10%', '每天最多亏 10%']);
assert.equal(dayName('2026-11-14', '2026-11-14'), '今天');
assert.equal(dayName('2026-11-13', '2026-11-14'), '11月13日');

assert.deepEqual(amountHint(0, 415), { text: '1 HTB 起，最多 415 HTB（活期余额）', error: false });
assert.deepEqual(amountHint(500, 415), { text: '余额不足：活期余额 415 HTB，还差 85 HTB', error: true });

const h = { id: 'a', student_no: '1', principal: 100, weeks: 12, opened_on: '2026-11-12', starts_on: '2026-11-13', matures_on: '2027-02-04',
  value_centi: 10320, valued_to: '2026-11-15', status: 'open', open_txn: 't', close_txn: null, tier: 'balanced', tier_name: '平衡', multiplier: 2,
  factor: 2, base: 3.6637, min_rate: -10, max_rate: 10 };
let l = holdingLine(h);
assert.equal(l.lead, '理财 12 周 · 平衡 ×2 · 本金 100 HTB，现在值 ');
assert.equal(l.amount, '103.20 HTB');
assert.equal(l.gain.text, '盈 +3.20 HTB');
assert.equal(l.day, '2月4日 到期');
assert.equal(l.tag, 'open');
assert.equal(l.canRedeem, true);
l = holdingLine({ ...h, status: 'redeemed', value_centi: 9650 }, '2027-01-06');
assert.equal(l.lead, '理财 12 周 · 平衡 ×2 · 本金 100 HTB，拿回 ');
assert.equal(l.amount, '96.50 HTB');
assert.equal(l.gain.text, '亏 −3.50 HTB');
assert.equal(l.day, '1月6日 赎回');
assert.equal(l.canRedeem, false);
assert.equal(holdingLine({ ...h, status: 'redeemed' }).day, null);
assert.equal(holdingLine({ ...h, status: 'matured', value_centi: 95 }).amount, '0.95 HTB');

assert.deepEqual(shownHoldings([{ status: 'open', opened_on: '2026-11-01' }, { status: 'reversed', opened_on: '2026-11-20' }, { status: 'matured', opened_on: '2026-11-10' }]),
  [{ status: 'matured', opened_on: '2026-11-10' }, { status: 'open', opened_on: '2026-11-01' }]);
assert.equal(heldValue([{ ...h, status: 'matured' }]), null);
assert.deepEqual(heldValue([h, { ...h, principal: 50, value_centi: 4825 }, { ...h, status: 'redeemed' }]),
  { text: '151.45 HTB', gain: { text: '盈 +1.45 HTB', cls: 'is-up' } });

assert.equal(clipped(10, { min: -10, max: 10 }), true);
assert.equal(clipped(-10, { min: -10, max: 10 }), true);
assert.equal(clipped(2.2, { min: -10, max: 10 }), false);

assert.equal(parseChange('−0.8'), -0.8);
assert.equal(parseChange('-0.8'), -0.8);
assert.equal(parseChange('1.2345'), 1.2345);
assert.equal(parseChange('50'), 50);
assert.equal(parseChange('50.1'), null);
assert.equal(parseChange('1.23456'), null);
assert.equal(parseChange(''), null);
assert.equal(parseChange('abc'), null);

const params = { symbol: 'sh000300', name: '沪深 300', factor: 2, base: { 2: 3.923, 4: 4.0031, 12: 3.6637, 24: 3.2208, 48: 2.5823 },
  tiers: [{ key: 'steady', name: '稳健', multiplier: 1, min: -5, max: 5 }, { key: 'balanced', name: '平衡', multiplier: 2, min: -10, max: 10 }] };
const draft = wealthDraft(params);
assert.equal(draft.tiers[1].loss, '10');
assert.deepEqual(wealthProblems(draft), {});
assert.deepEqual(wealthValues(draft), { ...params, base: { 2: 3.923, 4: 4.0031, 12: 3.6637, 24: 3.2208, 48: 2.5823 } });
assert.deepEqual(wealthValues({ ...draft, tiers: [{ ...draft.tiers[0], loss: '0' }] }).tiers[0].min, 0);
assert.deepEqual(Object.keys(wealthProblems({ ...draft, symbol: 'sh00030', name: '', factor: '11', base: { ...draft.base, 12: '1.23456' },
  tiers: [{ ...draft.tiers[0], name: '一二三四五六七八九十一', multiplier: '0.05', loss: '101', profit: 'x' }] })),
  ['symbol', 'name', 'factor', 'base.12', 'tiers.0.name', 'tiers.0.multiplier', 'tiers.0.loss', 'tiers.0.profit']);

console.log('wealth ok');
