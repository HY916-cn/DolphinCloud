// node src/lib/roster.test.mjs — the roster template checks (PHASE-1.md §6.5).
import assert from 'node:assert/strict';
const { checkRoster, gradeOf } = await import('./roster.ts');

const on = new Date('2026-10-29T04:00:00Z'); // school year 2026, promotion on 09-01
assert.equal(gradeOf('primary', 2023, '09-01', on), 4);
assert.equal(gradeOf('junior', 2026, '09-01', on), 7);
assert.equal(gradeOf('primary', 2023, '09-01', new Date('2026-08-31T04:00:00Z')), 3);

const head = ['学号', '姓名', '学部', '学届', '班号', '期初余额'];
const ok = checkRoster([head, [20260101, ' 赵一 ', '小学部', 2023, 1, 30], ['20260102', '钱二', '初中部', '2025', '2', ''], []], '09-01', on);
assert.deepEqual(ok.problems, []);
assert.deepEqual(ok.rows, [
  { student_no: '20260101', name: '赵一', division: 'primary', cohort: 2023, class_no: 1, opening_balance: 30 },
  { student_no: '20260102', name: '钱二', division: 'junior', cohort: 2025, class_no: 2, opening_balance: null },
]);

const bad = checkRoster([head,
  ['1', '', '高中部', 2023, 1, -5],
  ['1', '孙三', '小学部', 2015, 100, 1.5],
  ['a b', '李四', '初中部', 2023, 3, '']], '09-01', on);
assert.deepEqual(bad.problems.map((p) => p.row), [2, 2, 2, 3, 3, 3, 3, 4, 4]);
assert.match(bad.problems[3].text, /与第 2 行重复/);
assert.match(bad.problems[4].text, /2015 届现在不在小学部/);
assert.equal(bad.rows.length, 0);

assert.match(checkRoster([['学号', '姓名']], '09-01', on).problems[0].text, /表头缺少「学部」「学届」「班号」「期初余额」/);
assert.deepEqual(ok.hints, []);

// 学号 as the sheet shows it; a cell Excel keeps as a date or a formatted number is a problem (design system data.md).
const shownAs = (rows) => [head, ...rows];
const typed = checkRoster(
  [head, [1234, '赵一', '小学部', 2023, 1, ''], [new Date('2025-12-31T16:00:00Z'), '钱二', '小学部', 2023, 1, ''], [20260103, '孙三', '小学部', 2023, 1, '']],
  '09-01', on,
  shownAs([['001234', '赵一', '小学部', '2023', '1', ''], ['2026/1/1', '钱二', '小学部', '2023', '1', ''], ['20260103', '孙三', '小学部', '2023', '1', '']]));
assert.deepEqual(typed.problems, [
  { row: 2, text: '学号单元格是数字或日期格式，可能已被 Excel 改过。请把学号列设为文本，重新填写后再导出。' },
  { row: 3, text: '学号单元格是数字或日期格式，可能已被 Excel 改过。请把学号列设为文本，重新填写后再导出。' },
]);
assert.deepEqual(typed.rows.map((r) => r.student_no), ['20260103'], 'a plain number shown as its digits reads as those digits');

// A 纯数字 学号 shorter than every other: a hint, not a problem; the row is imported as written.
const short = checkRoster([head, ['20260101', '赵一', '小学部', 2023, 1, ''], [123, '钱二', '小学部', 2023, 1, ''], ['20260103', '孙三', '小学部', 2023, 1, '']], '09-01', on);
assert.deepEqual(short.problems, []);
assert.deepEqual(short.hints, [{ row: 3, text: '学号 123 比其他学号短，可能丢了前面的 0。' }]);
assert.equal(short.rows.length, 3);
// Not for letters, one of several that short, or a roster of one.
assert.deepEqual(checkRoster([head, ['20260101', '赵一', '小学部', 2023, 1, ''], ['A12', '钱二', '小学部', 2023, 1, '']], '09-01', on).hints, []);
assert.deepEqual(checkRoster([head, ['20260101', '赵一', '小学部', 2023, 1, ''], ['123', '钱二', '小学部', 2023, 1, ''], ['124', '孙三', '小学部', 2023, 1, '']], '09-01', on).hints, []);
assert.deepEqual(checkRoster([head, ['123', '钱二', '小学部', 2023, 1, '']], '09-01', on).hints, []);
console.log('roster ok');
