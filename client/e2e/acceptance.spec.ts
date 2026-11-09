import { expect, test, type Page } from '@playwright/test';
import { confirmIn, downloadNotices, noticePassword, recordNotices, resetData, signIn } from './helpers';

// Acceptance items of PHASE-1.md §12.2 that no other spec walks through, on the seed data: 张小明 (20260001,
// balance 108, 15 HTB withdrawn today) and 王小雨 (20260003, balance 0).
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

async function findStudent(page: Page, query: string, name: string) {
  await page.getByRole('searchbox', { name: '搜索学生' }).fill(query);
  await page.locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-person-name')).toHaveText(name);
}
const pick = (page: Page, name: string) => page.locator('.dc-seg label', { hasText: name }).click();

test('取款 over the single or the daily limit cannot be confirmed and says the limit or what is left today', async ({ page }) => {
  // The bank admin lowers the primary limits to 30 a time and 50 a day.
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings');
  await page.getByLabel('小学部单笔取款上限', { exact: true }).fill('30');
  await page.getByLabel('小学部单日取款上限', { exact: true }).fill('50');
  await page.getByRole('button', { name: '保存参数' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('参数已保存');

  await signIn(page, '工作人员', 'teller01');
  await findStudent(page, '20260001', '张小明');
  await expect(page.locator('.dc-person')).toContainText('今日还可取 35 HTB');
  await pick(page, '取款');
  const amount = page.getByPlaceholder('请输入金额');
  await amount.fill('40');
  await expect(page.locator('.dc-field-hint')).toContainText('超过单笔取款限额 30 HTB');
  await expect(page.getByRole('button', { name: '金额超出可取范围' })).toBeDisabled();

  await amount.fill('30');
  await page.getByRole('button', { name: '确认取款 30 HTB' }).click();
  await page.locator('.dc-sheet').getByRole('button', { name: '确认取款' }).click();
  await expect(page.locator('.dc-person')).toContainText('今日还可取 5 HTB');
  await expect(page.locator('.dc-person')).toContainText('78');

  await page.getByPlaceholder('请输入金额').fill('10');
  await expect(page.locator('.dc-field-hint')).toContainText('超过今日取款限额：今日还可取款 5 HTB');
  await expect(page.getByRole('button', { name: '金额超出可取范围' })).toBeDisabled();
});

test('with too little balance, 取款 and an exchange from the account show the balance and the shortfall', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await findStudent(page, '王小雨', '王小雨');
  await expect(page.locator('.dc-person-side')).toContainText('0');

  await pick(page, '取款');
  await page.getByPlaceholder('请输入金额').fill('5');
  await expect(page.locator('.dc-field-hint')).toContainText('余额不足：可用余额 0 HTB，还差 5 HTB');
  await expect(page.getByRole('button', { name: '金额超出可取范围' })).toBeDisabled();

  await pick(page, '兑换');
  await page.locator('.dc-tile', { hasText: '海豚书签' }).click();
  await expect(page.getByRole('button', { name: '余额不足，还差 10 HTB' })).toBeDisabled();
});

test('财务, 库管 and 运维员 first see their 总览', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await recordNotices(page);
  const logins: [string, string, string][] = [['acct31', '财务小郑', '财务'], ['keep31', '库管小吴', '库管']];
  const passwords: string[] = [];
  for (const [login, name, role] of logins) {
    await page.goto('/admin/staff/new');
    await page.getByPlaceholder('如 teller02').fill(login);
    await page.getByPlaceholder('如 柜员小王').fill(name);
    await page.getByRole('combobox').selectOption({ label: role });
    await page.getByRole('button', { name: '创建账号' }).click();
    await downloadNotices(page);
    passwords.push(await noticePassword(page, login));
    await confirmIn(page, '取消');
  }
  for (const [i, [login]] of logins.entries()) {
    await signIn(page, '工作人员', login, '/login?add=1', passwords[i]);
    await expect(page).toHaveURL(/\/change-password$/);
    await page.getByPlaceholder('至少 8 位').fill('20262031');
    await page.getByPlaceholder('再次输入新密码').fill('20262031');
    await page.getByRole('button', { name: '设置密码' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator('.dc-top-title')).toContainText('总览');
  }
  await signIn(page, '工作人员', 'ops01');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('.dc-top-title')).toContainText('总览');
});

test('日志 names who did it, when, and on which device', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/audit');
  const entry = page.locator('section[aria-label="操作日志"] .dc-txn', { hasText: '修改参数' }).first();
  await expect(entry).toContainText('银行管理员 · ');
  await expect(entry).toContainText(/\d+月\d+日 \d{2}:\d{2}/);
  // Each test runs in a new browser, i.e. a new device: the first test's one made this change.
  await expect(entry).toContainText(/设备 [0-9a-f]{8} · IP \S+/);
});
