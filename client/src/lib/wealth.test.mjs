// node src/lib/wealth.test.mjs — 理财 as the counter, 我的理财, the 首页, the back office and 参数 write it.
import assert from 'node:assert/strict';
const {
  amountHint, buyText, cnDay, dayName, fixedPct, gain, heldValue, holdingLine, holdingName, lockedText, missingText, nav4, parseChange,
  plClass, productDay, sellableTag, shownHoldings, signedPct, wealthDraft, wealthProblems, wealthValues, weekBase,
} = await import('./wealth.ts');

// Percentages to 2 decimals with the minus sign −, half away from zero.
assert.equal(signedPct(0.4237), '+0.42%');
assert.equal(signedPct(-0.6835), '−0.68%');
assert.equal(signedPct(1.005), '+1.01%');
assert.equal(signedPct(0.004), '0.00%');
assert.equal(fixedPct(4), '4.00%');
assert.equal(fixedPct(-8), '−8.00%');
assert.equal(plClass(0.42), 'is-up');
assert.equal(plClass(-0.8), 'is-down');
assert.equal(plClass(0.001), '');
assert.equal(nav4(1.056_549), '1.0565');
assert.equal(nav4(1), '1.0000');
assert.equal(nav4(0.999_95), '1.0000');

assert.deepEqual(gain(324), { text: '盈 +3.24 HTB', cls: 'is-up' });
assert.deepEqual(gain(-192), { text: '亏 −1.92 HTB', cls: 'is-down' });
assert.deepEqual(gain(0), { text: '持平', cls: '' });
assert.equal(dayName('2026-11-26', '2026-11-26'), '今天');
assert.equal(dayName('2026-11-24', '2026-11-26'), '11月24日');
assert.equal(cnDay('2026-11-25T16:30:00Z'), '2026-11-26'); // 00:30 in Shanghai
assert.equal(cnDay('2026-11-26T15:59:00+00:00'), '2026-11-26');

// A product's day and rate.
const today = '2026-11-26';
assert.deepEqual(productDay({ nav_day: today, change: 0.8412 }, today), { text: '今天 +0.84%', cls: 'is-up' });
assert.deepEqual(productDay({ nav_day: '2026-11-24', change: -1.15 }, today), { text: '11月24日 −1.15%', cls: 'is-down' });
assert.deepEqual(productDay({ nav_day: '2026-11-24', change: 0 }, today), { text: '11月24日 0.00%', cls: '' });
assert.equal(productDay({ nav_day: '2026-11-25', change: null }, today), null);

// T+1.
const open = { status: 'open', sellable_on: '2026-11-27' };
assert.equal(sellableTag(open, today), '明天可卖');
assert.equal(sellableTag({ ...open, sellable_on: '2026-11-30' }, today), '11月30日可卖');
assert.equal(sellableTag({ ...open, sellable_on: today }, today), null);
assert.equal(sellableTag({ ...open, weeks: 12 }, today), null);
assert.equal(sellableTag({ ...open, status: 'redeemed' }, today), null);
assert.equal(lockedText('2026-11-27', today), '这笔理财明天起可以卖出。');
assert.equal(lockedText('2026-11-30', today), '这笔理财11月30日起可以卖出。');

assert.deepEqual(amountHint(0, 415), { text: '1 HTB 起，最多 415 HTB（活期余额）', error: false });
assert.deepEqual(amountHint(500, 415), { text: '余额不足：活期余额 415 HTB，还差 85 HTB', error: true });
assert.equal(buyText({ name: '黄金', nav: 1.056_5 }, 100), '按黄金当前净值 1.0565 买入 100 HTB。净值涨 1%，这笔理财也涨 1%；明天起可以卖出。');

