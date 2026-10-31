import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// 学生端明细与排名 (PHASE-1.md §1.1) on the seed data (supabase/seed.sql): 张小明 (20260001, 小学部) has an opening
// balance, a deposit, a withdrawal and an exchange. Other specs change balances first, so only the structure is checked.

async function open(page: Page, label: string, path: string) {
  await page.locator('.dc-nav-item', { hasText: label }).click();
  await expect(page).toHaveURL(new RegExp(`/student/${path}$`));
}

test('明细: the history grouped by day, filtered by tab, with this month’s totals', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '明细', 'txns');
  await expect(page.locator('.dc-top-title')).toContainText('明细');

  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('期初余额');
  await expect(panel).toContainText('存款');
  await expect(panel.locator('.dc-list-title').first()).toHaveText(/^(\d{4}年)?\d{1,2}月\d{1,2}日$/);
  await expect(page.locator('.dc-card', { hasText: '本月收支' })).toContainText(/存入.*支出/);

  await page.getByRole('tab', { name: '支出' }).click();
  await expect(page.getByRole('tab', { name: '支出' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel).toContainText('取款');
  await expect(panel.locator('.dc-txn-amount small', { hasText: '存入' })).toHaveCount(0);
  await expect(panel).not.toContainText('期初余额');

  await page.getByRole('tab', { name: '存入' }).click();
  await expect(panel).toContainText('期初余额');
  await expect(panel.locator('.dc-txn-amount small', { hasText: '支出' })).toHaveCount(0);
  await expect(panel).not.toContainText('取款');
});

test('明细: a cash exchange shows under 全部 without changing the balance', async ({ page }) => {
  await signIn(page, '学生', '20260002'); // the seed's cash exchange of 海浪中性笔
  await expect(page.locator('.dc-txns')).toContainText('现金支付，余额不变');
  await open(page, '明细', 'txns');
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('.dc-txn', { hasText: '兑换 · 海浪中性笔' }).first()).toContainText('现金支付，余额不变');
  await page.getByRole('tab', { name: '支出' }).click();
  await expect(page.getByRole('tab', { name: '支出' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel).not.toContainText('余额不变');
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
