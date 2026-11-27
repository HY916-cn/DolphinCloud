import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn, sql } from './helpers';

// 学生「利息」(design system StudentInterestPage) on the seed data with no anchor published (活期 at 2%): 张小明 (20260001)
// had 1.00 HTB five weeks ago, paid in by its 利息; 2.48 HTB last week, paid in as 2 HTB with 0.48 left over; 1.40 HTB
// this Monday and a correction of +0.12 HTB to last Sunday not yet paid in: 2.00 HTB saved up.
test.describe.configure({ mode: 'serial' });
const MONDAY = `date_trunc('week', now() at time zone 'Asia/Shanghai')::date`;
const md = (date: string) => sql(`select to_char(${date}, 'FMMM月FMDD日')`);
test.beforeAll(() => {
  resetData();
  sql(`insert into public.interest_accruals (student_no, day, balance, rate, centi) values ('20260001', ${MONDAY} - 35, 352, 2, 100);
       select app_private.settle_interest((${MONDAY} - 28)::timestamp at time zone 'Asia/Shanghai');
       insert into public.interest_accruals (student_no, day, balance, rate, centi) values
         ('20260001', ${MONDAY} - 2, 415, 2.13, 126), ('20260001', ${MONDAY} - 1, 412, 2.08, 122);
       select app_private.settle_interest(${MONDAY}::timestamp at time zone 'Asia/Shanghai');
       insert into public.interest_accruals (student_no, day, balance, rate, centi) values ('20260001', ${MONDAY}, 461, 2.13, 140);
       insert into public.interest_adjustments (student_no, day, txn_id, balance, centi)
         select '20260001', ${MONDAY} - 1, id, 452, 12 from public.txns where student_no = '20260001' and type = 'interest' limit 1;`);
});

const card = (page: Page) => page.getByRole('region', { name: '攒着的利息' });
const group = (page: Page, title: string) => page.locator('section', { has: page.locator('.dc-list-title', { hasText: title }) });

test('首页「攒着的利息」opens 利息: the card adds up, each day by week, the correction last', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  const row = page.locator('.dc-credit-summary .dc-kv > div.is-link');
  await expect(row).toHaveText('攒着的利息2.00 HTB下周一存进余额');
  await row.getByRole('link', { name: '攒着的利息 2.00 HTB，查看利息' }).click();
  await expect(page).toHaveURL(/\/student\/interest$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('利息');
  // Still under 首页.
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '首页' }).first()).toHaveAttribute('aria-current', 'page');

  await expect(card(page).locator('.amount')).toHaveText('2.00HTB');
  await expect(card(page).locator('> .dc-caption')).toHaveText('下周一存进余额');
  await expect(card(page).locator('.dc-kv > div')).toHaveText(['本周活期利率2%/周', '本周已计+1.40 HTB', '利息更正+0.12 HTB', '之前留下的零头0.48 HTB']);
  await expect(page.getByRole('heading', { name: '怎么计息' })).toBeVisible();
  await expect(page.getByText('活期暂停计息')).toHaveCount(0);

  const thisWeek = group(page, '本周');
  await expect(thisWeek.locator('.dc-list-head .dc-caption')).toHaveText('+1.52 HTB · 还攒着');
  await expect(thisWeek.locator('.dc-list-item')).toHaveText([
    `${md(MONDAY)} 星期一余额 461 HTB · 2.13%/周+1.40 HTB`,
    `利息更正${md(`${MONDAY} - 1`)}的利息 · 余额改为 452 HTB+0.12 HTB`,
  ]);
  const last = group(page, `${md(`${MONDAY} - 7`)}至${md(`${MONDAY} - 1`)}`);
  await expect(last.locator('.dc-list-head .dc-caption')).toHaveText('+2.48 HTB · 已存进余额 2 HTB');
  await expect(last.locator('.dc-list-item')).toHaveText([
    `${md(`${MONDAY} - 1`)} 星期日余额 412 HTB · 2.08%/周+1.22 HTB`, `${md(`${MONDAY} - 2`)} 星期六余额 415 HTB · 2.13%/周+1.26 HTB`,
  ]);

  // Four weeks first; 加载更多 reads four more, and goes once there are none left.
  await expect(page.locator('.dc-list-head')).toHaveCount(2);
  await page.getByRole('button', { name: '加载更多' }).click();
  const old = group(page, `${md(`${MONDAY} - 35`)}至${md(`${MONDAY} - 29`)}`);
  await expect(old.locator('.dc-list-head .dc-caption')).toHaveText('+1.00 HTB · 已存进余额 1 HTB');
  await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);

  await page.getByRole('button', { name: '返回' }).click();
  await expect(page).toHaveURL(/\/student$/);
});

test('信用「本周利率」: the 活期 row opens 利息 too; on a phone the card comes first', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await page.goto('/student/credit');
  const current = page.getByRole('region', { name: '本周利率' }).locator('.dc-rate-list > li.is-link');
  await expect(current).toHaveText('活期存 100 HTB，一周多得约 2.00 HTB2%/周');
  await current.getByRole('link').click();
  await expect(page).toHaveURL(/\/student\/interest$/);
  const [cardTop, listTop] = await Promise.all([card(page).boundingBox(), group(page, '本周').boundingBox()]);
  expect(cardTop!.y).toBeLessThan(listTop!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('no interest yet: the card reads 0.00 HTB and the list says when the first comes', async ({ page }) => {
  await signIn(page, '学生', '20260002');
  await expect(page).toHaveURL(/\/student$/);
  await page.goto('/student/interest');
  await expect(card(page).locator('.amount')).toHaveText('0.00HTB');
  await expect(card(page).locator('.dc-kv > div')).toHaveText(['本周活期利率2%/周', '本周已计+0.00 HTB', '之前留下的零头0.00 HTB']);
  await expect(page.locator('.dc-empty')).toHaveText('还没有计息记录每天结束时按活期余额计一次利息，明天就能在这里看到。');
  await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);
});

test('one 利息 that settles three weeks shows its amount on the latest week only', async ({ page }) => {
  // 李思远 (20260002) had 0.60, 0.30 and 0.20 HTB in the three weeks before this one, each under 1 HTB: this Monday's
  // 利息 pays in 1 HTB for all three.
  sql(`insert into public.interest_accruals (student_no, day, balance, rate, centi) values
         ('20260002', ${MONDAY} - 21, 30, 2, 60), ('20260002', ${MONDAY} - 14, 15, 2, 30), ('20260002', ${MONDAY} - 7, 10, 2, 20);
       select app_private.settle_interest(${MONDAY}::timestamp at time zone 'Asia/Shanghai');`);
  await signIn(page, '学生', '20260002');
  await expect(page).toHaveURL(/\/student$/);
  await page.goto('/student/interest');
  const week = (n: number) => group(page, `${md(`${MONDAY} - ${7 * n}`)}至${md(`${MONDAY} - ${7 * n - 6}`)}`).locator('.dc-list-head .dc-caption');
  await expect(week(1)).toHaveText('+0.20 HTB · 已存进余额 1 HTB');
  await expect(week(2)).toHaveText(`+0.30 HTB · ${md(MONDAY)}存进余额`);
  await expect(week(3)).toHaveText(`+0.60 HTB · ${md(MONDAY)}存进余额`);
  await expect(page.getByText('已存进余额', { exact: false })).toHaveCount(1);
  await expect(card(page).locator('.dc-kv > div').last()).toHaveText('之前留下的零头0.10 HTB');
});
