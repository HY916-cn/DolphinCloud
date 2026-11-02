import { expect, test } from '@playwright/test';
import { confirmIn, resetData, signIn } from './helpers';

// 考勤与工资 (PHASE-1.md §6.9, §7.5, §7.9) on the seed data: the bank admin counts teller01 (柜员小林), who signs in and
// binds 李思远's account (20260002) as the 工资账户; the bank admin confirms the shift, signs in one of last week (补签)
// and pays both weeks; 李思远 sees the pay in 明细.
test.describe.configure({ mode: 'serial' });
// 中午班 pays 12 and 下午班 15 (set below); the teller's shift today is the one of now.
const nowPay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .format(new Date()) < '13:30' ? 12 : 15;
test.beforeAll(resetData);

test('参与考勤: the bank admin counts a teller', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(page.getByText('还没有参与考勤的柜员')).toBeVisible();
  await page.locator('.dc-switch', { hasText: '柜员小林' }).click();
  await expect(page.getByRole('switch', { name: /柜员小林/ })).toBeChecked();
  await expect(page.getByRole('table', { name: '本周考勤' })).toContainText('未绑定工资账户');

  await page.locator('.dc-nav-item', { hasText: '参数' }).click();
  await page.getByLabel('中午班工资', { exact: true }).fill('12');
  await page.getByLabel('下午班工资', { exact: true }).fill('15');
  await page.getByRole('button', { name: '保存参数' }).click();
  await expect(page.getByText('参数已保存')).toBeVisible();
});

test('签到 and 工资账户: the teller signs in and binds a student account with its password', async ({ page: teller }) => {
  await signIn(teller, '工作人员', 'teller01');
  await teller.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await teller.getByRole('button', { name: '签到', exact: true }).click();
  await expect(teller.locator('.at-sign')).toContainText('已签到');
  await expect(teller.locator('.at-sign')).toContainText('待审');
  await teller.getByLabel('学号').fill('20260002');
  await teller.getByLabel('该学生账户的密码').fill('wrong-password');
  await teller.getByRole('button', { name: '绑定' }).click();
  await expect(teller.getByText('密码不对')).toBeVisible();
  await teller.getByLabel('该学生账户的密码').fill('a12345678');
  await teller.getByRole('button', { name: '绑定' }).click();
  await expect(teller.getByText('工资账户已绑定')).toBeVisible();
  await expect(teller.locator('section[aria-label="工资账户"]')).toContainText('李思远');
});

test('确认, 补签 and 发放工资 by the week', async ({ page }) => {
  // This week's shift waits for the bank admin; last week gets one signed in for the teller.
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  const week = page.getByRole('table', { name: '本周考勤' });
  await expect(week).toContainText('学号 20260002');
  await page.getByRole('button', { name: '确认待审（1）' }).click();
  await confirmIn(page, '全部确认');
  await expect(page.getByText('已确认 1 个班次')).toBeVisible();
  await page.getByRole('button', { name: '上一周' }).click();
  await week.getByRole('button', { name: /^柜员小林 .* 中午班未签到$/ }).first().click();
  await page.getByLabel('补签说明').fill('忘记签到，已核实到岗');
  await confirmIn(page, '补签');
  await expect(page.getByText('已补签')).toBeVisible();
  await expect(week.getByRole('button', { name: /^柜员小林 .* 中午班有效$/ })).toHaveCount(1);

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
  await teller.getByRole('button', { name: /星期.：.*中午班有效|星期.：.*下午班有效/ }).last().click();
  await expect(teller.getByRole('list', { name: /的班次$/ })).toContainText(`已发工资 ${nowPay} HTB`);
});

test('the student sees the pay in 明细', async ({ page: student }) => {
  await signIn(student, '学生', '20260002');
  await student.locator('.dc-nav-item, .dc-tab', { hasText: '明细' }).first().click();
  await expect(student.getByText(/工资 · .*班 1 个/).first()).toBeVisible();
});
