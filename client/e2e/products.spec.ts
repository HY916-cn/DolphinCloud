import { expect, test } from '@playwright/test';
import { confirmIn, downloadNotices, noticePassword, recordNotices, resetData, signIn } from './helpers';

// 商品 and 出入库 (PHASE-1.md §1.1): admin adds a product with a picture, stocks it in and out, then takes it off the shelf.
test.beforeAll(resetData);

test('add a product, stock it in and out, then unlist it', async ({ page }) => {
  const name = `海豚贴纸${Date.now().toString().slice(-4)}`;
  const row = page.locator('.dc-list-link', { hasText: name });
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('.dc-nav-item', { hasText: '商品' }).click();
  await expect(page.locator('.dc-list-link', { hasText: '海豚书签' })).toContainText('已上架');

  await page.getByRole('link', { name: '新增商品' }).first().click();
  await expect(page.locator('.dc-top-title')).toContainText('新增商品');
  await page.getByRole('button', { name: '保存商品' }).click();
  await expect(page.locator('.dc-field.is-error')).toHaveCount(2);
  await page.getByLabel('商品名称').fill(name);
  await page.getByPlaceholder('请输入价格').fill('3');
  await page.getByPlaceholder('例如 文具').fill('贴纸');
  await page.locator('input[type=file]').setInputFiles('public/logo.png');
  await expect(page.getByAltText('商品图片预览')).toBeVisible();
  await page.locator('.dc-switch').click();
  await expect(page.getByRole('switch')).toBeChecked();
  await page.getByRole('button', { name: '保存商品' }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}/);
  await expect(page.locator('.dc-notice-success')).toContainText('商品已上架');

  await expect(page.locator('section[aria-label="库存"] .dc-kv')).toContainText('0件');

  // 出入库 opens with one piece of this product picked: stock in 20, then take 5 out, which needs a reason.
  await page.getByRole('link', { name: '去出入库' }).click();
  await expect(page).toHaveURL(/\/admin\/stock\?product=[0-9a-f-]{36}$/);
  await expect(page.getByLabel(`${name}入库数量`)).toHaveValue('1');
  await page.getByLabel(`${name}入库数量`).fill('20');
  await page.getByRole('button', { name: '确认入库' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText('已入库 1 种商品，共 20 件');
  await expect(page.locator('section[aria-label="最近库存变动"] .dc-txn').first()).toContainText(`入库 · ${name}`);
  await page.locator('.dc-seg label', { hasText: '出库' }).click();
  for (let i = 0; i < 5; i++) await page.getByLabel(`增加一件${name}`).click();
  await page.getByRole('button', { name: '确认出库' }).click();
  await expect(page.locator('.dc-field.is-error')).toContainText('请写明出库原因');
  await page.getByLabel('出库原因').fill('损坏');
  await page.getByRole('button', { name: '确认出库' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText('已出库 1 种商品，共 5 件');
  await expect(page.locator('section[aria-label="最近库存变动"] .dc-txn').first()).toContainText('−5');

  // The movement names its product as a link back to it.
  await page.locator('section[aria-label="最近库存变动"] .dc-txn').first().getByRole('link', { name }).click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  await expect(page.locator('section[aria-label="库存"] .dc-kv')).toContainText('15件');

  await page.locator('.dc-nav-item', { hasText: '商品' }).click();
  await expect(row).toContainText('价格 3 HTB · 库存 15');
  await expect(row).toContainText('已上架');

  await row.click();
  await expect(page.getByRole('switch')).toBeChecked();
  await page.getByRole('button', { name: '移除图片' }).click();
  await expect(page.getByAltText('商品图片预览')).toHaveCount(0);
  await page.locator('.dc-switch').click();
  await page.getByRole('button', { name: '保存商品' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText('商品已下架');
  await page.getByRole('button', { name: '返回' }).click();
  await expect(row).toContainText('已下架');
  await expect(row.locator('img')).toHaveCount(0);
});

test('the accountant reads products with their cost, without editing them', async ({ page }) => {
  await recordNotices(page);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff/new');
  await page.getByPlaceholder('如 teller02').fill('acct09');
  await page.getByPlaceholder('如 柜员小王').fill('财务小陈');
  await page.getByRole('combobox').selectOption({ label: '财务' });
  await page.getByRole('button', { name: '创建账号' }).click();
  await downloadNotices(page);
  const password = await noticePassword(page, 'acct09');
  await confirmIn(page, '取消');

  await signIn(page, '工作人员', 'acct09', '/login?add=1', password);
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByPlaceholder('至少 8 位').fill('20262027');
  await page.getByPlaceholder('再次输入新密码').fill('20262027');
  await page.getByRole('button', { name: '设置密码' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.locator('.dc-nav-item', { hasText: '商品' }).click();
  await expect(page.getByRole('link', { name: '新增商品' })).toHaveCount(0);
  await page.locator('.dc-list-link', { hasText: '海豚书签' }).click();
  await expect(page.locator('.dc-top-title')).toContainText('商品详情');
  await expect(page.locator('section[aria-label="商品信息"] .dc-kv')).toContainText(/成本\s*\d/);
  await expect(page.getByRole('button', { name: '保存商品' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '去出入库' })).toHaveCount(0);
});
