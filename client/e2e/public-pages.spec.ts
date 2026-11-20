import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn, sql } from './helpers';

// The three pages that need no sign-in (PHASE-2.md §16.4): 利率看板, 大屏时间 and 文件传输, with their links on the
// login page, and the bank admin's 文件传输 page. The tests run in order: a send made here is taken, then deleted.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

let code = '';
const pickup = (page: Page) => page.locator('.dc-pickup-code');
const boxes = (page: Page) => page.getByRole('group', { name: '取件码' }).locator('input');
const typed = (page: Page) => expect.poll(() => boxes(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)));

test('the login page links to the three pages, all on one 375×667 screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/login');
  const links = page.getByRole('list', { name: '不用登录的功能' }).getByRole('link');
  await expect(links).toHaveText(['利率看板', '大屏时间', '文件传输']);
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  // Staff sign-in has them too.
  await page.locator('.dc-seg label', { hasText: '工作人员' }).click();
  await links.nth(2).click();
  await expect(page).toHaveURL(/\/transfer$/);
  await page.goto('/login');
  await links.first().click();
  await expect(page).toHaveURL(/\/board$/);
});

test('利率看板: five tiles, 活期 at the bank admin’s 本周锚点, no sign-in', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/rates');
  const anchor = (await page.getByRole('region', { name: '本周锚点' }).locator('.dc-stat').first().textContent())!.replace('本周锚点', '');
  // Whether today has no trading, as the board reads it.
  const closed = sql(`select public_rates() -> 'wealth' ->> 'closed'`) === 'true';
  await page.goto('/board');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('海豚银行 · 利率实时');
  await expect(page.locator('.dc-board-panel h2')).toHaveText(['活期本周', '贷款本周', '定期本周', '指数今天', '理财今天']);
  await expect(page.getByRole('region', { name: '活期周利率' }).locator('.dc-board-hero')).toHaveText(anchor);
  await expect(page.getByRole('region', { name: '贷款周利率' }).locator('dt')).toHaveText(['600 分', '750 分', '900 分', '1000 分']);
  // The test data has no quote: on a closed day (a weekend) the index reads 休市 and the tiers their daily bases, on any
  // other — for both.
  const index = page.getByRole('region', { name: '参考指数涨跌' }).locator('dd');
  const tiers = page.getByRole('region', { name: '理财各倍率的收益' }).locator('div');
  if (closed) {
    await expect(index).toHaveText('休市');
    await expect(tiers).toHaveText([/^稳健×1\+\d/, /^平衡×2\+\d/, /^进取×4\+\d/]);
  } else {
    await expect(index).toHaveText('—');
    await expect(tiers).toHaveText(['稳健×1—', '平衡×2—', '进取×4—']);
  }
  await expect(page.getByRole('status')).toHaveText(/^更新于 \d\d:\d\d:\d\d$/);
});

test('大屏时间: Shanghai time to the second, calibrated', async ({ page }) => {
  await page.goto('/clock');
  await expect(page.locator('.dc-clock-time')).toHaveText(/^\d\d:\d\d:\d\d$/);
  await expect(page.locator('.dc-clock-date')).toHaveText(/^\d{1,2}月\d{1,2}日 星期[一二三四五六日]$/);
  const first = await page.locator('.dc-clock-time').textContent();
  await expect(page.locator('.dc-clock-time')).not.toHaveText(first!);
  await expect(page.getByText('未校准')).toHaveCount(0);
  expect(await page.title()).toBe('大屏时间');
});

