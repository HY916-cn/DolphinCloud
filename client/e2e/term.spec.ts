import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 定期 (PHASE-2.md §10.2, design system TermDeposit) on the seed data (supabase/seed.sql): 张小明 (20260001) has 108 HTB
// at 600 points, and no anchor is published (2%: 2 周 2.6%, 4 周 3.12%). A term around today ends in 40 days, so 2 and 4
// weeks fit and 8 do not. The tests run in order: teller01 opens a 定期 and takes it out early, opens one and reverses
// it, and opens one that stays; then 张小明 and the bank admin read them.
test.describe.configure({ mode: 'serial' });
const DAY = 'app_private.cn_date(now())';
test.beforeAll(() => {
  resetData();
  sql(`insert into public.terms (name, starts_on, ends_on) values ('本学期', ${DAY} - 30, ${DAY} + 40)`);
});

const md = (date: string) => sql(`select to_char(${date}, 'FMMM月FMDD日')`);
const pick = (page: Page, name: string) => page.locator('.dc-seg label', { hasText: name }).click();
const receipt = (page: Page) => page.locator('aside[aria-label="办理单"]');
const cards = (page: Page) => page.getByRole('radiogroup', { name: '存期' }).locator('.dc-choice');
const balance = () => sql(`select balance from public.accounts where student_no = '20260001'`);

async function serve(page: Page) {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(page.locator('.dc-person-name')).toHaveText('张小明');
  await pick(page, '定期');
}

async function open(page: Page, weeks: number, amount: number) {
  await cards(page).filter({ hasText: `${weeks} 周` }).click();
  await page.getByPlaceholder('请输入金额').fill(String(amount));
  await page.getByRole('button', { name: '开定期', exact: true }).click();
  await confirmIn(page, '确认开定期');
  await expect(page.locator('.dc-sheet')).toHaveCount(0);
}

