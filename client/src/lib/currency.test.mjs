// node src/lib/currency.test.mjs — 货币 and the 经营看板 as the design system's Currency writes them.
import assert from 'node:assert/strict';
const {
  anchorNote, anchorText, cashNote, confirmTitle, countsOk, countTop, kindTotal, loanNote, moveBy, moveOption, moveTitle, notesText, outHtb,
  payoutLow, payoutText, ratioText, signedHtb, stockNote, weekChange, weekLabel, weekTip,
} = await import('./currency.ts');

// The notes of a record: smallest first, none of 0; a 更正's signed.
assert.equal(notesText({ 10: 30, 5: 10, 2: 0 }), '5 元 × 10、10 元 × 30');
assert.equal(notesText({ 10: 1, 5: -2, 1: 0 }, true), '5 元 −2、10 元 +1');
assert.equal(kindTotal('issue', 350), '发行 350 HTB');
assert.equal(kindTotal('correction', -10), '更正 −10 HTB');
assert.equal(kindTotal('correction', 1200), '更正 +1,200 HTB');
assert.equal(signedHtb(2310), '+2,310 HTB');
assert.equal(signedHtb(0), '0 HTB');
assert.equal(outHtb(120), '−120 HTB');
assert.equal(outHtb(0), '0 HTB');

// 兑付能力 and its line.
assert.equal(ratioText(25.3), '25.3%');
assert.equal(ratioText(40), '40.0%');
assert.equal(ratioText(null), '—');
assert.equal(ratioText(1348.3), '1,348.3%');
const low = { ratio: 25.3, min: 30, low: true };
assert.equal(payoutLow(low), '兑付能力 25.3%，低于 30%');
assert.equal(payoutText(1480, 5850, low), '银行应有现金 1,480 HTB，是账户余额合计 5,850 HTB 的 25.3%。');
assert.equal(cashNote(low), '兑付能力 25.3%，低于 30%');
assert.equal(cashNote({ ratio: 42, min: 30, low: false }), '兑付能力 42.0%');
assert.equal(cashNote({ ratio: null, min: 30, low: false }), undefined);

// Records.
const issue = { id: 'a', kind: 'issue', batch_no: 'FX-1', on_date: '2026-12-07', denominations: { 5: 10, 10: 30 }, total: 350, reason: '开学发行',
  approver_name: '王老师', corrects: null, created_at: '2026-12-07T01:00:00Z', creator: { display_name: '银行管理员' } };
const fix = { ...issue, id: 'b', kind: 'correction', batch_no: null, approver_name: null, corrects: 'a', reason: '多登了 2 张', creator: null };
assert.equal(moveTitle(issue), '发行 FX-1');
assert.equal(moveTitle(fix, issue), '更正 · 对应 发行 FX-1');
assert.equal(moveTitle({ ...issue, kind: 'baseline' }), '期初现金');
assert.equal(moveOption(issue), '发行 FX-1 · 12月7日 · 350 HTB');
assert.equal(moveBy(issue, '12月7日 09:00'), '开学发行 · 审批 王老师 · 银行管理员 12月7日 09:00 登记');
assert.equal(moveBy({ ...issue, reason: null, approver_name: null }, '12月1日 07:40'), '银行管理员 12月1日 07:40 登记');
assert.equal(confirmTitle('baseline', 1200), '登记期初现金 1,200 HTB？');
assert.equal(confirmTitle('issue', 350, 'FX-1'), '登记发行 FX-1，350 HTB？');
assert.equal(confirmTitle('correction', -10), '登记更正 −10 HTB？');

// What may be recorded.
assert.equal(countsOk('issue', { 5: 10 }), true);
assert.equal(countsOk('issue', { 5: 0 }), false);
assert.equal(countsOk('issue', { 5: -1, 10: 1 }), false);
assert.equal(countsOk('issue', { 100: 100000 }), true);
assert.equal(countsOk('issue', { 100: 100001 }), false);
assert.equal(countsOk('issue', { 100: 100000, 50: 1 }), false); // over 10,000,000 HTB
assert.equal(countsOk('correction', { 5: -2, 10: 1 }), true); // 0 in all is fine for a 更正
assert.equal(countsOk('correction', { 5: -100001 }), false);

// 经营看板.
assert.equal(loanNote({ count: 12, remaining: 640, overdue: { count: 2, remaining: 45 } }), '逾期 2 笔 · 45 HTB');
assert.equal(loanNote({ count: 12, remaining: 640, overdue: { count: 0, remaining: 0 } }), '12 笔未结清');
assert.equal(loanNote({ count: 0, remaining: 0, overdue: { count: 0, remaining: 0 } }), undefined);
assert.equal(stockNote({ qty: 312, cost: 1234, uncosted: 2 }), '成本 1,234 HTB · 2 种没填成本');
assert.equal(stockNote({ qty: 312, cost: 1234, uncosted: 0 }), '成本 1,234 HTB');
assert.equal(anchorNote({ week_start: '2026-11-16', anchor: 2.25 }), '11月16日公布');
assert.equal(anchorNote({ week_start: null, anchor: 2 }), '还没有公布，按初始锚点');
assert.equal(anchorText(2.25), '2.25');
assert.equal(anchorText(2), '2');
assert.equal(weekChange(112, 100), '比上周 +12%');
assert.equal(weekChange(95, 100), '比上周 −5%');
assert.equal(weekChange(100, 100), '和上周持平');
assert.equal(weekChange(5, 0), '上周 0 笔');
assert.equal(weekLabel('2026-11-16'), '11/16');
assert.equal(weekTip('2026-11-16', 128), '11月16日起 · 128 笔');

// The scale's top is round and its half whole.
assert.equal(countTop(0), 2);
assert.equal(countTop(1), 2);
assert.equal(countTop(4), 6);
assert.equal(countTop(7), 10);
assert.equal(countTop(131), 200);
assert.equal(countTop(420), 500);
console.log('currency ok');
