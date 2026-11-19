// node src/lib/alerts.test.mjs — 风险提醒 (design system RiskAlerts): each kind's 说明, object, rows and what 终止 does.
import assert from 'node:assert/strict';
const { alertDay, alertLine, alertLink, alertObject, alertRows, alertText, clock, handledLine, KIND_CHIPS, settingItems, termination } = await import('./alerts.ts');

const base = {
  id: 12, at: '2026-12-04T02:20:00Z', target: 'txns:t1', student_no: 's1', student_name: '张小明', staff_id: 'u1', staff_name: '柜员小林',
  status: 'open', handled_by: null, handler_name: null, handled_at: null, note: null, terminable: true,
};
const alert = (kind, detail, more = {}) => ({ ...base, kind, detail, ...more });

assert.equal(KIND_CHIPS.length, 13);
assert.equal(clock(base.at), '12月4日 10:20');
assert.deepEqual(alertDay(base.at), { key: '12-4', title: '12月4日 周五' });

// 说明 of each kind.
const withdraw = alert('withdraw_large', { txn_no: 'HT1', amount: 90, limit: 100, ratio: 80 });
assert.equal(alertText(withdraw), '取款 90 HTB，超过单笔限额 100 HTB 的 80%');
assert.equal(alertLine(withdraw), '12月4日 10:20 · 取款 90 HTB，超过单笔限额 100 HTB 的 80% · 柜员小林');
assert.equal(alertLine(withdraw, true), '10:20 · 取款 90 HTB，超过单笔限额 100 HTB 的 80% · 柜员小林');
assert.equal(alertText(alert('loan_large', { amount: 120, score: 580, loan_amount: 50, loan_score: 600 })),
  '贷款 120 HTB，超过 50 HTB；放款时信用分 580，低于 600');
assert.equal(alertText(alert('loan_large', { amount: 1200, score: 700, loan_amount: 50, loan_score: 600 })), '贷款 1,200 HTB，超过 50 HTB');
assert.equal(alertText(alert('loan_large', { amount: 30, score: 580, loan_amount: 50, loan_score: 600 })), '放款时信用分 580，低于 600');
assert.equal(alertText(alert('loan_overdue', { seq: 2, remaining: 98 })), '第 2 期逾期，剩余本金 98 HTB');
assert.equal(alertText(alert('term_early', { amount: 101, principal: 100 })), '提前支取本金 100 HTB 的定期，取出 101 HTB');
const many = alert('reversal_many', { txn_no: 'HT9', original_no: 'HT3', count: 3 });
assert.equal(alertText(many), '当天第 3 笔冲正，原流水 HT3');
assert.equal(alertObject(many), '柜员小林');
assert.equal(alertLine(many), '12月4日 10:20 · 当天第 3 笔冲正，原流水 HT3');
assert.equal(alertText(alert('ops_frequent', { count: 5, minutes: 10 })), '10 分钟内在柜台办理 5 笔');
assert.equal(alertText(alert('credit_adjust', { delta: 20, score: 650 })), '加 20 分，调整后 650 分');
assert.equal(alertText(alert('credit_adjust', { delta: -20, score: 610 })), '减 20 分，调整后 610 分');
const stock = alert('stock_low', { name: '海豚书签', stock: 3, safety_stock: 5 }, { student_no: null, student_name: null, staff_name: null });
assert.equal(alertText(stock), '库存 3 件，安全库存 5 件');
assert.equal(alertObject(stock), '海豚书签');
assert.equal(termination(stock), null);
// 轧账不平: the amount from the faces' differences.
const cash = alert('cash_unbalanced', { by: 'teller', diff: { 10: 0, 5: -1, 2: 1, 1: -1 }, note: '找零多给了' }, { target: 'duty:d1' });
assert.equal(alertText(cash), '下班时柜员点的现金少 4 HTB');
assert.equal(alertText(alert('cash_unbalanced', { by: 'review', diff: { 1: 1 } })), '复核时点的现金多 1 HTB');
assert.equal(alertText(alert('cash_unbalanced', { by: 'teller', diff: { 2: 1, 1: -2 } })), '下班时柜员点的现金面额不对');
assert.deepEqual(alertRows(cash), [['发现于', '柜员下班'], ['差额', '少 4 HTB', true], ['各面额', '5 元少 1 张，2 元多 1 张，1 元少 1 张'], ['当时写的原因', '找零多给了']]);
assert.deepEqual(alertLink(cash), { href: '/admin/cash/d1', label: '查看这次上班' });
assert.deepEqual(alertLink(alert('loan_overdue', {}, { target: 'loans:l1' })), { href: '/admin/loans/l1', label: '查看贷款' });
assert.equal(alertLink(withdraw), null);
assert.equal(alertText(alert('manual_entry', { type: 'deposit', amount: 20, occurred_at: '2026-11-03T02:00:00Z' })), '补录存款 20 HTB，发生于 11月3日 10:00');
assert.equal(alertText(alert('txn_correct', { original_no: 'HT20261204-0001', type: 'deposit', amount: 20 })), '编辑流水 HT20261204-0001，改为存款 20 HTB');
const sw = alert('credit_switch', { enabled: false, students: 320, reason: '期末' });
assert.equal(alertText(sw), '暂停信用分，涉及 320 位学生');
assert.equal(alertObject(sw), '全部学生');
assert.equal(alertText(alert('credit_switch', { enabled: true, students: 320 })), '重新开启信用分，涉及 320 位学生');

