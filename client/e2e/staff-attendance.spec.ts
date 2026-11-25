import { expect, test } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 全员考勤与工资 (PHASE-2.md §16.2, M18, M21) on the seed data: 财务小郑 (accountant01) binds 张小明's account (20260001)
// on 我的; the bank admin counts them; they sign in to the shift of now on 我的, which 王行长 (president01) sees waiting
// and only the bank admin reviews; 王行长 then voids it, and it reads 已作废, not 未通过. 王行长 signs in two of last
// week's shifts from the table and voids one, and does the same for a teller; the bank admin sets the accountant's
// 中午班 to 30 HTB and pays it. A president signs neither their own shifts nor another president's; the bank admin and
// the sysadmin have no 工资账户.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

test('财务 binds their own 工资账户 on 我的 with the student\'s password', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/me');
  const card = page.locator('section[aria-label="工资账户"]');
  const signing = page.locator('section[aria-label="签到"]');
  await expect(card).toContainText('还没有绑定工资账户');
  await expect(signing).toContainText(/(中午班|下午班) · 还没有签到先绑定工资账户，再签到。/);
  await expect(signing.getByRole('button', { name: '签到' })).toBeDisabled();
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
  await expect(page.locator('section[aria-label="我的班次"]')).toContainText('还没有参与考勤先绑定工资账户，再请银行管理员开启。');
  await expect(signing).toContainText('还没有参与考勤，请银行管理员开启后再签到。');
  await expect(signing.getByRole('button', { name: '签到' })).toBeDisabled();
});

test('the sysadmin\'s and the bank admin\'s 我的 have no 工资账户, 签到 or 我的班次', async ({ page }) => {
  for (const login of ['ops01', 'admin']) {
    await signIn(page, '工作人员', login);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/me');
    await expect(page.locator('.dc-person-meta')).toContainText(`账号 ${login}`);
    await expect(page.locator('section[aria-label="工资账户"], section[aria-label="签到"], section[aria-label="我的班次"]')).toHaveCount(0);
  }
});