test('发送 two small files for a pickup code', async ({ page }) => {
  await page.goto('/transfer');
  await page.locator('input[type="file"]').setInputFiles([
    { name: '报告.txt', mimeType: 'text/plain', buffer: Buffer.from('海豚银行 11 月报表') },
    { name: 'empty.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByRole('list', { name: '要发送的文件' }).locator('.dc-file-name')).toHaveText(['报告.txt', 'empty.bin']);
  await expect(page.locator('.dc-actions-total')).toHaveText('合计1KB');
  // On a computer the total sits under the list.
  await expect(page.getByText('2 个文件，合计 1 KB')).toBeVisible();
  await page.getByRole('button', { name: '上传 2 个文件' }).click();
  await expect(pickup(page)).toHaveText(/^\d{4}$/);
  code = (await pickup(page).textContent())!;
  await expect(pickup(page)).toHaveAttribute('aria-label', `取件码 ${code}`);
  await expect(page.locator('.dc-pickup-due')).toHaveText(/^\d{1,2}月\d{1,2}日 \d\d:\d\d 到期$/);
  await page.getByRole('button', { name: '再发一批' }).click();
  await expect(page.getByRole('button', { name: '上传 0 个文件' })).toBeDisabled();
});

test('接收 with the code lists the files and downloads them under their names', async ({ page }) => {
  await page.goto('/transfer');
  await page.getByRole('tab', { name: '接收' }).click();
  await expect(page.getByRole('button', { name: '取件' })).toBeDisabled();
  // Typing moves on box by box.
  await boxes(page).first().click();
  await page.keyboard.type(code);
  await typed(page).toEqual([...code]);
  await page.getByRole('button', { name: '取件' }).click();
  const files = page.getByRole('list', { name: '文件' });
  await expect(files.locator('.dc-file-name')).toHaveText(['报告.txt', 'empty.bin']);
  await expect(files.locator('small')).toHaveText(['1 KB', '1 KB']);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 报告.txt' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('报告.txt');
  expect((await import('node:fs')).readFileSync((await file.path())!, 'utf8')).toBe('海豚银行 11 月报表');
  // ?code= opens 接收 and takes it at once.
  await page.goto(`/transfer?code=${code}`);
  await expect(page.getByRole('tab', { name: '接收' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('list', { name: '文件' }).locator('.dc-list-item')).toHaveCount(2);
});

test('a wrong code says so and empties the boxes', async ({ page }) => {
  const wrong = sql(`select lpad(n::text, 4, '0') from generate_series(0, 9999) n where lpad(n::text, 4, '0') not in (select code from public.transfers) limit 1`);
  await page.goto('/transfer');
  await page.getByRole('tab', { name: '接收' }).click();
  await boxes(page).first().focus();
  // Pasting 4 digits fills all four boxes.
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text', text);
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, wrong);
  await typed(page).toEqual([...wrong]);
  await page.getByRole('button', { name: '取件' }).click();
  await expect(page.locator('.dc-notice-danger')).toContainText('取件码不对或已过期请核对 4 位取件码。取件码在生成后 7 天内有效。');
  await typed(page).toEqual(['', '', '', '']);
  await expect(boxes(page).first()).toBeFocused();
  await expect(page.locator('.dc-code')).toHaveClass(/is-error/);
});

test('后台「文件」lists the pickup without its code and deletes it with a reason', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/transfers');
  await expect(page.getByRole('heading', { name: '文件传输' })).toBeVisible();
  await expect(page.locator('.dc-caption')).toHaveText('未到期的取件 1 次，合计 1 KB，上限 5 GB。');
  const row = page.getByRole('list', { name: '未到期的取件' }).locator('.dc-list-item');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('2 个文件 · 1 KB');
  await expect(row).toContainText('报告.txt、empty.bin');
  await expect(row).not.toContainText(code);
  await row.getByRole('button', { name: '删除' }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('删除这 2 个文件？');
  await sheet.getByRole('button', { name: '确认删除' }).click();
  await expect(sheet.locator('.dc-field-hint')).toHaveText('请写明删除的原因');
  await sheet.getByLabel('原因').fill('发错了文件');
  await sheet.getByRole('button', { name: '确认删除' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('已删除');
  await expect(page.getByText('没有未到期的取件')).toBeVisible();
  // The log keeps it under 文件传输.
  await page.goto('/admin/audit');
  await expect(page.getByText('提前删除文件传输').first()).toBeVisible();
  // The code no longer opens.
  await page.goto(`/transfer?code=${code}`);
  await expect(page.locator('.dc-notice-danger')).toContainText('取件码不对或已过期');
});

test('the nav has 文件 after 日志 for the bank admin', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  const nav = page.getByRole('navigation', { name: '主导航' }).getByRole('link');
  await expect(nav.filter({ hasText: /^(参数|日志|文件|我的)$/ })).toHaveText(['参数', '日志', '文件', '我的']);
});