// 参数修改: one value, one item of a group, or several.
const ranking = alert('setting_change', { key: 'ranking_size', before: 10, after: 20 });
assert.equal(alertObject(ranking), '排名人数');
assert.equal(alertText(ranking), '从 10 名 改为 20 名');
assert.deepEqual(alertRows(ranking), [['修改前', '10 名'], ['修改后', '20 名'], ['修改人', '柜员小林']]);
assert.equal(alertText(alert('setting_change', { key: 'denominations', before: [1, 2, 5, 10], after: [1, 2, 5] })), '从 1、2、5、10 元 改为 1、2、5 元');
assert.equal(alertText(alert('setting_change', { key: 'ranking_anonymous', before: true, after: false })), '从 开启 改为 关闭');
assert.equal(alertText(alert('setting_change', { key: 'payout_ratio_min', before: 30, after: 25 })), '从 30% 改为 25%');
assert.equal(alertObject(alert('setting_change', { key: 'payout_ratio_min', before: 30, after: 25 })), '兑付能力提示线');
const anchor = alert('setting_change', { key: 'anchor_params', before: { initial: 2, min: 1, max: 4, weight: 0.25 }, after: { initial: 2.5, min: 1, max: 4.5, weight: 0.25 } });
assert.equal(alertText(anchor), '改了 2 项');
assert.deepEqual(alertRows(anchor).slice(0, 2), [['初始锚点', '2% → 2.5%'], ['锚点上限', '4% → 4.5%']]);
assert.deepEqual(settingItems('withdraw_single_limit', { junior: 200, primary: 100 }, { junior: 200, primary: 1500 }), [['小学部', '100 HTB', '1,500 HTB']]);
assert.deepEqual(settingItems('salary_rates', { teller: { am: 10, pm: 10 } }, { teller: { am: 12, pm: 10 } }), [['柜员中午班', '10 HTB', '12 HTB']]);
assert.deepEqual(settingItems('credit_rules', { overdue: -50 }, { overdue: -60 }), [['逾期', '−50 分', '−60 分']]);
assert.deepEqual(settingItems('credit_curve', { loan_max: 1.8 }, { loan_max: 1.6 }), [['最低分时的贷款系数', '×1.8', '×1.6']]);
assert.deepEqual(settingItems('risk_rules', { withdraw_ratio: 80 }, { withdraw_ratio: 90 }), [['大额取款：超过单笔限额的', '80%', '90%']]);
assert.deepEqual(settingItems('wealth_params', { base: { 4: 1 }, tiers: [{ max: 2 }] }, { base: { 4: 1.5 }, tiers: [{ max: 3 }] }),
  [['4 周基础收益', '1%', '1.5%'], ['档位 1 每天最多赚', '2%', '3%']]);
assert.deepEqual(settingItems('term_rates', { 2: 1 }, { 2: 1.25 }), [['2 周', '1%', '1.25%']]);
assert.equal(alertObject(alert('setting_change', { key: 'new_key', before: 1, after: 2 })), 'new_key');
const limit = alert('setting_change', { key: 'withdraw_single_limit', before: { junior: 200, primary: 100 }, after: { junior: 200, primary: 150 } });
assert.equal(alertText(limit), '小学部从 100 HTB 改为 150 HTB');
assert.deepEqual(alertRows(limit), [['小学部', '100 HTB → 150 HTB'], ['修改人', '柜员小林']]);
assert.equal(termination(limit).text, '单笔取款上限恢复为 小学部 100 HTB，从下一次计算起生效。');

// 处理 rows of a handled alert.
assert.equal(handledLine(withdraw), '');
assert.equal(handledLine({ ...withdraw, status: 'terminated', handler_name: '王老师', handled_at: '2026-12-04T03:05:00Z', note: '学生说明了用途' }),
  '王老师 12月4日 11:05 终止：学生说明了用途');
assert.equal(handledLine({ ...withdraw, status: 'seen', handler_name: '行长陈思', handled_at: '2026-12-03T04:30:00Z' }), '行长陈思 12月3日 12:30 查看');

// 终止: caption, sheet title and text.
assert.deepEqual(termination(withdraw, '学生说取错了金额'), {
  caption: '终止会冲正这笔取款：张小明的活期加回 90 HTB，这笔现金不计入任何一次上班。', title: '冲正张小明这笔 90 HTB 的取款？',
  text: '张小明的活期加回 90 HTB，这笔现金不计入任何一次上班。冲正原因记为“其他：学生说取错了金额”。',
});
assert.equal(termination(alert('loan_large', {})).title, '终止张小明的贷款？');
assert.equal(termination(alert('term_early', { amount: 101 })).title, '冲正张小明这笔提前支取？');
assert.equal(termination(many).title, '让柜员小林强制下班？');
assert.equal(termination(many).caption, '终止会让柜员小林强制下班：结束这笔业务时的那次上班，要重新上班才能继续办理。');
assert.equal(termination(ranking).text, '排名人数恢复为 10 名，从下一次计算起生效。');
assert.equal(termination(ranking).title, '把排名人数恢复为修改前的值？');
assert.deepEqual(termination(anchor), {
  caption: '终止会把锚点恢复为修改前的 2 项值，从下一次计算起生效。', title: '把锚点恢复为修改前的值？', text: '锚点恢复为修改前的 2 项值，从下一次计算起生效。',
  list: [['初始锚点', '2.5% → 2%'], ['锚点上限', '4.5% → 4%']],
});
assert.equal(termination(alert('credit_adjust', { delta: 20, score: 650 }), '加错了').text, '再记一条相反的变动：张小明的信用分减 20 分，原因记为“风险提醒终止：加错了”。');
const { alertsHref } = await import('./alerts.ts');
assert.equal(alertsHref({ tab: 'seen', from: '', kinds: 'loan_large,stock_low' }, 12), '/admin/alerts/12?tab=seen&kinds=loan_large%2Cstock_low');
assert.equal(alertsHref({ tab: undefined }), '/admin/alerts');
console.log('alerts: ok');
