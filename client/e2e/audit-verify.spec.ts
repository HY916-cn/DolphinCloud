import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';
import { downloadNotices, drawnNotices, recordNotices, resetData, signIn } from './helpers';

// The cases of the 2026-11-09 front-end audit (docs/audit/audit-2026-11-09.md, TASK-001…011) that safeguards.spec.ts
// does not reach: a roster read that never answers, a notice printed on a device in another time zone, 报表 with a
// 时段 that ends before it starts, a 时段 scrolled back to 00, and the memory of 500 notices.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);
test.use({ serviceWorkers: 'block' }); // page.route sees every request of the page

const roster = (url: URL) => url.pathname.endsWith('/rest/v1/students') && !!url.searchParams.get('select')?.startsWith('student_no,name,class_no');

// A roster file of `count` new students, 学号 from `first` on.
const rosterFile = (first: number, count: number) => ({
  name: '名册.csv', mimeType: 'text/csv',
  buffer: Buffer.from('﻿' + [['学号', '姓名', '学部', '学届', '班号', '期初余额'],
    ...Array.from({ length: count }, (_, i) => [String(first + i), `新生${i + 1}`, '小学部', '2023', '1', ''])].map((r) => r.join(',')).join('\n')),
});
async function importRoster(page: Page, first: number, count: number) {
  await page.goto('/admin/students/import');
  await page.getByLabel('选择名册文件').setInputFiles(rosterFile(first, count));
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByRole('button', { name: '开户通知单' })).toBeVisible({ timeout: 120_000 });
}

test('TASK-006: a roster read that never answers gives up after 5 s and says the device has no roster', async ({ page }) => {
  const held: Route[] = [];
  await page.route(roster, (route) => { held.push(route); }); // never answered
  const asked = page.waitForRequest((r) => roster(new URL(r.url())));
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await asked;
  const start = Date.now();
  const empty = page.locator('.dc-empty', { hasText: '这台设备还没有名册' });
  await expect(empty).toContainText('请联网后重试。名册下载后，断网也能搜索学生。', { timeout: 10_000 });
  expect(Date.now() - start).toBeGreaterThan(4_000); // the 5 s timeout, not a failure at once
  expect(held.length).toBeGreaterThan(0);

  await page.unroute(roster);
  await empty.getByRole('button', { name: '重试' }).click();
  await expect(empty).toHaveCount(0);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zxm');
  await expect(page.locator('.dc-list-link', { hasText: '张小明' })).toBeVisible();
});

test.describe(() => {
  test.use({ timezoneId: 'America/New_York' });

  test('TASK-008: a notice printed in New York carries the date in Shanghai', async ({ page }) => {
    await recordNotices(page);
    await signIn(page, '工作人员', 'admin');
    await expect(page).toHaveURL(/\/admin$/);
    await importRoster(page, 20280001, 1);
    // 09:00 on 10 November in Shanghai is 20:00 on 9 November in New York.
    await page.clock.setFixedTime(new Date('2026-11-10T09:00:00+08:00'));
    expect(await page.evaluate(() => new Date().getDate())).toBe(9);
    await page.getByRole('button', { name: '开户通知单' }).click();
    const file = await downloadNotices(page);
    expect(file.suggestedFilename()).toBe('开户通知单-2026-11-10-1人.pdf');
    const stamps = (await drawnNotices(page)).filter((t) => t.startsWith('明德实验学校海豚银行 · '));
    expect(stamps).toHaveLength(1);
    expect(stamps[0]).toContain('2026年11月10日');
  });
});

test('TASK-011: 报表 asks for nothing and exports nothing while its 时段 ends before it starts', async ({ page }) => {
  const pickTime = async (field: string, value: string) => {
    await page.getByRole('button', { name: field, exact: true }).click();
    await page.getByRole('button', { name: value, exact: true }).click();
    await page.getByRole('dialog', { name: `选择${field}` }).getByRole('button', { name: '确定' }).click();
  };
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/reports');
  const out = page.getByRole('button', { name: '打印 / 导出' });
  await expect(out).toBeEnabled();
  await page.getByRole('button', { name: '按时段' }).click();
  await pickTime('每天从', '10时');
  let reads = 0;
  page.on('request', (r) => { if (r.url().includes('/rest/v1/rpc/bank_report')) reads++; });
  await pickTime('每天到', '9时');
  await expect(page.locator('.dc-notice-danger')).toHaveText(/时段有误.*结束时间要晚于开始时间。/s);
  await expect(out).toBeDisabled();
  await page.waitForTimeout(800);
  expect(reads).toBe(0);
  await pickTime('每天到', '11时');
  await expect(page.locator('.dc-notice-danger')).toHaveCount(0);
  await expect(out).toBeEnabled();
  expect(reads).toBeGreaterThan(0);
});

test('TASK-009: an empty 时段 scrolled away and back to 00 is 00:00', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/txns');
  await page.getByRole('button', { name: '按时段' }).click();
  const from = page.getByRole('button', { name: '每天从', exact: true });
  await expect(from).toHaveText('0:00'); // the placeholder: empty
  await from.click();
  const dialog = page.getByRole('dialog', { name: '选择每天从' });
  const hours = dialog.getByRole('group', { name: '时' });
  await hours.evaluate((el) => el.scrollTo({ top: 3 * 44, behavior: 'instant' }));
  await expect(from).toHaveText('03:00');
  await hours.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
  await expect(from).toHaveText('00:00');
  await dialog.getByRole('button', { name: '确定' }).click();
  await expect(dialog).toBeHidden();
  await expect(from).toHaveText('00:00');
});

test('TASK-007: 500 notices keep the ArrayBuffer memory small', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'reads V8 heap figures through the Chrome DevTools Protocol');
  test.setTimeout(300_000);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await importRoster(page, 20290001, 500);
  await page.getByRole('button', { name: '开户通知单' }).click();

  // Runtime.getHeapUsage every 50 ms while the 500 pages are drawn and saved: backingStorageSize is the memory
  // behind ArrayBuffers (outside the JS heap); the JPEGs themselves are Blobs, kept by the browser.
  const cdp = await page.context().newCDPSession(page);
  const sample = () => cdp.send('Runtime.getHeapUsage') as Promise<{ usedSize: number; backingStorageSize: number }>;
  const base = await sample();
  let peak = { buffers: 0, heap: 0 };
  let done = false;
  const sampling = (async () => {
    while (!done) {
      const u = await sample();
      peak = { buffers: Math.max(peak.buffers, u.backingStorageSize), heap: Math.max(peak.heap, u.usedSize) };
      await new Promise((ok) => setTimeout(ok, 50));
    }
  })();
  const start = Date.now();
  const file = await downloadNotices(page);
  const pdf = await readFile(await file.path());
  const seconds = (Date.now() - start) / 1000;
  done = true;
  await sampling;

  const mb = (n: number) => Math.round(n / 1e5) / 10;
  const figures = `500 pages in ${seconds.toFixed(1)} s; ArrayBuffer peak ${mb(peak.buffers)} MB (before ${mb(base.backingStorageSize)} MB);`
    + ` JS heap peak ${mb(peak.heap)} MB; PDF ${mb(pdf.length)} MB`;
  test.info().annotations.push({ type: 'TASK-007', description: figures });
  console.log(`TASK-007: ${figures}`);
  expect(pdf.toString('latin1').match(/\/Type \/Page /g)?.length).toBe(500);
  expect(peak.buffers).toBeLessThan(32e6); // 132 MB when every JPEG was held as a Uint8Array
});
