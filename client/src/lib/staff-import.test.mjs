// node src/lib/staff-import.test.mjs — the staff template checks (PHASE-2.md §5.1).
import assert from 'node:assert/strict';
const { checkStaff } = await import('./staff-import.ts');

const head = ['账号', '姓名', '身份', '工资账户'];
const known = {
  logins: new Map([
    ['teller01', { id: 'u1', role: 'teller', disabled: false, closed: false }],
    ['store09', { id: 'u2', role: 'storekeeper', disabled: true, closed: false }],
    ['old01', { id: 'u3', role: 'teller', disabled: true, closed: true }],
  ]),
  students: new Map([['20260001', 'normal'], ['20260002', 'normal'], ['20260003', 'frozen'], ['20260004', 'normal']]),
  bound: new Map([['20260004', 'u1']]),
};

const ok = checkStaff([head, ['Teller02', ' 柜员小王 ', '柜员', 20260001], ['acct02', '财务小郑', '财务', ''], ['teller01', '柜员一', '柜员', '20260004'], []], known);
assert.deepEqual(ok.problems, []);
assert.deepEqual(ok.rows, [
  { login_id: 'teller02', name: '柜员小王', role: 'teller', account: '20260001' },
  { login_id: 'acct02', name: '财务小郑', role: 'accountant', account: null },
  { login_id: 'teller01', name: '柜员一', role: 'teller', account: '20260004' }, // its own binding is no conflict
]);

const bad = checkStaff([head,
  ['a', '', '银行管理员', ''],            // 2: format, name, bank admin
  ['t5', '五', '校长', ''],               // 3: unknown role
  ['t5', '五', '柜员', ''],               // 4: repeated login
  ['t6', '六', '柜员', '20260002'],       // 5: fine on its own
  ['t7', '七', '柜员', '20260002'],       // 6: repeated account
  ['t8', '八', '财务', '20260001'],       // 7: not a teller
  ['t9', '九', '柜员', '99999999'],       // 8: no such student
  ['t10', '十', '柜员', '20260003'],      // 9: frozen
  ['t11', '十一', '柜员', '20260004'],    // 10: bound to someone else
  ['store09', '库管', '库管', ''],        // 11: stopped
  ['old01', '旧', '柜员', ''],            // 12: closed
  ['teller01', '柜员一', '财务', ''],     // 13: role differs
], known);
assert.deepEqual(bad.problems.map((p) => p.row), [2, 2, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13]);
assert.match(bad.problems[2].text, /银行管理员不能导入/);
assert.match(bad.problems[4].text, /与第 3 行重复/);
assert.match(bad.problems[5].text, /与第 5 行重复/);
assert.match(bad.problems[6].text, /只有柜员/);
assert.match(bad.problems[7].text, /不存在/);
assert.match(bad.problems[8].text, /不是在读/);
assert.match(bad.problems[9].text, /已绑定其他工作人员/);
assert.match(bad.problems[10].text, /已停用/);
assert.match(bad.problems[11].text, /已注销/);
assert.match(bad.problems[12].text, /现在是柜员/);
assert.deepEqual(bad.rows.map((r) => r.login_id), ['t6']);

assert.match(checkStaff([['账号', '姓名']], known).problems[0].text, /表头缺少「身份」「工资账户」/);
console.log('staff import ok');
