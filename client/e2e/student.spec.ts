import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn } from './helpers';

// 学生端明细与排名 (PHASE-1.md §1.1) on the seed data (supabase/seed.sql): 张小明 (20260001, 小学部) has an opening
// balance, a deposit, a withdrawal and an exchange.
test.beforeAll(resetData);

// The visible 主导航: the side navigation on wider screens, the bottom TabBar on phones.
async function open(page: Page, label: string, path: string) {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/student/${path}$`));
}

test('明细: the history grouped by day, by type, found by a product or a 交易号, with this month’s totals', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '明细', 'txns');
  await expect(page.locator('.dc-top-title')).toContainText('明细');

  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('期初余额');
  await expect(panel).toContainText('存款');
  await expect(panel.locator('.dc-list-title').first()).toHaveText(/^(\d{4}年)?\d{1,2}月\d{1,2}日$/);
  const month = page.locator('.dc-card', { hasText: '本月收支' });
  await expect(month).toContainText(/存款25/);
  await expect(month).toContainText(/取款15/);
  await expect(month).toContainText(/兑换22/);

  await page.getByRole('tab', { name: '取款' }).click();
  await expect(page.getByRole('tab', { name: '取款' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('.dc-txn')).toHaveCount(1);
  await expect(panel).toContainText('取款');
  await page.getByRole('tab', { name: '兑换' }).click();
  await expect(panel.locator('.dc-txn')).toHaveCount(1);
  await expect(panel).toContainText('海豚书签');
  await expect(panel).not.toContainText('取款');

  await page.getByRole('tab', { name: '全部' }).click();
  await page.getByRole('searchbox', { name: '搜索交易号或商品' }).fill('书签');
  await expect(panel.locator('.dc-txn')).toHaveCount(1);
  await page.getByRole('searchbox', { name: '搜索交易号或商品' }).fill('没有这件');
  await expect(panel).toContainText('没有符合条件的交易');
});

test('明细: a cash exchange shows under 兑换 without changing the balance, and in the month’s 兑换', async ({ page }) => {
  await signIn(page, '学生', '20260002'); // the seed's cash exchange of 海浪中性笔
  await expect(page.locator('.dc-txns')).toContainText('现金支付，余额不变');
  await open(page, '明细', 'txns');
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('.dc-txn', { hasText: '兑换 · 海浪中性笔' }).first()).toContainText('现金支付，余额不变');
  await page.getByRole('tab', { name: '兑换' }).click();
  await expect(page.getByRole('tab', { name: '兑换' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('.dc-txn', { hasText: '兑换 · 海浪中性笔' }).first()).toContainText('现金支付，余额不变');
  await expect(page.locator('.dc-card', { hasText: '本月收支' })).toContainText(/兑换6/);
});

test('排名: my place first, then the division’s list with my row tagged and names masked', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '排名', 'ranking');
  await expect(page.locator('.dc-top-title')).toContainText('存款排名');
  await expect(page.locator('.dc-top-sub')).toHaveText('小学部');

  await expect(page.locator('.dc-balance')).toContainText('我的名次');
  await expect(page.locator('.dc-balance')).toContainText(/第 \d+ 名/);
  await expect(page.locator('.dc-balance')).toContainText(/余额 [\d,]+ HTB/);

  const mine = page.locator('.dc-txn', { has: page.locator('.dc-tag', { hasText: '我' }) });
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.dc-txn-title')).toContainText('张*明');
  await expect(page.locator('.dc-txn-title').filter({ hasNotText: '*' })).toHaveCount(0);
});