// The lines of a list, at the counter and the student's.
const gold = {
  id: 'a', product: 'gold', name: '黄金', principal: 100, buy_nav: 1.0234, bought_at: '2026-11-24T02:00:00Z', value_centi: 10324, gain_centi: 324,
  sellable_on: '2026-11-25', status: 'open', closed_on: null, returned_centi: null,
};
let l = holdingLine(gold, today);
assert.equal(`${l.lead}${l.amount}`, '黄金 · 本金 100 HTB，现在值 103.24 HTB');
assert.deepEqual([l.gain.text, l.day, l.tag, l.wait], ['盈 +3.24 HTB', '11月24日 按净值 1.0234 买入', 'open', null]);
assert.equal(holdingLine(gold, today, true).day, '11月24日 买入');
const ndx = { ...gold, id: 'b', product: 'ndx', name: '纳斯达克 100', principal: 50, buy_nav: 1.0688, bought_at: '2026-11-26T01:00:00Z', value_centi: 5000, gain_centi: 0, sellable_on: '2026-11-27' };
l = holdingLine(ndx, today);
assert.deepEqual([`${l.lead}${l.amount}`, l.gain.text, l.day, l.tag, l.wait], ['纳斯达克 100 · 本金 50 HTB，现在值 50.00 HTB', '持平', '今天 按净值 1.0688 买入', 'wait', '明天可卖']);
const term = { ...gold, id: 'c', product: 'csi300', name: '沪深 300', buy_nav: null, value_centi: 10320, weeks: 12, tier_name: '平衡', multiplier: 2, matures_on: '2027-02-04', sellable_on: '2026-11-02', bought_at: '2026-11-01T02:00:00Z' };
l = holdingLine(term, today);
assert.equal(holdingName(term), '沪深 300 · 12 周 · 平衡 ×2');
assert.deepEqual([`${l.lead}${l.amount}`, l.gain.text, l.day, l.tag], ['沪深 300 · 12 周 · 平衡 ×2 · 本金 100 HTB，现在值 103.20 HTB', '盈 +3.20 HTB', '2月4日 到期', 'open']);
const sold = { ...gold, id: 'd', product: 'bond', name: '国债', principal: 30, value_centi: 3066, returned_centi: 3066, status: 'redeemed', closed_on: '2026-11-20', bought_at: '2026-11-10T02:00:00Z' };
l = holdingLine(sold, today);
assert.deepEqual([`${l.lead}${l.amount}`, l.gain.text, l.day, l.tag], ['国债 · 本金 30 HTB，拿回 30.66 HTB', '盈 +0.66 HTB', '11月20日 卖出', 'redeemed']);
const matured = { ...term, id: 'e', principal: 50, value_centi: 5106, returned_centi: 5106, status: 'matured', weeks: 4, tier_name: '稳健', multiplier: 1, matures_on: '2026-11-12', closed_on: '2026-11-13' };
l = holdingLine(matured, today);
assert.deepEqual([`${l.lead}${l.amount}`, l.day, l.tag], ['沪深 300 · 4 周 · 稳健 ×1 · 本金 50 HTB，拿回 51.06 HTB', '11月12日 到期', 'matured']);

// Open ones first, latest bought first; then the closed ones, latest closed first.
assert.deepEqual(shownHoldings([sold, gold, matured, ndx, term]).map((h) => h.id), ['b', 'a', 'c', 'd', 'e']);
assert.deepEqual(heldValue([gold, ndx, sold]), { text: '153.24 HTB', gain: { text: '盈 +3.24 HTB', cls: 'is-up' } });
assert.equal(heldValue([sold]), null);

assert.deepEqual(missingText([{ name: '黄金', missing: ['2026-11-21'] }, { name: '国债', missing: [] }, { name: '恒生指数', missing: ['2026-11-21', '2026-11-24'] }]),
  { count: 3, text: '黄金 11月21日；恒生指数 11月21日、11月24日' });

assert.equal(parseChange('−0.8'), -0.8);
assert.equal(parseChange('1.2345'), 1.2345);
assert.equal(parseChange('1.23456'), null);
assert.equal(parseChange('60'), null);
assert.equal(parseChange(''), null);

// 参数: each product's multiplier and premium; the rest kept as read.
const params = {
  cap: 20, products: [
    { key: 'bond', name: '国债', symbol: 'sh000012', multiplier: 10, premium: 0.25 },
    { key: 'gold', name: '黄金', symbol: 'sh518880', multiplier: 1, premium: -1.5 },
  ],
};
const draft = wealthDraft(params);
assert.deepEqual(draft, [{ key: 'bond', name: '国债', multiplier: '10', premium: '0.25' }, { key: 'gold', name: '黄金', multiplier: '1', premium: '−1.5' }]);
assert.deepEqual(wealthProblems(draft), {});
assert.deepEqual(wealthValues(draft, params), params);
const edited = [{ ...draft[0], multiplier: '20.5', premium: '10.00001' }, { ...draft[1], multiplier: '0.1', premium: '-10' }];
assert.deepEqual(wealthProblems(edited), { '0.multiplier': '倍率在 0.1～20 之间，最多 4 位小数。', '0.premium': '基准加成在 −10～10 之间，最多 4 位小数。' });
assert.deepEqual(wealthValues([draft[0], { ...draft[1], multiplier: '2.5', premium: '−0' }], params).products[1], { key: 'gold', name: '黄金', symbol: 'sh518880', multiplier: 2.5, premium: 0 });
assert.deepEqual(wealthProblems([{ ...draft[0], multiplier: '' }]), { '0.multiplier': '倍率在 0.1～20 之间，最多 4 位小数。' });
assert.equal(weekBase(2, '2'), '4.00%');
assert.equal(weekBase(2, '1.75'), '3.75%');
assert.equal(weekBase(2, '−10'), '−8.00%');
assert.equal(weekBase(2, ''), null);

console.log('wealth: ok');