test('the bank admin counts the accountant', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff');
  await page.locator('.dc-list-link', { hasText: '财务小郑' }).click();
  await page.locator('.dc-switch', { hasText: '参与考勤' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText('已参与考勤');
  await expect(page.getByRole('switch', { name: /参与考勤/ })).toBeChecked();
  await page.goto('/admin/attendance');
  const week = page.getByRole('table', { name: '本周考勤' });
  await expect(week.locator('tr.is-group th')).toHaveText(['财务']);
  await expect(week.locator('tbody td').first()).toHaveText('财务小郑');
});

test('财务 signs in on 我的; the president sees it waiting, read only; the bank admin reviews it', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/me');
  const signing = page.locator('section[aria-label="签到"]');
  await expect(signing).toContainText('签到后由银行管理员审查，通过后计入工资。');
  await signing.getByRole('button', { name: '签到' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('已签到，等银行管理员审查');
  await expect(signing.locator('b')).toHaveText(/^(中午班|下午班) (中|下) 待审$/);
  await expect(signing).toContainText(/\d+月\d+日 \d\d:\d\d 签到/);
  await expect(signing.getByRole('button')).toHaveCount(0);
  expect(sql(`select status || ' ' || role || ' ' || (signed_by = user_id) from public.attendance a
    join public.profiles p on p.id = a.user_id where p.login_id = 'accountant01'`)).toBe('pending accountant true');

  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  const week = page.getByRole('table', { name: '本周考勤' });
  await expect(week.getByRole('img', { name: /^财务小郑 .*待审$/ })).toHaveCount(1);
  await expect(week.getByRole('button', { name: /待审$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /全部确认|发放工资/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登记班次' })).toHaveCount(0);

  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await week.getByRole('button', { name: /^财务小郑 .*待审$/ }).click();
  await page.locator('.dc-sheet .dc-chip', { hasText: '有效' }).click();
  await confirmIn(page, '下一步');
  await confirmIn(page, '确认有效');
  await expect(page.getByText('已确认')).toBeVisible();
  expect(sql(`select status from public.attendance a join public.profiles p on p.id = a.user_id
    where p.login_id = 'accountant01'`)).toBe('confirmed');
});

test('the shift signed on 我的 and confirmed, once voided, reads 已作废 and not 未通过', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  const week = page.getByRole('table', { name: '本周考勤' });
  await week.getByRole('button', { name: /^财务小郑 .*有效$/ }).click();
  await page.locator('.dc-sheet').getByLabel('作废原因').fill('当天不在岗');
  await confirmIn(page, '作废');
  await expect(page.locator('.dc-toast')).toHaveText('已作废');
  await expect(week.getByRole('img', { name: /^财务小郑 .*已作废 · 当天不在岗$/ })).toHaveCount(1);
  await expect(week.locator('.dc-shift.is-void')).toHaveCount(1);
  await expect(week.locator('.dc-shift.is-rejected')).toHaveCount(0);
  expect(sql(`select status || ' ' || (voided_at is not null) || ' ' || (signed_by = user_id) from public.attendance a
    join public.profiles p on p.id = a.user_id where p.login_id = 'accountant01'`)).toBe('rejected true true');

  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/me');
  const signing = page.locator('section[aria-label="签到"]');
  await expect(signing.locator('b')).toHaveText(/^(中午班|下午班) (中|下) 已作废$/);
  await expect(signing.locator('.dc-shift.is-void')).toHaveCount(1);
  await expect(page.getByRole('table', { name: '本周班次' })).toContainText('已作废');
  await expect(page.getByRole('table', { name: '本周班次' })).not.toContainText('未通过');
});

test('the president signs in two of last week\'s shifts from the table and voids one', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: '上一周' }).click();
  const week = page.getByRole('table', { name: '本周考勤' });
  const sheet = page.locator('.dc-sheet');
  for (const shift of ['中午班', '下午班']) {
    await week.getByRole('button', { name: new RegExp(`^财务小郑 .* ${shift}，可签到$`) }).first().click();
    await expect(sheet.locator('.dc-sheet-title')).toHaveText('给财务小郑签到？');
    await expect(sheet).toContainText(`${shift}，签上即有效，计入工资。`);
    await expect(sheet.getByRole('button', { name: '签到' })).toBeDisabled(); // the note comes first
    await sheet.getByLabel('说明').fill('值周检查');
    await confirmIn(page, '签到');
    await expect(page.locator('.dc-toast')).toHaveText('已签到');
  }
  await expect(week.getByRole('button', { name: /^财务小郑 .* 中午班有效 · 值周检查$/ })).toHaveCount(1);

  await week.getByRole('button', { name: /^财务小郑 .* 下午班有效 · 值周检查$/ }).click();
  await expect(sheet.locator('.dc-sheet-title')).toHaveText(/^作废财务小郑 \d+月\d+日的下午班？$/);
  await sheet.getByLabel('作废原因').fill('签错了');
  await confirmIn(page, '作废');
  await expect(page.locator('.dc-toast')).toHaveText('已作废');
  await expect(week.getByRole('img', { name: /^财务小郑 .* 下午班已作废 · 签错了$/ })).toHaveCount(1);
  expect(sql(`select string_agg(shift || ' ' || status || ' ' || role, ', ' order by shift) from public.attendance a
    join public.profiles p on p.id = a.user_id where p.login_id = 'accountant01' and a.signed_by <> a.user_id`))
    .toBe('am confirmed accountant, pm rejected accountant');
});

test('the president signs in a teller\'s shift from the table and voids it', async ({ page }) => {
  test.skip(!process.env.E2E_CONTAINER, 'needs the test container');
  sql(`insert into public.staff_payroll (user_id, account, attendance) select id, '20260002', true from public.profiles where login_id = 'teller01'`);
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: '上一周' }).click();
  const week = page.getByRole('table', { name: '本周考勤' });
  const sheet = page.locator('.dc-sheet');
  await week.getByRole('button', { name: /^柜员小林 .* 中午班，可签到$/ }).first().click();
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('给柜员小林签到？');
  await sheet.getByLabel('说明').fill('补记柜台班次');
  await confirmIn(page, '签到');
  await expect(page.locator('.dc-toast')).toHaveText('已签到');
  await week.getByRole('button', { name: /^柜员小林 .* 中午班有效 · 补记柜台班次$/ }).click();
  await sheet.getByLabel('作废原因').fill('签错了');
  await confirmIn(page, '作废');
  await expect(page.locator('.dc-toast')).toHaveText('已作废');
  await expect(week.getByRole('img', { name: /^柜员小林 .* 中午班已作废 · 签错了$/ })).toHaveCount(1);
  expect(sql(`select status || ' ' || role from public.attendance a join public.profiles p on p.id = a.user_id
    where p.login_id = 'teller01' and a.signed_by <> a.user_id`)).toBe('rejected teller');
  // 20260002 goes to 王行长 below.
  sql(`update public.staff_payroll set account = null, attendance = false where user_id = (select id from public.profiles where login_id = 'teller01')`);
});

test('财务 sees their own week on 我的: the shift voided reads 已作废', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/me');
  const mine = page.locator('section[aria-label="我的班次"]');
  await mine.getByRole('button', { name: '上一周' }).click();
  await expect(mine.locator('.dc-stat', { hasText: '有效' })).toContainText('1个班次');
  await expect(mine.locator('.dc-shift.is-void')).toHaveCount(2); // the week and the legend
  await expect(mine.getByRole('table', { name: '本周班次' })).toContainText('已作废');
  await expect(mine.locator('.dc-shift-legend > span')).toHaveText(['中有效', '中待审', '中未通过', '中已作废', '中未上班']);
  await expect(mine.locator('.dc-caption')).toHaveText(/^工资：中午班每个 \d+ HTB，下午班每个 \d+ HTB。$/);
});

test('a president signs in neither their own shifts nor another president\'s; the bank admin does', async ({ page }) => {
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
  const week = page.getByRole('table', { name: '本周考勤' });
  await expect(week.getByRole('img', { name: /^王行长 / })).toHaveCount(14);
  await expect(week.getByRole('img', { name: /^李行长 / })).toHaveCount(14);
  await expect(week.getByRole('button', { name: /^(王|李)行长 / })).toHaveCount(0);

  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/attendance');
  await page.getByRole('button', { name: '上一周' }).click();
  await expect(week.getByRole('button', { name: /^(王|李)行长 / })).toHaveCount(28);
});

// Skipped until 参数 reads wealth_params of six products (PHASE-2.md §14.3, M24).
test.skip('the bank admin sets the accountant\'s pay and pays it at the accountant\'s rate', async ({ page }) => {
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
