import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 信用分开关 (PHASE-2.md §8.5) on the seed data: 张小明 starts at 650, everyone else at 600. The bank admin pauses
// 信用分 with a reason, the student, the teller and the president see it paused, and the bank admin turns it back on,
// which gives 张小明 650 again. Tests run in order; the last one leaves 信用分 on.
test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  resetData();
  sql(`update public.credit_scores set score = 650 where student_no = '20260001'`);
});

const sheet = (page: Page) => page.locator('.dc-sheet');
const paused = '信用分已暂停：所有学生按 600 分计，分数不变。';
async function findStudent(page: Page, query: string, name: string) {
  await page.getByRole('searchbox', { name: '搜索学生' }).fill(query);
  await page.getByRole('list', { name: '搜索建议' }).locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-person-name')).toHaveText(name);
}

test('银行管理员 pauses 信用分 with a reason and a second look', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/credit');
  const card = page.locator('.dc-switch', { hasText: '启用信用分' });
  await expect(card).toContainText('信用分已启用');
  await expect(card.getByRole('switch')).toBeChecked();
  await expect(page.getByText(paused)).toHaveCount(0);

  await card.click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('暂停信用分');
  await expect(sheet(page).getByRole('button', { name: '下一步' })).toBeDisabled();
  await sheet(page).getByPlaceholder('写清楚暂停的原因').fill('月底统一核对');
  await confirmIn(page, '下一步');
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('暂停信用分？');
  await confirmIn(page, '确认暂停');
  await expect(page.locator('.dc-toast')).toHaveText('已暂停，1 位学生按 600 分计');
  const name = sql(`select display_name from public.profiles where login_id = 'admin'`);
  await expect(card).toContainText(new RegExp(`信用分已暂停 · \\d+月\\d+日 由 ${name} 暂停`));
  await expect(card.getByRole('switch')).not.toBeChecked();
  await expect(page.getByText(paused)).toBeVisible();

  await findStudent(page, '20260001', '张小明');
  const dial = page.locator('.dc-gauge.is-lg .dc-gauge-dial');
  await expect(dial).toHaveClass(/is-paused/);
  await expect(dial).toHaveAttribute('aria-valuenow', '600');
  await expect(dial).toHaveAttribute('aria-valuetext', '海豚信用分已暂停，按 600 分计');
  await expect(page.locator('.dc-gauge.is-lg .dc-tag')).toHaveText('已暂停');
  await expect(page.locator('.dc-gauge-next')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '调整信用分' })).toBeDisabled();
  await expect(page.getByText('信用分暂停中', { exact: true })).toBeVisible();
  const first = page.getByRole('table', { name: '信用分变动' }).locator('tbody tr').first();
  await expect(first).toContainText('−50');
  await expect(first).toContainText('信用分暂停，按 600 分计');

  for (const path of ['/admin/loans', '/admin/students']) {
    await page.goto(path);
    await expect(page.getByText(paused)).toBeVisible();
  }
});

test('the student and the teller see 信用分 paused at 600', async ({ page, browser }) => {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-gauge.is-md .dc-gauge-dial')).toHaveClass(/is-paused/);
  await expect(page.locator('.dc-gauge.is-md .dc-tag')).toHaveText('已暂停');
  await page.goto('/student/credit');
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-dial')).toHaveAttribute('aria-valuenow', '600');
  await expect(page.locator('.dc-gauge-next')).toHaveCount(0);
  await expect(page.getByText('信用分暂停中，所有同学都按 600 分计算额度和利率。重新开启后恢复你原来的分数。')).toBeVisible();
  await expect(page.locator('.dc-txn').first()).toContainText('信用分暂停，按 600 分计');

  const { baseURL, ignoreHTTPSErrors, locale, timezoneId } = test.info().project.use;
  const teller = await (await browser.newContext({ baseURL, ignoreHTTPSErrors, locale, timezoneId })).newPage();
  await signIn(teller, '工作人员', 'teller01');
  await expect(teller).toHaveURL(/\/counter$/);
  await teller.getByRole('searchbox', { name: '搜索学生' }).fill('zxm');
  await teller.locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(teller.locator('.dc-person-meta .dc-gauge.is-sm .dc-gauge-score')).toHaveText('600 暂停');
  await teller.context().close();
});

test('利率看板 while 信用分 is paused: the loan tile holds one big number at 600', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  await expect(page.locator('.dc-board-grid')).toHaveClass(/is-flat-loan/);
  const loan = page.getByRole('region', { name: '贷款周利率' });
  // 600 分 at the initial anchor (2%): 6.2667%.
  await expect(loan.locator('.dc-board-hero')).toHaveText('6.27%');
  await expect(loan.locator('.dc-board-note')).toHaveText('信用分暂停，均按 600 分计');
  await expect(loan.locator('dl')).toHaveCount(0);
});

test('行长 reads how 信用分 stands, without the switch', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/credit');
  await expect(page.getByText(paused)).toBeVisible();
  await expect(page.locator('.dc-card .dc-switch-text')).toContainText('信用分已暂停 ·');
  await expect(page.locator('.dc-card .dc-switch-text')).toContainText('由银行管理员统一设置');
  await expect(page.getByRole('switch')).toHaveCount(0);
});

test('银行管理员 turns 信用分 back on and the score comes back', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/credit');
  await page.locator('.dc-switch', { hasText: '启用信用分' }).click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('重新开启信用分？');
  await confirmIn(page, '确认开启');
  await expect(page.locator('.dc-toast')).toHaveText('已重新开启，1 位学生恢复原来的分数');
  await expect(page.locator('.dc-switch')).toContainText('信用分已启用');
  await expect(page.getByText(paused)).toHaveCount(0);

  await findStudent(page, '20260001', '张小明');
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-dial')).toHaveAttribute('aria-valuenow', '650');
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-dial')).not.toHaveClass(/is-paused/);
  await expect(page.getByRole('button', { name: '调整信用分' })).toBeEnabled();
  await expect(page.getByRole('table', { name: '信用分变动' }).locator('tbody tr').first()).toContainText('信用分重新开启，恢复暂停前的分数');
});
