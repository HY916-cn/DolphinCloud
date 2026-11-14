import { expect, test } from '@playwright/test';
import { confirmIn, endDuty, resetData, signIn, startDuty } from './helpers';

// 考勤与工资 (PHASE-1.md §6.9, §7.5, §7.9) on the seed data: teller01 (柜员小林, on duty) binds 李思远's account
// (20260002) as the 工资账户; the bank admin counts the teller, whose 下班 and 上班 record the shift of now; the bank
// admin reviews it, signs in one of last week (补签) and pays both weeks; 李思远 sees the pay in 明细.
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

test('参与考勤: the bank admin counts the bound teller and sets the pay', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(page.getByText('还没有参与考勤的人员')).toBeVisible();
  await page.locator('.dc-switch', { hasText: '柜员小林' }).click();
  await expect(page.getByRole('switch', { name: /柜员小林/ })).toBeChecked();
  await expect(page.getByRole('table', { name: '本周考勤 · 柜员' })).toContainText('学号 20260002');

  await page.locator('.dc-nav-item', { hasText: '参数' }).click();
  await page.getByLabel('柜员中午班工资', { exact: true }).fill('12');
  await page.getByLabel('柜员下午班工资', { exact: true }).fill('15');
  await page.getByRole('button', { name: '保存参数' }).click();
  await expect(page.getByText('参数已保存')).toBeVisible();
});

test('下班 and 上班 record the shift of now once, and the counter waits for 上班', async ({ page: teller }) => {
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

test('审查 once, 补签, then 发放工资 by the week once nothing waits', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  const week = page.getByRole('table', { name: '本周考勤 · 柜员' });
  await expect(page.getByRole('button', { name: '发放工资' })).toBeDisabled(); // a shift still waits
  await week.getByRole('button', { name: /^柜员小林 .*待审$/ }).click();
  await page.locator('.dc-sheet .dc-chip', { hasText: '有效' }).click();
  await confirmIn(page, '下一步');
  await confirmIn(page, '确认有效');
  await expect(page.getByText('已确认')).toBeVisible();
  await expect(week.getByRole('img', { name: /^柜员小林 .*有效$/ })).toHaveCount(1); // reviewed: shown, not opened
  await expect(page.getByRole('button', { name: '全部确认 0' })).toBeDisabled();

  await page.getByRole('button', { name: '上一周' }).click();
  await week.getByRole('button', { name: /^柜员小林 .* 中午班未上班$/ }).first().click();
  await page.getByLabel('补签说明').fill('忘记上班，已核实到岗');
  await confirmIn(page, '补签');
  await expect(page.getByText('已补签')).toBeVisible();
  await expect(week.getByRole('img', { name: /^柜员小林 .* 中午班有效$/ })).toHaveCount(1);

  // Last week's payout pays last week's shift; this week's the one confirmed today; then nothing is left.
  await page.getByRole('button', { name: '发放工资' }).click();
  await confirmIn(page, '发放 12 HTB');
  await expect(page.getByText('已发放 12 HTB')).toBeVisible();
  await page.getByRole('button', { name: '本周' }).click();
  await page.getByRole('button', { name: '发放工资' }).click();
  await confirmIn(page, `发放 ${nowPay} HTB`);
  await expect(page.getByText(`柜员小林 1 个班次 ${nowPay} HTB → 学号 20260002`)).toBeVisible();
  await expect(page.getByRole('button', { name: '发放工资' })).toBeDisabled();
});

test('the teller sees what each shift paid', async ({ page: teller }) => {
  await signIn(teller, '工作人员', 'teller01');
  await teller.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(teller.locator('.dc-stat', { hasText: '已发' })).toContainText(`${nowPay}HTB`);
  await expect(teller.getByRole('table', { name: '本周班次' })).toContainText(`已发 ${nowPay} HTB`);
});

test('the student sees the pay in 明细', async ({ page: student }) => {
  await signIn(student, '学生', '20260002');
  await student.locator('.dc-nav-item, .dc-tab', { hasText: '明细' }).first().click();
  await student.getByRole('tab', { name: '工资' }).click();
  await expect(student.getByText(/工资 · .*班 1 个/).first()).toBeVisible();
});
