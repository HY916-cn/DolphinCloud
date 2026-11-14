import { expect, test } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 全员考勤与工资 (PHASE-2.md §16.2, M18) on the seed data: 财务小郑 (accountant01) binds 张小明's account (20260001) on
// 我的; the bank admin counts them; 王行长 (president01) registers two of last week's shifts and voids one; the bank
// admin sets the accountant's 中午班 to 30 HTB and pays it. A president registers neither their own shifts nor
// another president's; the sysadmin has no 工资账户.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

test('财务 binds their own 工资账户 on 我的 with the student\'s password', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/me');
  const card = page.locator('section[aria-label="工资账户"]');
  await expect(card).toContainText('还没有绑定工资账户');
  await card.getByRole('button', { name: '绑定' }).click();
  const sheet = page.locator('.dc-sheet');
  await sheet.getByLabel('学号').fill('20260001');
  await sheet.getByLabel('这位学生的密码').fill('wrong-password');
  await confirmIn(page, '绑定');
  await expect(sheet.locator('.dc-notice-danger')).toContainText('密码不对');
  await sheet.getByLabel('这位学生的密码').fill('a12345678');
  await confirmIn(page, '绑定');
  await expect(page.locator('.dc-toast')).toHaveText('已绑定');
  await expect(card).toContainText('学号 20260001 · 张小明');
  await expect(card.getByRole('button', { name: '更换' })).toBeVisible();
});

test('the sysadmin\'s 我的 has no 工资账户', async ({ page }) => {
  await signIn(page, '工作人员', 'ops01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/me');
  await expect(page.locator('.dc-person-name')).toHaveText('运维小周');
  await expect(page.locator('section[aria-label="工资账户"]')).toHaveCount(0);
});

test('the bank admin counts the accountant', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await page.locator('.dc-switch', { hasText: '财务小郑' }).click();
  await expect(page.getByRole('switch', { name: /财务小郑/ })).toBeChecked();
  await expect(page.getByRole('table', { name: '本周考勤 · 财务' })).toContainText('学号 20260001');
});

test('the president registers two of last week\'s shifts and voids one', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: '上一周' }).click();
  const week = page.getByRole('table', { name: '本周考勤 · 财务' });
  await week.getByRole('button', { name: /^财务小郑 .* 中午班未上班$/ }).first().click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet).toContainText('财务小郑 · 财务');
  await expect(sheet.getByRole('checkbox', { name: '中午班' })).toBeChecked();
  await sheet.locator('.dc-check', { hasText: '下午班' }).click();
  await expect(sheet.getByRole('checkbox', { name: '下午班' })).toBeChecked();
  await sheet.getByLabel('说明').fill('值周检查');
  await confirmIn(page, '登记');
  await expect(page.locator('.dc-toast')).toHaveText('已登记 2 个班次');
  await expect(week.getByRole('button', { name: /^财务小郑 .* 中午班有效 · 值周检查$/ })).toHaveCount(1);

  await week.getByRole('button', { name: /^财务小郑 .* 下午班有效 · 值周检查$/ }).click();
  await sheet.getByLabel('作废原因').fill('登记错了');
  await confirmIn(page, '作废');
  await expect(page.locator('.dc-toast')).toHaveText('已作废');
  await expect(week.getByRole('img', { name: /^财务小郑 .* 下午班已作废 · 登记错了$/ })).toHaveCount(1);
  expect(sql(`select string_agg(shift || ' ' || status || ' ' || role, ', ' order by shift) from public.attendance a
    join public.profiles p on p.id = a.user_id where p.login_id = 'accountant01'`)).toBe('am confirmed accountant, pm rejected accountant');
});

test('a president registers neither their own shifts nor another president\'s; the bank admin does', async ({ page }) => {
  test.skip(!process.env.E2E_CONTAINER, 'needs the test container');
  sql(`do $$ declare v uuid := app_private.create_login('president02@staff.dolphin.internal', 'a12345678'); begin
    insert into public.profiles (id, login_kind, login_id, display_name) values (v, 'staff', 'president02', '李行长');
    insert into public.user_roles values (v, 'president');
    insert into public.staff_payroll (user_id, account, attendance) values (v, '20260003', true);
    insert into public.staff_payroll (user_id, account, attendance) select id, '20260002', true from public.profiles where login_id = 'president01';
  end $$`);
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: '上一周' }).click();
  const presidents = page.getByRole('table', { name: '本周考勤 · 行长' });
  await expect(presidents.getByRole('img', { name: /^王行长 / })).toHaveCount(14);
  await expect(presidents.getByRole('img', { name: /^李行长 / })).toHaveCount(14);
  await expect(presidents.getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: '登记班次' }).click();
  const people = page.locator('.dc-sheet').getByRole('list', { name: '可以登记的人员' });
  await expect(people).toContainText('财务小郑 · 财务');
  await expect(people).not.toContainText('行长');

  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: '上一周' }).click();
  await expect(page.getByRole('table', { name: '本周考勤 · 行长' }).getByRole('button')).toHaveCount(28);
});

test('the bank admin sets the accountant\'s pay and pays it at the accountant\'s rate', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings');
  await page.getByLabel('财务中午班工资', { exact: true }).fill('30');
  await page.getByRole('button', { name: '保存参数' }).click();
  await expect(page.getByText('参数已保存')).toBeVisible();
  expect(sql(`select amount from public.salary_rates where role = 'accountant' and shift = 'am'`)).toBe('30');
  expect(sql(`select amount from public.salary_rates where role = 'teller' and shift = 'am'`)).not.toBe('30');

  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: '上一周' }).click();
  await page.getByRole('button', { name: '发放工资' }).click();
  const row = page.locator('.dc-sheet').getByRole('list', { name: '本次发放' }).locator('li', { hasText: '财务小郑' });
  await expect(row).toContainText('财务小郑 · 财务 · 30 HTB');
  await expect(row).toContainText('中午班 1 个 · 存入学号 20260001');
  await confirmIn(page, '发放 30 HTB');
  await expect(page.locator('.dc-notice-success')).toContainText('财务小郑 1 个班次 30 HTB → 学号 20260001');
  expect(sql(`select pay from public.attendance a join public.profiles p on p.id = a.user_id
    where p.login_id = 'accountant01' and a.status = 'confirmed'`)).toBe('30');
});
