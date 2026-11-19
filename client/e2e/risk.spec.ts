import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 风险提醒 (PHASE-2.md §12, design system RiskAlerts) on the seed data (supabase/seed.sql): teller01 lends 张小明
// (20260001, 600 points, limit 130 HTB) 60 HTB, over the 50 HTB line, and the president terminates the loan from the
// 风险提醒 page; the president and the bank admin both mark one 库存不足 alert, the second one is refused; the accountant
// sees none of it. The tests run in order.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const sheet = (page: Page) => page.locator('.dc-sheet');
const bar = (page: Page) => page.locator('.dc-actions');
const card = (page: Page, name: string) => page.locator(`section[aria-label="${name}"]`);

test('大额贷款: the teller lends 60 HTB, the president terminates it from 总览 and the 风险提醒 page', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await page.locator('.dc-seg label', { hasText: '贷款' }).click();
  await page.getByPlaceholder('请输入金额').fill('60');
  await page.getByPlaceholder('例如：买文具').fill('买文具');
  await bar(page).getByRole('button', { name: '放款', exact: true }).click();
  await confirmIn(page, '确认放款');
  await expect(page.locator('aside[aria-label="办理单"]')).toContainText('贷款分 4 期');

  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  const open = Number(sql(`select count(*) from public.risk_alerts where status = 'open'`));
  const overview = card(page, '未处理的风险提醒');
  await expect(overview.getByRole('heading')).toHaveText(`未处理的风险提醒 · ${open} 条`);
  await expect(overview.locator('.dc-list-link').first()).toContainText('大额贷款 · 张小明 未处理');
  await expect(overview.locator('.dc-list-link').first()).toContainText('贷款 60 HTB，超过 50 HTB · 柜员小林');
  await overview.getByRole('link', { name: '去处理' }).click();
  await expect(page).toHaveURL(/\/admin\/alerts$/);
  await expect(page.getByRole('tab', { name: '未处理' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '未处理' })).toContainText(String(open));

  await page.getByRole('group', { name: '类型' }).getByRole('button', { name: '大额贷款' }).click();
  await expect(page).toHaveURL(/kinds=loan_large/);
  const rows = page.locator('#alerts-panel .dc-list-link');
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(page).toHaveURL(/\/admin\/alerts\/\d+\?kinds=loan_large$/);
  await expect(page.locator('.dc-top-title')).toContainText('大额贷款');
  await expect(page.locator('.dc-top-title .dc-top-sub')).toHaveText('张小明');
  const shown = card(page, '这条提醒');
  await expect(shown.locator('.dc-kv')).toContainText('学生张小明 · ');
  await expect(shown.locator('.dc-kv')).toContainText('贷款金额60 HTB');
  await expect(shown.getByRole('link', { name: '查看贷款' })).toHaveAttribute('href', /\/admin\/loans\//);
  await expect(card(page, '处理').locator('.dc-caption')).toHaveText('终止会让这笔贷款提前到期。剩余本金和已产生的利息立即全部到期：先从活期扣，不够的部分算逾期。');

  // 终止 asks for the reason first, then a second look.
  await bar(page).getByRole('button', { name: '终止' }).click();
  await expect(card(page, '处理').locator('.dc-field')).toHaveClass(/is-error/);
  await expect(card(page, '处理').locator('.dc-field-hint')).toHaveText('请写明终止的原因');
  await card(page, '处理').getByLabel('说明').fill('金额太大，先收回');
  await bar(page).getByRole('button', { name: '终止' }).click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('终止张小明的贷款？');
  await confirmIn(page, '确认终止');
  await expect(page).toHaveURL(/\/admin\/alerts\?kinds=loan_large$/);
  await expect(page.locator('.dc-toast')).toHaveText('已终止');
  await expect(rows.first()).toHaveClass(/is-new/);
  await expect(rows.first()).toContainText('已终止');
  await expect(rows.first()).toContainText('王行长');
  await expect(rows.first()).toContainText('终止：金额太大，先收回');
  expect(sql(`select terminated_at is not null and terminate_reason = '金额太大，先收回' from public.loans
    where student_no = '20260001' and status <> 'reversed' order by loan_no desc limit 1`)).toBe('t');
  expect(sql(`select status from public.risk_alerts where kind = 'loan_large' order by id desc limit 1`)).toBe('terminated');

  await page.getByRole('tab', { name: '已终止' }).click();
  await expect(page).toHaveURL(/tab=terminated/);
  await expect(rows).toHaveCount(1);
});

test('库存不足 is only marked 已查看; when the president and the bank admin both do, the second is refused', async ({ page, browser }) => {
  sql(`update public.products set safety_stock = stock + 5 where name = '海豚书签'`);
  const id = sql(`select id from public.risk_alerts where kind = 'stock_low' and status = 'open' and detail ->> 'name' = '海豚书签'`);
  expect(id).toMatch(/^\d+$/);

  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/alerts/${id}`);
  await expect(page.locator('.dc-top-title')).toContainText('库存不足');
  await expect(card(page, '处理').locator('.dc-caption')).toHaveText('这种提醒只能标为已查看。');
  await expect(bar(page).getByRole('button')).toHaveText(['已查看']);

  const admin = await browser.newPage();
  await signIn(admin, '工作人员', 'admin');
  await expect(admin).toHaveURL(/\/admin$/);
  await admin.goto(`/admin/alerts/${id}`);
  await card(admin, '处理').getByLabel('说明').fill('已安排进货');
  await bar(admin).getByRole('button', { name: '已查看' }).click();
  await expect(admin).toHaveURL(/\/admin\/alerts$/);
  await expect(admin.locator('.dc-toast')).toHaveText('已标为已查看');
  await admin.close();

  await bar(page).getByRole('button', { name: '已查看' }).click();
  const notice = page.locator('.dc-notice-danger');
  await expect(notice.locator('.dc-notice-title')).toHaveText('这条提醒已处理');
  await expect(notice.locator('.dc-notice-text')).toHaveText(/^银行管理员 已于 \d+月\d+日 \d\d:\d\d 标为已查看。$/);
  await expect(card(page, '处理')).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await expect(card(page, '这条提醒').locator('.dc-tag')).toHaveText('已查看');
  await expect(card(page, '这条提醒').locator('.dc-kv')).toContainText('处理说明已安排进货');
  expect(sql(`select p.login_id from public.risk_alerts a join public.profiles p on p.id = a.handled_by where a.id = ${id}`)).toBe('admin');
});

test('the accountant has no 风险 page and no alerts on 总览', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '风险' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '今日业务' })).toBeVisible();
  await expect(card(page, '未处理的风险提醒')).toHaveCount(0);
  await page.goto('/admin/alerts');
  await expect(page).toHaveURL(/\/admin$/);
});
