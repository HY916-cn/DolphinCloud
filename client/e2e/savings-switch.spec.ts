import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 活期计息开关 (PHASE-2.md §9.3, design system data.md 活期计息开关（后台）) on the seed data: the bank admin pauses 活期
// interest on 利率; the student's 首页, 信用, 利息 and 利率看板 say 暂停计息; the president reads it without the switch; the bank
// admin turns it back on. Tests run in order; the last one leaves 活期 on.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const MONDAY = `date_trunc('week', now() at time zone 'Asia/Shanghai')::date`;
const sheet = (page: Page) => page.locator('.dc-sheet');
const paused = '活期暂停计息：每天不计活期利息，已攒着的利息照常结息。';

test('银行管理员 pauses 活期 interest on 利率, after a second look', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/rates');
  const card = page.locator('.dc-switch', { hasText: '活期计息' });
  await expect(card).toContainText('活期正常计息');
  await expect(card.getByRole('switch')).toBeChecked();
  await expect(page.getByText(paused)).toHaveCount(0);

  await card.click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('暂停活期计息？');
  await expect(sheet(page)).toContainText('暂停后每天不再计活期利息，已经攒着的利息照常在周一存进余额。重新开启后从当天起恢复计息，暂停期间的利息不补。');
  await confirmIn(page, '确认暂停');
  await expect(page.locator('.dc-toast')).toHaveText('已暂停活期计息');
  const name = sql(`select display_name from public.profiles where login_id = 'admin'`);
  await expect(card).toContainText(new RegExp(`活期暂停计息 · \\d+月\\d+日 由 ${name} 暂停`));
  await expect(card.getByRole('switch')).not.toBeChecked();
  await expect(page.getByText(paused)).toBeVisible();
  expect(sql(`select value from public.settings where key = 'savings_interest_enabled'`)).toBe('false');

  await page.goto('/admin');
  await expect(page.getByText(paused)).toBeVisible();
});

test('the student’s 首页, 信用 and 利息 say 暂停计息; a paused day is a row at 0', async ({ page }) => {
  // Today ended with 活期 paused: a row at 0, as accrue_interest writes it.
  sql(`insert into public.interest_accruals (student_no, day, balance, rate, centi) values ('20260001', ${MONDAY}, 415, 0, 0)`);
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-credit-summary .dc-kv > div.is-link')).toHaveText('攒着的利息0.00 HTB活期暂停计息');

  await page.goto('/student/credit');
  await expect(page.getByRole('region', { name: '本周利率' }).locator('.dc-rate-list > li').first()).toHaveText('活期暂停计息，暂停期间存在活期不计利息');

  await page.goto('/student/interest');
  await expect(page.locator('.dc-notice')).toHaveText('活期暂停计息暂停期间每天不计利息。之前攒着的利息照常在周一存进余额。');
  const card = page.getByRole('region', { name: '攒着的利息' });
  await expect(card.locator('.dc-kv > div').first()).toHaveText('本周活期利率暂停计息');
  await expect(card.locator('.dc-kv .dc-tag')).toHaveText('暂停计息');
  await expect(page.locator('.dc-list .dc-list-item')).toHaveText([/^\d+月\d+日 星期一余额 415 HTB · 暂停计息\+0\.00 HTB$/]);
});

test('利率看板: the 活期 tile reads 暂停计息, not 0%', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  const current = page.getByRole('region', { name: '活期周利率' }).locator('.dc-board-hero');
  await expect(current).toHaveText('暂停计息');
  await expect(current).toHaveClass(/is-paused/);
});

test('行长 reads that 活期 is paused, without the switch', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(paused)).toBeVisible();
  await page.goto('/admin/rates');
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.locator('.dc-switch-text')).toContainText('活期暂停计息 · ');
  await expect(page.locator('.dc-switch-text')).toContainText('由银行管理员统一设置');
});

test('银行管理员 turns 活期 interest back on', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/rates');
  const card = page.locator('.dc-switch', { hasText: '活期计息' });
  await card.click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('重新开启活期计息？');
  await expect(sheet(page)).toContainText('从今天结束时起恢复每天计息，暂停期间的利息不补。');
  await confirmIn(page, '确认开启');
  await expect(page.locator('.dc-toast')).toHaveText('已重新开启活期计息');
  await expect(card).toContainText('活期正常计息');
  await expect(card.getByRole('switch')).toBeChecked();
  await expect(page.getByText(paused)).toHaveCount(0);
  await page.goto('/board');
  await expect(page.getByRole('region', { name: '活期周利率' }).locator('.dc-board-hero')).not.toHaveText('暂停计息');
});
