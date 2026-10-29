import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// 流水, 发行, 参数 and 日志 (PHASE-1.md §4.2) as teacher01 on the seed data. The counter tests that follow rely on the
// seed's faces and withdrawal limits, so these tests leave them alone and switch 排名匿名 back to how they found it.
// The 日志 test looks for the batch the 发行 test registers.
test.describe.configure({ mode: 'serial' });

const batch = `E2E-${Date.now()}`;

async function open(page: Page, label: string, path: string) {
  await signIn(page, '工作人员', 'teacher01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('.dc-nav-item', { hasText: label }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${path}$`));
  await expect(page.locator('.dc-top-title')).toContainText(label);
}

test('流水: filter by student number', async ({ page }) => {
  await open(page, '流水', 'txns');
  await page.getByPlaceholder('全部学生').fill('20260001');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  const rows = page.locator('section[aria-label="流水"] .dc-txn');
  await expect(page.locator('.dc-list-title', { hasText: /^共 \d+ 笔$/ })).toBeVisible();
  await expect(rows.filter({ has: page.locator('.dc-txn-title', { hasText: /^期初余额/ }) })).toContainText('+120');
  await expect(rows.filter({ has: page.locator('.dc-txn-title', { hasText: /^存款/ }) }).first()).toContainText('学号 20260001');
  await expect(rows.filter({ hasNotText: '学号 20260001' })).toHaveCount(0);

  await page.getByPlaceholder('全部学生').fill('20269999');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.dc-empty')).toContainText('没有符合条件的流水');
});

test('发行: register a batch and see it in the list', async ({ page }) => {
  await open(page, '发行', 'issues');
  await page.getByLabel('批次号').fill(batch);
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 5 元').click();
  await expect(page.locator('form[aria-label="登记发行"] .dc-kv')).toContainText('发行总额25HTB');
  await page.getByLabel('用途').fill('测试发行');
  await page.getByLabel('审批人').fill('王老师');
  await page.getByRole('button', { name: '登记发行' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText(`批次 ${batch}，共 25 HTB`);
  const row = page.locator('section[aria-label="发行记录"] .dc-txn', { hasText: batch });
  await expect(row).toContainText('10 元 × 2 张、5 元 × 1 张');
  await expect(row.locator('.dc-txn-amount')).toHaveText('25HTB');

  // The same batch number again is refused.
  await page.getByLabel('批次号').fill(batch);
  await page.getByLabel('增加一张 1 元').click();
  await page.getByLabel('用途').fill('测试发行');
  await page.getByRole('button', { name: '登记发行' }).click();
  await expect(page.locator('.dc-notice-danger')).toContainText('批次号已被使用');
});

test('参数: switch 排名匿名 off and on again', async ({ page }) => {
  await open(page, '参数', 'settings');
  const anonymous = page.getByRole('switch', { name: /排名匿名/ });
  const toggle = () => page.locator('.dc-switch', { hasText: '排名匿名' }).click();
  await expect(anonymous).toBeChecked();

  await toggle();
  await expect(anonymous).not.toBeChecked();
  await expect(page.locator('.dc-toast')).toHaveText('设置已保存');
  await expect(anonymous).toBeEnabled();
  await page.reload();
  await expect(anonymous).not.toBeChecked();

  await toggle();
  await expect(page.locator('.dc-toast')).toHaveText('设置已保存');
  await expect(anonymous).toBeEnabled();
  await page.reload();
  await expect(anonymous).toBeChecked();
  await expect(page.getByRole('button', { name: '保存参数' })).toBeDisabled();
});

test('日志: the batch registered above, with its fields', async ({ page }) => {
  await open(page, '日志', 'audit');
  const entry = page.locator('details', { has: page.locator('.dc-txn-title', { hasText: `新增发行 · ${batch}` }) });
  await expect(entry).toContainText('teacher01');
  await entry.locator('summary').click();
  await expect(entry.locator('.dc-kv')).toContainText('批次号');
  await expect(entry.locator('.dc-kv')).toContainText('总额25');
  await expect(page.locator('.dc-txn-title', { hasText: '修改参数 · 排名匿名' }).first()).toBeVisible();
});
