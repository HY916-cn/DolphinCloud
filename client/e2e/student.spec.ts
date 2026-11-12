import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn, sql } from './helpers';

// 学生端首页、明细、排名与我的 (PHASE-1.md §1.1) on the seed data (supabase/seed.sql): 张小明 (20260001, 小学部) has an
// opening balance of 120 from 20 days ago, then a deposit of 25, a withdrawal of 15 and an exchange of 22: 108 now, the
// first of the two 小学部 students.
test.beforeAll(resetData);

// The visible 主导航: the side navigation on wider screens, the bottom TabBar on phones.
async function open(page: Page, label: string, path: string) {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/student/${path}$`));
}

test('首页: the balance with this term’s money, my place with the students around me, and the latest businesses', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-top-sub')).toHaveText('四年级(1)班 · 学号 20260001');
  await expect(page.locator('.dc-balance-amount')).toHaveText('108HTB');
  await expect(page.locator('.dc-balance-split')).toContainText('本学期支出 −37');
  const lines = page.locator('.dc-txns .dc-txn');
  await expect(lines).toHaveCount(4);
  await expect(lines.first()).toContainText('−22');
  await expect(lines.last()).toContainText('期初余额');
  const rank = page.locator('.dc-rank-card');
  await expect(rank.locator('.dc-rank-place')).toHaveText('第 1 名小学部 2 人');
  await expect(rank).toContainText('你是小学部第 1 名');
  await rank.getByRole('link', { name: '查看排名' }).click();
  await expect(page).toHaveURL(/\/student\/ranking$/);
});

test('明细: every business by day and by type, found by a product or a 交易号, with this month’s money', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '明细', 'txns');
  await expect(page.locator('.dc-top-title')).toContainText('明细');

  const panel = page.getByRole('tabpanel');
  await expect(panel).toContainText('期初余额');
  await expect(panel).toContainText('存款');
  await expect(panel.locator('.dc-list-title').first()).toHaveText(/^(\d{4}年)?\d{1,2}月\d{1,2}日$/);
  await expect(panel.locator('.dc-txn').first()).toContainText('−22');
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
  await expect(page.locator('.dc-txns')).toContainText('现金支付，余额不变');
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
  await expect(card.locator('.dc-rank-place')).toHaveText('第 1 名存款 108 HTB');
  await expect(card.getByRole('img')).toHaveAttribute('aria-label', '在小学部 2 人中排第 1 名');
  await expect(card).toContainText('超过了小学部 1 位同学');

  const podium = page.getByRole('list', { name: '前三名' });
  await expect(podium.getByRole('listitem')).toHaveCount(2);
  const mine = podium.locator('[aria-current]');
  await expect(mine).toHaveCount(1);
  await expect(mine.locator('.dc-rank-name')).toContainText('张*明');
  await expect(mine).toContainText('108HTB');
  await expect(page.locator('.dc-rank-name').filter({ hasNotText: '*' })).toHaveCount(0);
});

test('我的: who I am, 页面样式 to the 存折版, and my account’s balance, division, status and term', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await open(page, '我的', 'me');
  await expect(page.locator('.dc-person-name')).toHaveText('张小明');
  await expect(page.locator('.dc-person-meta')).toHaveText('四年级(1)班 · 学号 20260001');
  const account = page.locator('.dc-card', { hasText: '我的账户' });
  await expect(account).toContainText('当前余额108HTB');
  await expect(account).toContainText('学部小学部');
  await expect(account).toContainText('账户状态在读');
  await expect(account).toContainText('本学期支出−37');
  const style = page.getByRole('group', { name: '页面样式' });
  await expect(style.getByRole('radio', { name: /普通版/ })).toBeChecked();
  await style.getByText('存折版').click();
  await expect(page).toHaveURL(/\/book$/);
  await expect(page.locator('.dc-book-open')).toBeVisible();
});

test('信用: five entries in the navigation, my score on the gauge from 首页, and its changes 20 at a time', async ({ page }) => {
  // 25 older weekly changes, then a −5 and a +8: 603 now.
  sql(`insert into public.credit_events (student_no, at, delta, score, rule, reason)
         select '20260001', now() - interval '30 days' + g * interval '1 hour', 1, 591 + g % 2, 'deposit_week', '上周有存款'
         from generate_series(1, 25) g;
       insert into public.credit_events (student_no, at, delta, score, rule, reason) values
         ('20260001', now() - interval '2 days', -5, 595, 'withdraw_half', '上周取款合计超过上周初余额的一半'),
         ('20260001', now() - interval '1 day', 8, 603, 'manual', '银行管理员调整：值日认真');
       update public.credit_scores set score = 603 where student_no = '20260001';`);
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link')).toHaveText(['首页', '明细', '信用', '排名', '我的']);

  // 首页: the medium gauge, a link to 信用.
  const summary = page.getByRole('link', { name: '海豚信用分 603 分，查看信用' });
  await expect(summary.getByRole('meter', { name: '海豚信用分' })).toHaveAttribute('aria-valuenow', '603');
  await expect(summary).toContainText('贷款额度 130 HTB');
  await summary.click();
  await expect(page).toHaveURL(/\/student\/credit$/);

  const gauge = page.locator('.dc-gauge.is-lg');
  await expect(gauge.getByRole('meter')).toHaveAttribute('aria-valuetext', '海豚信用分 603 分');
  await expect(gauge.locator('.dc-gauge-score')).toHaveText('603分');
  await expect(gauge.locator('.dc-gauge-foot')).toHaveText('贷款额度 130 HTB');
  await expect(gauge.locator('.dc-gauge-next')).toHaveText('再涨 1 分，额度加 5 HTB');
  await expect(gauge.locator('.dc-gauge-ends')).toHaveText('01000');

  const rows = page.locator('.dc-txns .dc-txn');
  await expect(rows).toHaveCount(20);
  await expect(rows.nth(0)).toContainText('银行管理员调整：值日认真');
  await expect(rows.nth(0)).toContainText('变动后 603 分');
  await expect(rows.nth(0).locator('.dc-txn-amount')).toHaveText('+8加分');
  await expect(rows.nth(1).locator('.dc-txn-amount')).toHaveText('−5减分');
  await page.getByRole('button', { name: '加载更多' }).click();
  await expect(rows).toHaveCount(27);
  await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);
});
