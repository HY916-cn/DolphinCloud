import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn } from './helpers';

// 学生端首页、明细、排名与我的 (PHASE-1.md §1.1) on the seed data (supabase/seed.sql): 张小明 (20260001, 小学部) has an
// opening balance of 120 from 20 days ago, then a deposit of 25, a withdrawal of 15 and an exchange of 22: 108 now, the
// first of the two 小学部 students.
test.beforeAll(resetData);

// The visible 主导航: the side navigation on wider screens, the bottom TabBar on phones.
async function open(page: Page, label: string, path: string) {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/student/${path}$`));
}

test('首页: the open 存折 with the account, the balance, this term’s money and the latest printed lines, and my place', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  const book = page.locator('.dc-passbook');
  await expect(book.locator('.dc-pb-fields').first()).toContainText('账号20260001');
  await expect(book.locator('.dc-pb-balance dd')).toHaveText('108HTB');
  await expect(book.locator('.dc-pb-sums')).toContainText('本学期支出−37');
  const lines = book.getByRole('region', { name: '交易记录' }).locator('.dc-txn');
  await expect(lines).toHaveCount(4);
  // Newest first, each line with the balance after it: 22 taken out leaves 108, the opening 120 is the last line.
  await expect(lines.first().locator('td.is-out')).toHaveText('22');
  await expect(lines.first().locator('td').last()).toHaveText('108');
  await expect(lines.last().locator('td').last()).toHaveText('120');
  const place = page.getByRole('link', { name: '存款排名第 1 名，查看排名' });
  await expect(place).toContainText('小学部第 1 名');
  await expect(place).toContainText('你是小学部第 1 名');
  await place.click();
  await expect(page).toHaveURL(/\/student\/ranking$/);
});

test('明细: the 存折 pages by type, found by a product or a 交易号, with this month’s money', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '明细', 'txns');
  await expect(page.locator('.dc-top-title')).toContainText('明细');

  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('期初余额');
  await expect(panel).toContainText('存款');
  await expect(panel.locator('.dc-txn td.is-date').first()).toHaveText(/^\d{2}-\d{2}(\d{4}年|\d{2}:\d{2})$/);
  await expect(panel.locator('.dc-txn').first().locator('td').last()).toHaveText('108');
  // Last month's closing balance, money in and money out add up to the balance now.
  const month = page.locator('.dc-card', { hasText: /\d+月收支/ });
  await expect(month).toContainText('支出−37');
  await expect(month).toContainText('当前余额108HTB');
  const [opening, saved] = await month.locator('dd').evaluateAll((dd) => dd.slice(0, 2).map((d) => Number(d.textContent!.replace(/[^\d]/g, ''))));
  expect(opening + saved - 37).toBe(108);

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

test('明细: a cash exchange shows under 兑换 without changing the balance', async ({ page }) => {
  await signIn(page, '学生', '20260002'); // the seed's cash exchange of 海浪中性笔
  await expect(page.locator('.dc-pb-table')).toContainText('现金支付，余额不变');
  await open(page, '明细', 'txns');
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('.dc-txn', { hasText: '兑换 · 海浪中性笔' }).first()).toContainText('现金支付，余额不变');
  await page.getByRole('tab', { name: '兑换' }).click();
  await expect(page.getByRole('tab', { name: '兑换' })).toHaveAttribute('aria-selected', 'true');
  await expect(panel.locator('.dc-txn', { hasText: '兑换 · 海浪中性笔' }).first()).toContainText('现金支付，余额不变');
  await expect(page.locator('.dc-card', { hasText: /\d+月收支/ })).toContainText('支出0');
});

test('排名: my place on the scale, the podium with my place tagged and names masked, and how it is made', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '排名', 'ranking');
  await expect(page.locator('.dc-top-title')).toContainText('存款排名');
  await expect(page.locator('.dc-top-sub')).toHaveText('小学部');

  const card = page.locator('.dc-rank-card');
  await expect(card).toContainText('我的名次');
  await expect(card.locator('.dc-rank-place')).toHaveText('第 1 名余额 108 HTB');
  await expect(card.getByRole('img')).toHaveAttribute('aria-label', '在小学部 2 人中排第 1 名');
  await expect(card).toContainText('超过了小学部 1 位同学');

  const podium = page.getByRole('list', { name: '前三名' });
  await expect(podium.getByRole('listitem')).toHaveCount(2);
  const mine = podium.locator('[aria-current]');
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.dc-rank-name')).toContainText('张*明');
  await expect(mine).toContainText('108HTB');
  await expect(page.locator('.dc-rank-name').filter({ hasNotText: '*' })).toHaveCount(0);
  await expect(page.locator('.dc-card', { hasText: '排名怎么算' })).toContainText('小学部在读 2 人');
});

test('我的: my closed 存折 with my name on its label, and my account’s balance, division, status and term', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '我的', 'me');
  await expect(page.locator('.dc-pb-cover .dc-pb-name')).toHaveText('张小明');
  await expect(page.locator('.dc-pb-cover')).toContainText('账号20260001');
  const account = page.locator('.dc-card', { hasText: '我的账户' });
  await expect(account).toContainText('当前余额108HTB');
  await expect(account).toContainText('学部小学部');
  await expect(account).toContainText('账户状态在读');
  await expect(account).toContainText('本学期支出−37');
});
