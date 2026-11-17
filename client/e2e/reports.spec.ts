import { expect, test, type Download } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 报表 and the counter's 查询 (PHASE-1.md §6.8, §7.5, §7.9) on the seed data: today teller01 served 张小明 (20260001: a
// deposit of 25, a withdrawal of 15, an exchange of 22 from the account) and 李思远 (20260002: a cash exchange of 6, a
// deposit of 10); the opening balances 120 and 60 were imported 20 days ago.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const sheets = async (download: Download) => XLSX.readFile((await download.path())!);
const rowsOf = (book: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1 });
// The PDF's pages: one /Type /Page object each (lib/pdf.ts).
const pagesOf = async (download: Download) => readFileSync((await download.path())!, 'latin1').match(/\/Type \/Page\b/g)?.length ?? 0;

test('报表: today in figures, charts and tables, the balance check, and the PDF', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('.dc-nav-item', { hasText: '报表' }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await page.getByRole('button', { name: '今天' }).click();
  const report = page.locator('section[aria-label="报表"]');
  await expect(report.locator('.dc-stat', { hasText: '存款' })).toContainText('35HTB · 2 笔');
  await expect(report.locator('.dc-stat', { hasText: '存款' })).toContainText('上期为 0'); // yesterday had none
  await expect(report.locator('.dc-stat', { hasText: '兑换' })).toContainText('28HTB · 2 笔');
  await expect(report.getByRole('table', { name: '按柜员' })).toContainText('柜员小林');

  await page.getByRole('tab', { name: '账户' }).click();
  await expect(report.locator('.dc-stat', { hasText: '期末账面余额' })).toContainText('178');
  await expect(report.getByRole('table', { name: '按班级' })).toContainText('八年级(3)班');
  await page.getByRole('tab', { name: '财务' }).click();
  await expect(report.locator('.dc-notice-success')).toContainText('期初 180 + 本期变动 −2 = 期末 178 HTB');
  await page.getByRole('tab', { name: '商品' }).click();
  await expect(report.getByRole('table', { name: '商品兑换' })).toContainText('海浪中性笔');

  // The month draws a chart per day, on a rounded scale.
  await page.getByRole('button', { name: '本月' }).click();
  await page.getByRole('tab', { name: '营业' }).click();
  await expect(report.getByRole('img', { name: /^存款：/ })).toBeVisible();
  await expect(report.locator('.dc-chart', { hasText: '存款' }).locator('.dc-chart-grid small').first()).toHaveText(/^\d+$/);

  // One student, found as at the counter; the report as a PDF, a page for each table or chart.
  await page.getByRole('button', { name: '今天' }).click();
  await page.getByRole('searchbox', { name: '搜索学生范围' }).fill('张小明');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(report.locator('.dc-stat', { hasText: '存款' })).toContainText('25HTB · 1 笔');
  await page.getByRole('button', { name: '打印 / 导出' }).click();
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  expect((await download).suggestedFilename()).toMatch(/^银行报表-\d{4}-\d{2}-\d{2}至\d{4}-\d{2}-\d{2}-学号20260001\.pdf$/);
  expect(await pagesOf(await download)).toBeGreaterThanOrEqual(6);

  // A 时段 that ends before the day's business leaves it out. 张小明's business of today (seeded at one instant) moves to
  // noon first, so this holds at any hour; txns is append-only, so replica mode skips its trigger for the update.
  sql(`set session_replication_role = replica; update public.txns
    set created_at = (app_private.cn_date(now()) + time '12:00') at time zone 'Asia/Shanghai'
    where student_no = '20260001' and app_private.cn_date(created_at) = app_private.cn_date(now())`);
  await page.getByRole('button', { name: '按时段' }).click();
  await page.getByRole('button', { name: '每天到', exact: true }).click();
  await page.getByRole('button', { name: '0时', exact: true }).click();
  await page.getByRole('button', { name: '5分', exact: true }).click();
  await expect(report.locator('.dc-stat', { hasText: '存款' })).toContainText('0HTB · 0 笔');
});

