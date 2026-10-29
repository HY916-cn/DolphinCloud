import { expect, test, type Page } from '@playwright/test';

// The counter (M3, PHASE-1.md §7.5–7.7) on the seed data (supabase/seed.sql): teller01 serves 张小明 (20260001,
// balance 108) and 李思远 (20260002, balance 70). Tests run in order and each one builds on the balances before it.
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page, kind: '学生' | '工作人员', id: string, path = '/login') {
  await page.goto(path);
  await page.locator('.dc-seg label', { hasText: kind }).click();
  await page.getByPlaceholder(kind === '学生' ? '请输入学号' : '请输入账号').fill(id);
  await page.getByPlaceholder('请输入密码').fill('a12345678');
  await page.getByRole('button', { name: '登录' }).click();
}

const confirmIn = (page: Page, name: string) => page.locator('.dc-sheet').getByRole('button', { name }).click();

// Step 1: search (number, name, pinyin, initials or class), pick the student, confirm it is them.
async function findStudent(page: Page, query: string, name: string) {
  await page.getByRole('searchbox', { name: '搜索学生' }).fill(query);
  await page.locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-sheet')).toContainText(`是${name}吗？`);
  await confirmIn(page, '是，继续办理');
}

// Opens a counter business from the navigation and waits for its page, so typing goes to the right form.
async function open(page: Page, label: string, path: string) {
  await page.locator('.dc-nav-item', { hasText: label }).click();
  await expect(page).toHaveURL(new RegExp(`/counter/${path}$`));
  await expect(page.locator('.dc-top-title')).toContainText(label);
}


test('deposit counts the notes and books the total', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await expect(page.locator('.dc-card')).toContainText('今天我办理的业务');
  await open(page, '存款', 'deposit');
  await findStudent(page, 'zxm', '张小明');
  await expect(page.locator('.dc-person')).toContainText('张小明');
  await expect(page.locator('.dc-person')).toContainText('108');
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 2 元').click();
  await page.getByRole('button', { name: '确认存款' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('为 张小明 存款 22 HTB');
  await confirmIn(page, '确认存款');
  await expect(page.locator('.dc-result')).toContainText('存款成功');
  await expect(page.locator('.dc-result')).toContainText('存入 22 HTB，当前余额 130 HTB');
});

test('withdraw stops at the balance and shows the payout', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await open(page, '取款', 'withdraw');
  await findStudent(page, '李思远', '李思远');
  const amount = page.getByPlaceholder('请输入金额');
  await amount.fill('80');
  await expect(page.getByRole('button', { name: '金额超出可取范围' })).toBeDisabled();
  await expect(page.locator('.dc-field-hint')).toContainText('余额不足');
  await amount.fill('28');
  await expect(page.locator('.dc-field-hint')).toContainText('10 元 × 2 张、5 元 × 1 张、2 元 × 1 张、1 元 × 1 张');
  await page.getByRole('button', { name: '确认取款' }).click();
  await confirmIn(page, '确认取款');
  await expect(page.locator('.dc-result')).toContainText('取款 28 HTB，当前余额 42 HTB');
});

test('exchange from the account and in cash with change', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await open(page, '兑换', 'shop');
  await findStudent(page, '20260001', '张小明');
  await page.locator('.dc-tile', { hasText: '海豚书签' }).click();
  await page.getByRole('button', { name: '确认兑换' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('账户扣款 10 HTB');
  await confirmIn(page, '确认兑换');
  await expect(page.locator('.dc-result')).toContainText('账户支付 10 HTB，当前余额 120 HTB');

  await page.getByRole('button', { name: '办理下一位' }).click();
  await findStudent(page, 'lisi', '李思远');
  await page.locator('.dc-tile', { hasText: '海浪中性笔' }).click();
  await page.locator('.dc-choice', { hasText: '现金支付' }).click();
  await expect(page.getByRole('button', { name: '收款不足，还差 6 HTB' })).toBeDisabled();
  await page.getByLabel('增加一张 10 元').click();
  await page.getByRole('button', { name: '确认兑换' }).click();
  await confirmIn(page, '确认兑换');
  await expect(page.locator('.dc-result')).toContainText('现金收款 10 HTB，找零 4 HTB');
  await expect(page.locator('.dc-result')).toContainText('2 元 × 2 张');
});

test('reversal of today\'s deposit restores the balance', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await open(page, '冲正', 'reversal');
  await page.locator('.dc-list-link', { hasText: '存款 22 HTB' }).click();
  await page.locator('.dc-check', { hasText: '金额录错' }).click();
  await page.getByRole('button', { name: '确认冲正' }).click();
  await confirmIn(page, '确认冲正');
  await expect(page.locator('.dc-result')).toContainText('冲正成功');
  await expect(page.locator('.dc-result')).toContainText('当前余额 98 HTB');
  await page.getByRole('button', { name: '返回列表' }).click();
  await expect(page.locator('.dc-list-link', { hasText: '存款 22 HTB' })).toHaveCount(0);
});

test('offline deposit is registered, then uploaded once online', async ({ page, context }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.waitForLoadState('networkidle'); // the roster is kept for offline searches
  await open(page, '存款', 'deposit');
  await context.setOffline(true);
  await expect(page.locator('.dc-notice', { hasText: '离线登记' })).toBeVisible();
  await findStudent(page, '20260002', '李思远');
  await expect(page.locator('.dc-person')).toContainText('李思远');
  await page.getByLabel('增加一张 5 元').click();
  await page.getByRole('button', { name: '确认存款' }).click();
  await confirmIn(page, '确认存款');
  await expect(page.locator('.dc-result')).toContainText('登记 5 HTB，联网后入账');

  await context.setOffline(false);
  await page.getByRole('button', { name: '办理下一位' }).click();
  await expect(page.locator('.dc-notice', { hasText: '有 1 笔离线存款待上传' })).toBeVisible();
  await page.getByRole('button', { name: '上传' }).click();
  await expect(page.locator('.dc-notice', { hasText: '待上传' })).toHaveCount(0);
  await open(page, '查询', 'lookup');
  await findStudent(page, 'lsy', '李思远');
  await expect(page.locator('.dc-kv')).toContainText('47 HTB');
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
  await expect(page.locator('.dc-top-title')).toContainText('总览');
  await expect(page.locator('.dc-notice', { hasText: '离线登记' })).toBeVisible();
  await context.setOffline(false);
});

test('switching accounts asks who you are first', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await signIn(page, '学生', '20260001', '/login?add=1');
  await expect(page).toHaveURL(/\/student$/);
  await page.goto('/accounts');
  await page.locator('.dc-list-link', { hasText: '柜员小林' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('你是柜员小林吗？');
  await confirmIn(page, '是，切换');
  await expect(page).toHaveURL(/\/counter$/);
});

test('the student sees the counter\'s work', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page.locator('.dc-balance-amount')).toContainText('98');
  await expect(page.locator('.dc-txns')).toContainText('兑换 · 海豚书签');
  await expect(page.locator('.dc-txns')).toContainText('（已冲正）');
});
