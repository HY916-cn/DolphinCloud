import assert from 'node:assert/strict';
import { indexRoster, searchRoster } from './search.ts';

const roster = indexRoster([
  { student_no: '20260001', name: '张小明', class_label: '四年级(1)班', class_no: 1 },
  { student_no: '20260002', name: '李思远', class_label: '四年级(2)班', class_no: 2 },
  { student_no: '20260013', name: '单明', class_label: null, class_no: 3 },
]);
const names = (q) => searchRoster(roster, q).map((s) => s.name);

assert.deepEqual(names('20260001'), ['张小明']);
assert.deepEqual(names('2026000'), ['张小明', '李思远']);
assert.deepEqual(names('小明'), ['张小明']);
assert.deepEqual(names('ZXM'), ['张小明']);
assert.deepEqual(names('zhangxiao'), ['张小明']);
assert.deepEqual(names('lisi'), ['李思远']);
assert.deepEqual(names('四年级2班'), ['李思远']);
assert.deepEqual(names('四年级（1）班'), ['张小明']);
assert.deepEqual(names('3班'), ['单明']);
assert.deepEqual(names('shanming'), ['单明']); // surname reading
assert.deepEqual(names('s'), ['单明', '李思远']); // starts-with before contains
assert.deepEqual(names('  '), []);
console.log('search ok');
