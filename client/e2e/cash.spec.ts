import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 备用金 and the 下班总结 cash table (PHASE-2.md §4, §7.1, §7.3) on the seed data: teller01 ends the seeded duty, whose
// 备用金 is set below, begins again from it with one more 10 元 note, serves 张小明 and 李思远 in cash, reverses the
// withdrawal, and the summary counts the notes the cash box should hold.
test.beforeAll(resetData);
test.use({ serviceWorkers: 'block' }); // page.route sees the app's own requests only

const teller = `(select id from public.profiles where login_id = 'teller01')`;
const search = (page: Page) => page.getByRole('searchbox', { name: '搜索学生' });
const receipt = (page: Page) => page.locator('aside[aria-label="办理单"]');
async function findStudent(page: Page, query: string, name: string) {
  await search(page).fill(query);
  await page.locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-person-name')).toHaveText(name);
}

test('上班 records the 备用金, by default the last one, and 下班总结 counts the cash by face value', async ({ page }) => {
  test.skip(!process.env.E2E_CONTAINER, 'needs the test container');
  await signIn(page, '工作人员', 'teller01');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await page.getByRole('button', { name: '下班' }).click();
  await page.locator('.dc-sheet').getByRole('button', { name: '跳过打印' }).click();
  await confirmIn(page, '确认下班');
  await expect(page.locator('section[aria-label="上下班"]')).toContainText('未上班');
  sql(`update public.cash_counts set float = '{"1":20,"2":1,"5":4,"10":2}'
    where duty_id = (select id from public.duty where user_id = ${teller} order by started_at desc limit 1)`);

  await page.locator('.dc-nav-item', { hasText: '办理' }).click();
  await page.getByRole('button', { name: '上班', exact: true }).click();
  const card = page.locator('.dc-card', { hasText: '登记备用金' });
  for (const [face, n] of [[1, 20], [2, 1], [5, 4], [10, 2]]) await expect(card.getByLabel(`${face} 元张数`)).toHaveValue(String(n));
  await expect(card.locator('.is-total dd')).toHaveText('62HTB');
  await card.getByLabel('增加一张 10 元').click();
  await expect(card.locator('.is-total dd')).toHaveText('72HTB');

  // A 备用金 the server refuses keeps the card open.
  await page.route('**/rest/v1/rpc/start_duty', (route) => route.continue({ postData: JSON.stringify({ p_float: { 1: -1 } }) }), { times: 1 });
  await page.getByRole('button', { name: '确认上班' }).click();
  await expect(page.locator('.dc-notice-danger')).toContainText('备用金张数有误');
  await expect(page.locator('.dc-notice-danger')).toContainText('每种面额填 0 或正整数。');
  await expect(card.getByLabel('10 元张数')).toHaveValue('3');
  await page.getByRole('button', { name: '确认上班' }).click();
  await expect(search(page)).toBeVisible();
  expect(sql(`select c.float from public.cash_counts c join public.duty d on d.id = c.duty_id where d.user_id = ${teller} and d.ended_at is null`))
    .toBe('{"1": 20, "2": 1, "5": 4, "10": 3}');

  // In: 17 deposited (10 + 5 + 1 + 1) and 10 for a 6 HTB pen; out: its change, 2 元 × 2. The withdrawal is reversed.
  await findStudent(page, 'zxm', '张小明');
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 5 元').click();
  await page.getByLabel('增加一张 1 元').click();
  await page.getByLabel('增加一张 1 元').click();
  await page.getByRole('button', { name: '确认存款 17 HTB' }).click();
  await receipt(page).getByRole('button', { name: '结束办理 1 笔' }).click();

  await findStudent(page, 'lsy', '李思远');
  await page.locator('.dc-seg label', { hasText: '取款' }).click();
  await page.getByPlaceholder('请输入金额').fill('13');
  await page.getByRole('button', { name: '确认取款 13 HTB' }).click();
  await confirmIn(page, '确认取款');
  await expect(receipt(page)).toContainText('取款');
  await page.locator('.dc-seg label', { hasText: '兑换' }).click();
  await page.locator('.dc-tile', { hasText: '海浪中性笔' }).click();
  await page.locator('.dc-choice', { hasText: '现金支付' }).click();
  await page.getByLabel('增加一张 10 元').click();
  await page.getByRole('button', { name: '确认兑换 6 HTB' }).click();
  await confirmIn(page, '确认兑换');
  await expect(receipt(page)).toContainText('找零 4 HTB（2 元 × 2 张）');
  await receipt(page).getByRole('button', { name: '冲正取款' }).click();
  await page.locator('.dc-sheet .dc-check', { hasText: '金额录错' }).click();
  await confirmIn(page, '确认冲正');
  await expect(receipt(page)).toContainText('取款（已冲正）');
  await receipt(page).getByRole('button', { name: /^结束办理/ }).click();

  // The summary's cash table: what came in and went out by face value, and the box short of one 2 元 note.
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await page.getByRole('button', { name: '下班' }).click();
  const cash = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/duty_cash'));
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  const part = (counts: number[], total: number) => ({
    counts: { 1: counts[0], 2: counts[1], 5: counts[2], 10: counts[3] },
    amounts: { 1: counts[0], 2: counts[1] * 2, 5: counts[2] * 5, 10: counts[3] * 10 },
    total,
  });
  expect(await (await cash).json()).toMatchObject({
    denominations: [1, 2, 5, 10],
    float: part([20, 1, 4, 3], 72),
    income: part([2, 0, 1, 2], 27),
    payout: part([0, 2, 0, 0], 4),
    expected: part([22, -1, 5, 5], 95),
  });
  await (await download).saveAs(test.info().outputPath('下班总结.pdf'));
  await confirmIn(page, '已签字，确认下班');
  await expect(page.locator('section[aria-label="上下班"]')).toContainText('未上班');
  expect(sql(`select c.expected from public.cash_counts c join public.duty d on d.id = c.duty_id where d.user_id = ${teller}
    order by d.started_at desc limit 1`)).toBe('{"1": 22, "2": -1, "5": 5, "10": 5}');
});