test('报表: 打印 sends the pages to the print dialog', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/reports');
  await page.getByRole('button', { name: '今天' }).click();
  await expect(page.locator('.dc-stat').first()).toBeVisible();
  await page.evaluate(() => {
    // The frame printPages adds: count its pages when it asks to print.
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
      if (n instanceof HTMLIFrameElement) n.contentWindow!.print = () => { (window as unknown as { printed: number }).printed = n.contentDocument!.images.length; };
    }))).observe(document.body, { childList: true });
  });
  await page.getByRole('button', { name: '打印 / 导出' }).click();
  await confirmIn(page, '打印');
  const printed = await page.waitForFunction(() => (window as unknown as { printed?: number }).printed).then((h) => h.jsonValue());
  expect(printed).toBeGreaterThanOrEqual(6);
});

test('流水: one search for a student, a teller or a 交易号, then export what the filters choose', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/txns');
  const search = page.getByRole('searchbox', { name: '搜索学生、班级、柜员或交易号' });
  await search.fill('lsy');
  await page.getByRole('list', { name: '搜索建议' }).locator('.dc-list-link', { hasText: '李思远' }).click();
  await page.getByRole('button', { name: '兑换', exact: true }).click();
  await expect(page.locator('.dc-list-title')).toHaveText('共 1 笔');
  await search.fill('柜员');
  await page.getByRole('list', { name: '搜索建议' }).locator('.dc-list-link', { hasText: '柜员小林' }).click();
  await expect(page.getByRole('button', { name: '去掉条件：柜员 柜员小林' })).toBeVisible();
  await expect(page.locator('.dc-list-title')).toHaveText('共 1 笔');

  await page.getByRole('button', { name: '打印 / 导出' }).click();
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^流水-截至\d{4}-\d{2}-\d{2}\.xlsx$/);
  const rows = rowsOf(await sheets(await download), '流水明细');
  expect(rows).toHaveLength(2);
  expect(rows[1].slice(2, 8)).toEqual(['20260002', '李*远', '八年级(3)班', '兑换', 6, '现金']);
  await page.getByRole('button', { name: '打印 / 导出' }).click();
  download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  expect((await download).suggestedFilename()).toMatch(/^流水-\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.getByRole('button', { name: '清除条件' }).click();
  await expect(page.getByRole('button', { name: /^去掉条件/ })).toHaveCount(0);
});

test('查询 at the counter: the account and every transaction, filtered, also after a business of the visit', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('lsy');
  await page.locator('.dc-list-link', { hasText: '李思远' }).click();
  await page.locator('.dc-seg label', { hasText: '查询' }).click();
  const query = page.locator('section[aria-label="账户查询"]');
  await expect(page.locator('aside[aria-label="办理单"]')).toHaveCount(0); // 查询 takes the whole width
  await expect(query.locator('.dc-stat', { hasText: '累计存入' })).toContainText('70HTB');
  await expect(query.locator('.dc-stat', { hasText: '当前余额' })).toContainText('70HTB');
  const rows = query.getByRole('list', { name: '交易记录' }).locator('.dc-txn');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('存款');
  await expect(rows.nth(0)).toContainText('经办人 柜员小林');
  await expect(rows.nth(1)).toContainText('现金支付，余额不变');
  await expect(rows.nth(2)).toContainText('期初余额');
  await query.getByRole('button', { name: '兑换', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await query.getByRole('button', { name: '清除条件' }).click();
  await query.getByRole('searchbox', { name: '搜索交易号或商品' }).fill('中性笔');
  await expect(rows).toHaveCount(1);
  await query.getByRole('button', { name: '清除条件' }).click();

  await page.locator('.dc-seg label', { hasText: '存款' }).click();
  await page.getByLabel('增加一张 5 元').click();
  await page.getByRole('button', { name: '确认存款 5 HTB' }).click();
  await expect(page.locator('aside[aria-label="办理单"]')).toContainText('HT');
  await page.locator('.dc-seg label', { hasText: '查询' }).click();
  await expect(rows).toHaveCount(4);
  await expect(query.locator('.dc-stat', { hasText: '当前余额' })).toContainText('75HTB');
});
