import { expect, test } from '@playwright/test';
import { confirmIn, endDuty, resetData, signIn, startDuty } from './helpers';

// 考勤与工资 (PHASE-1.md §6.9, §7.5, §7.9) on the seed data: teller01 (柜员小林, on duty) binds 李思远's account
// (20260002) as the 工资账户; the bank admin counts the teller, whose 下班 and 上班 record the shift of now; the bank
// admin reviews it, signs in one of last week from the table and pays both weeks; 李思远 sees the pay in 明细.
test.describe.configure({ mode: 'serial' });
// A teller's 中午班 pays 12 and 下午班 15 (set below in the 工资标准); the teller's shift today is the one of now.
const nowPay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .format(new Date()) < '13:30' ? 12 : 15;
test.beforeAll(resetData);

test('工资账户 first: the teller binds a student account with its password', async ({ page: teller }) => {
  await signIn(teller, '工作人员', 'teller01');
  await teller.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(teller.getByText('还没有参与考勤')).toBeVisible();
  await teller.getByLabel('学号').fill('20260002');
  await teller.getByLabel('该学生账户的密码').fill('wrong-password');
  await teller.getByRole('button', { name: '绑定' }).click();
  await expect(teller.getByText('密码不对')).toBeVisible();
  await teller.getByLabel('该学生账户的密码').fill('a12345678');
  await teller.getByRole('button', { name: '绑定' }).click();
  await expect(teller.getByText('工资账户已绑定')).toBeVisible();
  await expect(teller.locator('section[aria-label="工资账户"]')).toContainText('李思远');
});

// Skipped until 参数 reads wealth_params of six products (PHASE-2.md §14.3, M24).
test.skip('参与考勤: the bank admin counts the bound teller and sets the pay', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(page.locator('.dc-notice', { hasText: '还没有参与考勤的人员' })).toContainText('在「人员」里打开「参与考勤」。');
  await page.locator('.dc-nav-item', { hasText: '人员' }).click();
  await page.locator('.dc-list-link', { hasText: '柜员小林' }).click();
  await page.locator('.dc-switch', { hasText: '参与考勤' }).click();
  await expect(page.getByRole('switch', { name: /参与考勤/ })).toBeChecked();
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  const week = page.getByRole('table', { name: '本周考勤' });
  await expect(week.locator('tr.is-group th')).toHaveText(['柜员']);
  await expect(week.locator('tbody td').first()).toHaveText('柜员小林'); // bound: only the name
  await expect(week.locator('tfoot td')).toHaveText(['合计', '', '0', '0']);
  await expect(page.locator('.dc-stat')).toHaveCount(0);
  await expect(page.locator('.dc-shift-legend > span')).toHaveText(['中有效', '中待审', '中未通过', '中已作废', '中未上班', '中可签到']);

  await page.locator('.dc-nav-item', { hasText: '参数' }).click();
  await page.getByLabel('柜员中午班工资', { exact: true }).fill('12');
  await page.getByLabel('柜员下午班工资', { exact: true }).fill('15');
  await page.getByRole('button', { name: '保存参数' }).click();
  await expect(page.getByText('参数已保存')).toBeVisible();
});

// Skipped with the 参数 case above it depends on (M24).
test.skip('下班 and 上班 record the shift of now once, and the counter waits for 上班', async ({ page: teller }) => {
  await signIn(teller, '工作人员', 'teller01');
  await teller.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(teller.locator('.dc-duty')).toContainText('已上班');
  await endDuty(teller);
  await teller.locator('.dc-nav-item', { hasText: '办理' }).click();
  await expect(teller.getByRole('searchbox', { name: '搜索学生' })).toHaveCount(0);
  await startDuty(teller);
  await expect(teller.getByRole('searchbox', { name: '搜索学生' })).toBeVisible();
  await teller.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(teller.locator('.dc-stat', { hasText: '待审' })).toContainText('1个班次');
  await expect(teller.locator('section[aria-label="上下班记录"] li')).toHaveCount(2);
});

// Skipped with the 参数 case above it depends on (M24).
test.skip('审查 once, 签到 from the table, then 发放工资 by the week once nothing waits', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  const week = page.getByRole('table', { name: '本周考勤' });
  await expect(page.getByRole('button', { name: '发放工资' })).toBeDisabled(); // a shift still waits
  await expect(page.locator('.dc-caption')).toHaveCount(0); // nothing confirmed to pay yet, so no note on what waits
  await week.getByRole('button', { name: /^柜员小林 .*待审$/ }).click();
  await page.locator('.dc-sheet .dc-chip', { hasText: '有效' }).click();
  await confirmIn(page, '下一步');
  await confirmIn(page, '确认有效');
  await expect(page.getByText('已确认')).toBeVisible();
  await expect(week.getByRole('button', { name: /^柜员小林 .*有效$/ })).toHaveCount(1); // reviewed: now it may be voided
  await expect(page.getByRole('button', { name: '全部确认 0' })).toBeDisabled();

  await page.getByRole('button', { name: '上一周' }).click();
  await expect(week.getByRole('button', { name: /^柜员小林 .* 中午班，可签到$/ }).first().locator('.dc-shift')).toHaveClass(/is-open/);
  await week.getByRole('button', { name: /^柜员小林 .* 中午班，可签到$/ }).first().click();
  await expect(page.locator('.dc-sheet-title')).toHaveText('给柜员小林签到？');
  await page.locator('.dc-sheet').getByLabel('说明').fill('忘记上班，已核实到岗');
  await confirmIn(page, '签到');
  await expect(page.locator('.dc-toast')).toHaveText('已签到');
  await expect(week.getByRole('button', { name: /^柜员小林 .* 中午班有效 · 忘记上班，已核实到岗$/ })).toHaveCount(1); // still voidable

  // Last week's payout pays last week's shift; this week's the one confirmed today; then nothing is left.
  await page.getByRole('button', { name: '发放工资' }).click();
  await confirmIn(page, '发放 12 HTB');
  await expect(page.getByText('已发放 12 HTB')).toBeVisible();
  await page.getByRole('button', { name: '本周' }).click();
  await page.getByRole('button', { name: '发放工资' }).click();
  await confirmIn(page, `发放 ${nowPay} HTB`);
  await expect(page.getByText(`柜员小林 1 个班次 ${nowPay} HTB → 学号 20260002`)).toBeVisible();
  await expect(page.getByRole('button', { name: '发放工资' })).toBeDisabled();
  await expect(week.getByRole('img', { name: /^柜员小林 .*有效$/ })).toHaveCount(1); // paid: no longer voided
  await expect(week.locator('tfoot td')).toHaveText(['合计', '', '1', `${nowPay}`]);
});

// Skipped with the 参数 case above it depends on (M24).
test.skip('the teller sees what each shift paid', async ({ page: teller }) => {
  await signIn(teller, '工作人员', 'teller01');
  await teller.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(teller.locator('.dc-stat', { hasText: '已发' })).toContainText(`${nowPay}HTB`);
  await expect(teller.getByRole('table', { name: '本周班次' })).toContainText(`已发 ${nowPay} HTB`);
});

// Skipped with the 参数 case above it depends on (M24).
test.skip('the student sees the pay in 明细', async ({ page: student }) => {
  await signIn(student, '学生', '20260002');
  await student.locator('.dc-nav-item, .dc-tab', { hasText: '明细' }).first().click();
  await student.getByRole('tab', { name: '工资' }).click();
  await expect(student.getByText(/工资 · .*班 1 个/).first()).toBeVisible();
});
