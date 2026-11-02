import { expect, test, type Download } from '@playwright/test';
import * as XLSX from 'xlsx';
import { resetData, signIn } from './helpers';

// 报表 and the counter's 查询 (PHASE-1.md §6.8, §7.5, §7.9) on the seed data: today teller01 served 张小明 (20260001: a
// deposit of 25, a withdrawal of 15, an exchange of 22 from the account) and 李思远 (20260002: a cash exchange of 6, a
// deposit of 10); the opening balances 120 and 60 were imported 20 days ago.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const sheets = async (download: Download) => XLSX.readFile((await download.path())!);
const rowsOf = (book: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1 });

test('报表: today in figures, charts and tables, the balance check, and the Excel workbook', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('.dc-nav-item', { hasText: '报表' }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await page.getByRole('button', { name: '今天' }).click();
  const report = page.locator('section[aria-label="报表"]');
  await expect(report.locator('.rp-stat', { hasText: '存款' })).toContainText('35HTB · 2 笔');
  await expect(report.locator('.rp-stat', { hasText: '兑换' })).toContainText('28HTB · 2 笔');
  await expect(report.getByRole('table', { name: '按柜员' })).toContainText('柜员小林');

  await page.getByRole('tab', { name: '账户' }).click();
  await expect(report.locator('.rp-stat', { hasText: '期末账面余额' })).toContainText('178');
  await expect(report.getByRole('table', { name: '按班级' })).toContainText('八年级(3)班');
  await page.getByRole('tab', { name: '财务' }).click();
  await expect(report.locator('.dc-notice-success')).toContainText('期初 180 + 本期变动 −2 = 期末 178 HTB');
  await page.getByRole('tab', { name: '商品' }).click();
  await expect(report.getByRole('table', { name: '商品兑换' })).toContainText('海浪中性笔');

  // The month draws a chart per day.
  await page.getByRole('button', { name: '本月' }).click();
  await page.getByRole('tab', { name: '营业' }).click();
  await expect(report.getByRole('img', { name: /^存款：/ })).toBeVisible();

  // One student, found as at the counter; names in the file are masked unless asked for.
  await page.getByRole('button', { name: '今天' }).click();
  await page.getByRole('searchbox', { name: '搜索学生范围' }).fill('张小明');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(report.locator('.rp-stat', { hasText: '存款' })).toContainText('25HTB · 1 笔');
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^银行报表-\d{4}-\d{2}-\d{2}至\d{4}-\d{2}-\d{2}-学号20260001\.xlsx$/);
  let book = await sheets(await download);
  expect(book.SheetNames).toEqual(['汇总', '按日', '按时段', '按柜员', '按班级', '余额分布', '商品兑换', '库存', '货币发行', '流水明细']);
  expect(rowsOf(book, '汇总')).toContainEqual(['存款', 1, 25]);
  const ledger = rowsOf(book, '流水明细');
  expect(ledger.slice(1).map((r) => r[3])).toEqual(['张*明', '张*明', '张*明']);
  download = page.waitForEvent('download');
  await page.getByText('导出完整姓名').click();
  await page.getByRole('button', { name: '导出 Excel' }).click();
  book = await sheets(await download);
  expect(rowsOf(book, '流水明细')[1][3]).toBe('张小明');

  // A 时段 that ends before the day's business leaves it out.
  await page.getByLabel('时段结束').fill('00:01');
  await expect(report.locator('.rp-stat', { hasText: '存款' })).toContainText('0HTB · 0 笔');
});

test('报表: 打印 / 存为 PDF prints every tab', async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {
      (window as unknown as { printed: string }).printed = document.querySelector('section[aria-label="报表"]')!.textContent!;
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/reports');
  await page.getByRole('button', { name: '今天' }).click();
  await expect(page.locator('.rp-stat').first()).toBeVisible();
  await page.getByRole('button', { name: '打印 / 存为 PDF' }).click();
  const printed = await page.waitForFunction(() => (window as unknown as { printed?: string }).printed).then((h) => h.jsonValue());
  for (const text of ['海豚银行报表', '按柜员', '按班级', '核对一致', '商品兑换', '库存']) expect(printed).toContain(text);
  await expect(page.getByRole('tab', { name: '营业' })).toBeVisible(); // back to the tabs after printing
});

test('流水: export what the filters choose', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/txns');
  await page.getByLabel('支付方式').selectOption({ label: '现金' });
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.dc-list-title')).toHaveText('共 1 笔');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^流水-截至\d{4}-\d{2}-\d{2}\.xlsx$/);
  const rows = rowsOf(await sheets(await download), '流水明细');
  expect(rows).toHaveLength(2);
  expect(rows[1].slice(2, 8)).toEqual(['20260002', '李*远', '八年级(3)班', '兑换', 6, '现金']);
});

test('查询 at the counter: the account and every transaction, also after a business of the visit', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('lsy');
  await page.locator('.dc-list-link', { hasText: '李思远' }).click();
  await page.locator('.dc-seg label', { hasText: '查询' }).click();
  const query = page.locator('section[aria-label="账户查询"]');
  await expect(query.locator('.dc-kv')).toContainText('累计存入70 HTB');
  await expect(query.locator('.dc-kv')).toContainText('当前余额70');
  const rows = query.getByRole('list', { name: '交易记录' }).locator('.dc-txn');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('存款');
  await expect(rows.nth(0)).toContainText('经办人 柜员小林');
  await expect(rows.nth(1)).toContainText('现金支付，余额不变');
  await expect(rows.nth(2)).toContainText('期初余额');

  await page.locator('.dc-seg label', { hasText: '存款' }).click();
  await page.getByLabel('增加一张 5 元').click();
  await page.getByRole('button', { name: '确认存款 5 HTB' }).click();
  await expect(page.locator('aside[aria-label="办理单"]')).toContainText('HT');
  await page.locator('.dc-seg label', { hasText: '查询' }).click();
  await expect(rows).toHaveCount(4);
  await expect(query.locator('.dc-kv')).toContainText('当前余额75');
});
