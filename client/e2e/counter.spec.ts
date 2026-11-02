import { expect, test, type Page } from '@playwright/test';
import { confirmIn, endDuty, resetData, signIn } from './helpers';

// The counter (M3, PHASE-1.md §7.5–7.7) on the seed data (supabase/seed.sql): teller01 serves 张小明 (20260001,
// balance 108) and 李思远 (20260002, balance 70). Tests run in order and each one builds on the balances before it.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

// A visit starts by searching (number, name, pinyin, initials or class) and tapping the student.
async function findStudent(page: Page, query: string, name: string) {
  await page.getByRole('searchbox', { name: '搜索学生' }).fill(query);
  await page.locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-person-name')).toHaveText(name);
}

const pick = (page: Page, name: string) => page.locator('.dc-seg label', { hasText: name }).click();
const receipt = (page: Page) => page.locator('aside[aria-label="办理单"]');
const reverse = async (page: Page, reason: string) => {
  await page.locator('.dc-sheet .dc-check', { hasText: reason }).click();
  await confirmIn(page, '确认冲正');
};

test('one visit: deposit, then an exchange from the account, then back to the search', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await findStudent(page, 'zxm', '张小明');
  await expect(page.locator('.dc-person')).toContainText('108');
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 2 元').click();
  await expect(receipt(page)).toContainText('办理后余额130 HTB');
  await page.getByRole('button', { name: '确认存款 22 HTB' }).click();
  await expect(receipt(page)).toContainText('10 元 × 2 张、2 元 × 1 张 · HT');
  await expect(page.locator('.dc-person')).toContainText('130');

  await pick(page, '兑换');
  await page.locator('.dc-tile', { hasText: '海豚书签' }).click();
  await page.getByRole('button', { name: '确认兑换 10 HTB' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('扣款后余额120 HTB');
  await confirmIn(page, '确认兑换');
  await expect(page.locator('.dc-person')).toContainText('120');

  await receipt(page).getByRole('button', { name: '结束办理（已办 2 笔）' }).click();
  const summary = page.locator('.dc-notice-success');
  await expect(summary).toContainText('张小明：办理完成');
  await expect(summary).toContainText('存款 +22；兑换 海豚书签 × 1 −10。当前余额 120 HTB');
  await expect(page.getByRole('searchbox', { name: '搜索学生' })).toBeFocused();
  await expect(page.locator('ul[aria-label="今天办理过的学生"]')).toContainText('张小明');
});

test('one visit: withdraw within the limits, a cash exchange, and 冲正 from the 办理单', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await findStudent(page, '李思远', '李思远');
  await pick(page, '取款');
  const amount = page.getByPlaceholder('请输入金额');
  await amount.fill('80');
  await expect(page.getByRole('button', { name: '金额超出可取范围' })).toBeDisabled();
  await expect(page.locator('.dc-field-hint')).toContainText('余额不足');
  await amount.fill('28');
  await expect(page.locator('.dc-field-hint')).toContainText('10 元 × 2 张、5 元 × 1 张、2 元 × 1 张、1 元 × 1 张');
  await page.getByRole('button', { name: '确认取款 28 HTB' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('10 元 × 2 张、5 元 × 1 张、2 元 × 1 张、1 元 × 1 张');
  await confirmIn(page, '确认取款');
  await expect(receipt(page)).toContainText('取款');
  await expect(page.locator('.dc-person')).toContainText('42');

  await pick(page, '兑换');
  await page.locator('.dc-tile', { hasText: '海浪中性笔' }).click();
  await page.locator('.dc-choice', { hasText: '现金支付' }).click();
  await expect(page.getByRole('button', { name: '收款不足，还差 6 HTB' })).toBeDisabled();
  await page.getByLabel('增加一张 10 元').click();
  await page.getByRole('button', { name: '确认兑换 6 HTB' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('现金支付');
  await expect(page.locator('.dc-sheet')).toContainText('找零4 HTB（2 元 × 2 张）');
  await confirmIn(page, '确认兑换');
  await expect(receipt(page)).toContainText('现金收 10 HTB，找零 4 HTB（2 元 × 2 张）');

  // A wrong exchange is put right where it shows: the pen goes back to stock, the balance stays.
  await receipt(page).getByRole('button', { name: '冲正兑换 海浪中性笔 × 1' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('李思远 · 兑换 海浪中性笔 × 1 现金');
  await reverse(page, '业务选错');
  await expect(receipt(page)).toContainText('兑换 海浪中性笔 × 1（已冲正）');
  await expect(receipt(page).getByRole('button', { name: '结束办理（已办 1 笔）' })).toBeVisible();
  await expect(page.locator('.dc-person')).toContainText('42');
});

test('今日业务: today\'s totals, 冲正 of the deposit, and back to that student', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await page.locator('.dc-nav-item', { hasText: '今日业务' }).click();
  await expect(page).toHaveURL(/\/counter\/today$/);
  // The seed has deposits of its own today, so the totals are read first and must drop by this one.
  const deposits = page.locator('aside[aria-label="今日合计"] .dc-kv > div', { hasText: '存款' }).locator('dd');
  await expect(deposits).toHaveText(/^\d+ 笔 · \d+ HTB$/);
  const [count, sum] = (await deposits.innerText()).match(/\d+/g)!.map(Number);
  const deposit = page.locator('.dc-txn', { hasText: '张小明 · 存款 22 HTB' });
  await deposit.getByRole('button', { name: /^冲正/ }).click();
  await reverse(page, '金额录错');
  await expect(page.locator('.dc-notice-success')).toContainText('当前余额 98 HTB');
  await expect(deposit).toContainText('（已冲正）');
  await expect(deposit.getByRole('button', { name: /^冲正/ })).toHaveCount(0);
  await expect(deposits).toHaveText(`${count - 1} 笔 · ${sum - 22} HTB`);

  await deposit.getByRole('link', { name: '为张小明继续办理' }).click();
  await expect(page).toHaveURL(/\/counter\?s=20260001$/);
  await expect(page.locator('.dc-person')).toContainText('98');
});

test('offline deposit is registered, then uploaded once online', async ({ page, context }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.waitForLoadState('networkidle'); // the roster is kept for offline searches
  await context.setOffline(true);
  await expect(page.locator('.dc-notice', { hasText: '离线登记' })).toBeVisible();
  await findStudent(page, '20260002', '李思远');
  await expect(page.getByRole('radio', { name: '取款' })).toBeDisabled();
  await page.getByLabel('增加一张 5 元').click();
  await expect(receipt(page)).toContainText('办理后余额待上传');
  await page.getByRole('button', { name: '确认存款 5 HTB' }).click();
  await expect(receipt(page)).toContainText('存款（离线登记）');
  await expect(receipt(page)).toContainText('联网后入账');
  await expect(receipt(page).getByRole('button', { name: /^冲正/ })).toHaveCount(0);

  await context.setOffline(false);
  await receipt(page).getByRole('button', { name: '结束办理（已办 1 笔）' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText('存款（离线登记） +5');
  await expect(page.locator('.dc-notice', { hasText: '有 1 笔离线存款待上传' })).toBeVisible();
  await page.getByRole('button', { name: '上传' }).click();
  await expect(page.locator('.dc-notice', { hasText: '待上传' })).toHaveCount(0);
  await findStudent(page, 'lsy', '李思远');
  await expect(page.locator('.dc-person')).toContainText('47');
});

test('the counter reopens without a network once installed', async ({ page, context }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  const registered = await page.evaluate(() =>
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => 'ready', (e) => String(e)));
  expect(registered).toBe('ready');
  await page.reload(); // served through the service worker, which also keeps /config.js
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.dc-top-title')).toContainText('办理');
  await expect(page.locator('.dc-notice', { hasText: '离线登记' })).toBeVisible();
  await context.setOffline(false);
});

test('切换账号 is the login page with this device’s accounts; 退出账号 comes back to it', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01', '/login', undefined, true);
  await expect(page).toHaveURL(/\/counter$/);
  await signIn(page, '学生', '20260001', '/login?add=1');
  await expect(page).toHaveURL(/\/student$/);

  // 我的 holds 切换账号 and 退出账号; 切换账号 opens the login page with the accounts above the form.
  await page.goto('/student/me');
  await page.locator('.dc-list-link', { hasText: '切换账号' }).click();
  await expect(page).toHaveURL(/\/login\?add=1$/);
  await expect(page.locator('.dc-login-title')).toHaveText('切换账号');
  const accounts = page.getByRole('list', { name: '本机账号' });
  await expect(accounts.getByRole('button', { name: '保存登录' })).toHaveAttribute('aria-pressed', 'false');
  await accounts.locator('.dc-list-link', { hasText: '柜员小林' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('你是柜员小林吗？');
  await confirmIn(page, '是，切换');
  await expect(page).toHaveURL(/\/counter$/);

  // 张小明 was not saved: switching back asks for the password.
  await page.goto('/login?add=1');
  await accounts.locator('.dc-list-link', { hasText: '张小明' }).click();
  await page.locator('.dc-sheet input[type="password"]').fill('a12345678');
  await confirmIn(page, '切换');
  await expect(page).toHaveURL(/\/student$/);

  // Turning saving off asks for the password.
  await page.goto('/login?add=1');
  await accounts.locator('.dc-list-link', { hasText: '柜员小林' }).click();
  await confirmIn(page, '是，切换');
  await expect(page).toHaveURL(/\/counter$/);
  await page.goto('/login?add=1');
  await accounts.getByRole('button', { name: '保存登录' }).click();
  await page.locator('.dc-sheet input[type="password"]').fill('a12345678');
  await confirmIn(page, '确认关闭');
  await expect(accounts.getByRole('button', { name: '保存登录' })).toHaveAttribute('aria-pressed', 'false');

  // 退出账号 comes back to 切换账号, where the other account is a tap and its password away.
  await page.goto('/counter/me');
  await page.locator('.dc-list-link', { hasText: '退出账号' }).click();
  await confirmIn(page, '退出登录');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.dc-login-title')).toHaveText('切换账号');
  await expect(accounts).not.toContainText('柜员小林');
  await accounts.locator('.dc-list-link', { hasText: '张小明' }).click();
  await page.locator('.dc-sheet input[type="password"]').fill('a12345678');
  await confirmIn(page, '切换');
  await expect(page).toHaveURL(/\/student$/);
});

test('the student sees the counter\'s work', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page.locator('.dc-balance-amount')).toContainText('98');
  await expect(page.locator('.dc-txns')).toContainText('兑换 · 海豚书签');
  await expect(page.locator('.dc-txns')).toContainText('（已冲正）');
});

test('下班 may skip printing the summary, and 办理 waits for 上班 again', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await endDuty(page, true);
  await page.locator('.dc-nav-item', { hasText: '办理' }).click();
  await expect(page.locator('.dc-empty', { hasText: '未上班' })).toBeVisible();
  await page.getByRole('button', { name: '上班' }).click();
  await expect(page.getByRole('searchbox', { name: '搜索学生' })).toBeVisible();
});