test('柜台「定期」: the lengths that end in term, 开定期, 提前支取 with its interest, and 冲正 of a 开定期', async ({ page }) => {
  const four = md(`${DAY} + 28`);
  await serve(page);
  await expect(cards(page)).toHaveText([`2 周${md(`${DAY} + 14`)} 到期2.6%/周`, `4 周${four} 到期3.12%/周`]);
  await expect(page.locator('p.dc-caption', { hasText: '本学期' })).toHaveText(`本学期 ${md(`${DAY} + 40`)} 结束，最长只能选 4 周。`);
  await expect(page.locator('.dc-list-item')).toHaveCount(0);
  await expect(page.getByText('还没有定期。')).toBeVisible();

  const hint = page.locator('.dc-field-hint');
  const amount = page.getByPlaceholder('请输入金额');
  await expect(hint).toHaveText('1 HTB 起，最多 108 HTB（活期余额）');
  await amount.fill('200');
  await expect(hint).toHaveText('余额不足：活期余额 108 HTB，还差 92 HTB');
  await amount.fill('100');
  await expect(hint).toHaveText('选好存期后显示到期拿回多少');
  await expect(page.getByRole('button', { name: '开定期', exact: true })).toBeDisabled();
  await cards(page).filter({ hasText: '4 周' }).click();
  await expect(hint).toHaveText('到期拿回 112.48 HTB · 3.12%/周');
  await expect(receipt(page)).toContainText(`开定期（正在办理）4 周，${four} 到期−100`);
  await expect(receipt(page)).toContainText('办理后余额8 HTB');
  await expect(page.locator('.dc-actions-total')).toHaveText('存入定期办理后余额 8 HTB100HTB');

  await page.getByRole('button', { name: '开定期', exact: true }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('给张小明开定期 100 HTB？');
  await expect(sheet.locator('.dc-kv > div')).toHaveText(['存期4 周', `到期日${four}`, '周利率3.12%/周（到期前不变）', '到期拿回112.48 HTB', '活期余额108 → 8 HTB']);
  await expect(sheet).toContainText('到期当天结束时自动转回活期。提前支取只按活期算利息。');
  await confirmIn(page, '确认开定期');
  await expect(receipt(page)).toContainText(`开定期4 周，${four} 到期 · HT`);
  await expect(page.locator('.dc-person-side')).toHaveText('8当前余额 HTB');
  await expect(page.locator('.dc-list-item')).toHaveText([`定期 4 周存 100 HTB，到期拿回 112.48 HTB${four} 到期 · 3.12%/周存期中提前支取`]);

  // Held a week, it pays the 活期 rate of each of those days (PHASE-2.md §9.5); the server works it out.
  sql(`update public.term_deposits set opened_on = opened_on - 7 where student_no = '20260001'`);
  const centi = Number(sql(`select app_private.early_interest(d, ${DAY}) from public.term_deposits d where student_no = '20260001'`));
  expect(centi).toBeGreaterThan(0);
  const interest = (centi / 100).toFixed(2);
  await page.getByRole('button', { name: '提前支取 4 周定期 100 HTB' }).click();
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('提前支取这笔定期 100 HTB？');
  await expect(sheet).toContainText('不付定期利息，只按活期利率算存入这些天的利息，当天支取没有利息。本金和利息转回活期。');
  await confirmIn(page, '提前支取');
  await expect(page.locator('.dc-toast')).toHaveText(`已提前支取，利息 ${interest} HTB`);
  await expect(receipt(page)).toContainText(`提前支取4 周定期，利息 ${interest} HTB · HT`);
  await expect(receipt(page).getByRole('button', { name: '冲正提前支取' })).toHaveCount(0);
  await expect(page.locator('.dc-list-item')).toHaveText([`定期 4 周存 100 HTB，提前取出，利息 ${interest} HTB原定 ${four} 到期 · 只按活期算利息已提前支取`]);
  await expect(page.locator('.dc-person-side')).toHaveText(`${balance()}当前余额 HTB`);
  await expect(receipt(page).getByRole('button', { name: '冲正开定期' })).toHaveCount(0);

  // A 开定期 entered wrong is reversed from the 办理单: the 定期 is gone and 活期 is back.
  const before = balance();
  await open(page, 2, 20);
  await receipt(page).getByRole('button', { name: '冲正开定期' }).click();
  await page.locator('.dc-sheet .dc-check', { hasText: '金额录错' }).click();
  await confirmIn(page, '确认冲正');
  await expect(receipt(page)).toContainText('开定期（已冲正）');
  await expect(page.locator('.dc-list-item')).toHaveCount(1);
  await expect(page.locator('.dc-person-side')).toHaveText(`${before}当前余额 HTB`);

  // One that stays open; 查询 adds it up.
  await open(page, 4, 30);
  await expect(page.locator('.dc-list-item')).toHaveCount(2);
  await pick(page, '查询');
  await expect(page.locator('.dc-stat', { hasText: '定期合计' })).toHaveText('定期合计30HTB');
  await expect(page.locator('.dc-txns > li .dc-txn-title').first()).toHaveText(`开定期 · 4 周，${four} 到期`);
  await expect(page.locator('.dc-txns > li .dc-txn-title', { hasText: '定期转回' })).toHaveText(`定期转回 · 提前支取，利息 ${interest} HTB`);

  // 今日业务: 开定期 has its 冲正, 提前支取 has none.
  await page.goto('/counter/today');
  await expect(page.locator('.dc-txns > li', { hasText: '开定期 30 HTB' }).getByRole('button', { name: /^冲正/ })).toBeVisible();
  await expect(page.locator('.dc-txns > li', { hasText: '定期转回' }).getByRole('button', { name: /^冲正/ })).toHaveCount(0);
  // The 定期 of this 开定期 was taken out early: the server refuses, and the sheet says why.
  await page.locator('.dc-txns > li', { hasText: '开定期 100 HTB' }).getByRole('button', { name: /^冲正/ }).click();
  await page.locator('.dc-sheet .dc-check', { hasText: '业务选错' }).click();
  await confirmIn(page, '确认冲正');
  await expect(page.locator('.dc-sheet .dc-notice')).toHaveText('不能冲正这笔业务这笔定期已经到期或提前支取，不能再冲正。');
});

test('学生: 定期合计 on the home page, 我的定期 on 信用, and the 定期 entries only under 全部', async ({ page }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-credit-summary .dc-kv')).toContainText('定期合计30 HTB');
  // 开定期, 定期转回 and their 冲正 are the student's own money moving between 活期 and 定期: neither 存入 nor 支出.
  const now = new Date(Date.now() + 8 * 3_600_000);
  const [y, m] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = m >= 9 ? `${y}-09-01` : m >= 2 ? `${y}-02-01` : `${y - 1}-09-01`;
  const saved = sql(`select sum(balance_delta) from public.txns where student_no = '20260001' and balance_delta > 0 and term_id is null
    and created_at >= '${start}T00:00:00+08:00'`);
  await expect(page.locator('.dc-balance-split')).toHaveText(`本学期存入 +${saved}本学期支出 −37`);

  await page.goto('/student/credit');
  const four = md(`${DAY} + 28`);
  const items = page.locator('.dc-list-item');
  await expect(items).toHaveCount(2);
  await expect(items.first()).toHaveText(`定期 4 周存 30 HTB，到期拿回 33.74 HTB${four} 到期 · 3.12%/周存期中`);
  await expect(items.last()).toContainText('定期 4 周存 100 HTB，提前取出，利息');
  await expect(items.last()).toContainText('已提前支取');
  await expect(page.getByRole('button', { name: /提前支取/ })).toHaveCount(0);

  await page.goto('/student/txns');
  const opened = page.locator('.dc-txn', { hasText: '开定期' }).first();
  await expect(opened.locator('.dc-txn-title')).toHaveText(`开定期 · 4 周，${four} 到期`);
  await expect(opened.locator('.dc-txn-amount')).toHaveText('−30转定期');
  await expect(page.locator('.dc-kv > div', { hasText: '支出' })).toContainText('−37');
  await expect(page.locator('.dc-txn', { hasText: '定期转回' }).locator('.dc-txn-amount small')).toHaveText('转回');
  await page.getByRole('tab', { name: '存款' }).click();
  await expect(page.locator('.dc-txn').first()).toContainText('存款');
  await expect(page.locator('.dc-txn', { hasText: '定期' })).toHaveCount(0);
});

test('后台流水: the two 定期 types as filters, and 冲正 only while the 定期 allows it', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/txns');
  const types = page.getByRole('group', { name: '类型' });
  const rows = page.locator('ul.dc-txns > li');
  await types.getByRole('button', { name: '开定期' }).click();
  await expect(rows).toHaveCount(3);
  const four = md(`${DAY} + 28`);
  await expect(rows.locator('.dc-txn-title')).toHaveText([`开定期 · 4 周，${four} 到期`, `开定期 · 2 周，${md(`${DAY} + 14`)} 到期（已冲正）`,
    `开定期 · 4 周，${four} 到期`]);
  // The one still open can be reversed; the one taken out early cannot.
  await rows.nth(0).locator('summary').click();
  await expect(rows.nth(0).getByRole('button', { name: '冲正' })).toBeVisible();
  await rows.nth(2).locator('summary').click();
  await expect(rows.nth(2).getByRole('button', { name: '冲正' })).toHaveCount(0);

  await types.getByRole('button', { name: '开定期' }).click();
  await types.getByRole('button', { name: '定期转回' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.locator('.dc-txn-amount small')).toHaveText('转回');
  const centi = Number(sql(`select interest_centi from public.term_deposits where status = 'early'`));
  await expect(rows.locator('.dc-txn-title')).toHaveText(`定期转回 · 提前支取，利息 ${(centi / 100).toFixed(2)} HTB`);
  // 提前支取 before the day it was to mature: only the bank admin and the president reverse it, here.
  await rows.first().locator('summary').click();
  await expect(rows.first().getByRole('button', { name: '冲正' })).toBeVisible();
});

test('柜台业务栏: six businesses take two rows of three at 390 wide', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await serve(page);
  const boxes = await Promise.all((await page.getByRole('group', { name: '业务' }).locator('label').all()).map((l) => l.boundingBox()));
  expect(boxes).toHaveLength(6);
  const [a, b, c, d, e, f] = boxes.map((x) => x!);
  expect([b.y, c.y]).toEqual([a.y, a.y]);
  expect(d.y).toBeGreaterThan(a.y + a.height - 1);
  expect([e.y, f.y]).toEqual([d.y, d.y]);
  expect(d.x).toBe(a.x);
  await expect(cards(page)).toHaveCount(2);
  await page.close();
});
