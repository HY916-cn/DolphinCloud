import { readFile } from 'node:fs/promises';
import { expect, test, type Download } from '@playwright/test';
import { confirmIn, downloadNotices, drawnNotices as drawn, noticePassword, recordNotices, resetData, signIn } from './helpers';

// 工作人员导入与免密码绑定 (PHASE-2.md §5.1–5.3), on the seed data: students 20260001, 20260002, 20260003; teller01.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const sheet = (rows: string[][]) => ({
  name: '工作人员.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from('﻿' + [['账号', '姓名', '身份', '工资账户'], ...rows].map((r) => r.join(',')).join('\n')),
});
const pages = async (file: Download) => (await readFile(await file.path())).toString('latin1').match(/\/Type \/Page /g)?.length;
const RESET_FILE = (n: number) => new RegExp(`^重置密码通知单-\\d{4}-\\d{2}-\\d{2}-${n}人\\.pdf$`);

test('a staff sheet with problems is shown row by row and nothing is imported', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff');
  await page.getByRole('link', { name: '导入', exact: true }).click();
  await page.getByLabel('选择工作人员表').setInputFiles(sheet([
    ['teller71', '柜员甲', '柜员', '99999999'],
    ['ops71', '运维甲', '运维员', '20260001'],
    ['boss71', '管理员', '银行管理员', ''],
  ]));
  const problems = page.getByRole('list', { name: '需要修改的地方' });
  await expect(problems).toContainText('第 2 行：工资账户：学号 99999999 不存在');
  await expect(problems).toContainText('第 3 行：运维员不参与考勤，工资账户请留空');
  await expect(problems).toContainText('第 4 行：银行管理员不能导入');
  await expect(page.getByRole('button', { name: '确认导入' })).toHaveCount(0);
});

let password = '';

test('the bank admin imports staff, binds tellers at once and prints one notice each', async ({ page }) => {
  await recordNotices(page);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff/import');
  await page.getByLabel('选择工作人员表').setInputFiles(sheet([
    ['teller71', '柜员甲', '柜员', '20260001'],
    ['teller72', '柜员乙', '柜员', ''],
    ['store71', '库管甲', '库管', ''],
    ['teller01', '柜员小林', '柜员', '20260002'],
  ]));
  await expect(page.locator('.dc-kv')).toContainText('填了工资账户');
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.locator('.dc-result')).toContainText('新建 3 人，更新 1 人，绑定工资账户 2 人');
  await page.getByRole('button', { name: '打印通知单' }).click();
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^工作人员通知单-\d{4}-\d{2}-\d{2}-3人\.pdf$/);
  expect((await readFile(await file.path())).toString('latin1').match(/\/Type \/Page /g)?.length).toBe(3);
  const texts = await drawn(page);
  expect(texts).toContain('柜员甲，你好');
  expect(texts).toContain('工资账户');
  expect(texts.some((t) => /（20260001）$/.test(t))).toBe(true);
  expect(texts).toContain('未绑定');
  password = texts[texts.indexOf('初始密码', texts.indexOf('teller71')) + 1];
  expect(password).toMatch(/^\d{8}$/);
  // 库管 is counted for pay too: its notice has the 工资账户 row.
  expect(texts.slice(texts.indexOf('库管甲，你好'))).toContain('工资账户');

  await page.goto('/admin/staff');
  await expect(page.getByRole('list', { name: '工作人员' })).toContainText('柜员小林');
  await page.locator('.dc-list-link', { hasText: '柜员甲' }).click();
  await expect(page.locator('section[aria-label="工资账户"]')).toContainText('20260001');
});

test('resetting one teller prints a notice that says so and names the pay account', async ({ page }) => {
  await recordNotices(page);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff');
  await page.locator('.dc-list-link', { hasText: '柜员甲' }).click();
  await page.getByRole('button', { name: '重置密码' }).click();
  await confirmIn(page, '重置密码');
  await expect(page.locator('.dc-sheet')).toContainText('1 份重置密码通知单');
  await expect(page.locator('.dc-notice-success')).not.toContainText(/\d{8}/);
  const file = await downloadNotices(page);
  expect(file.suggestedFilename()).toMatch(RESET_FILE(1));
  expect(await pages(file)).toBe(1);
  const texts = await drawn(page);
  expect(texts).toContain('柜员甲，密码已重置');
  expect(texts.some((t) => /· 密码已重置 · \d{4}年\d+月\d+日 \d{2}:\d{2}$/.test(t))).toBe(true);
  expect(texts.some((t) => /（20260001）$/.test(t))).toBe(true);
  password = await noticePassword(page, 'teller71');
  expect(password).toMatch(/^\d{8}$/);
  await signIn(page, '工作人员', 'teller71', '/login?add=1', password);
  await expect(page).toHaveURL(/\/change-password$/);
});

test('resetting many staff or students prints one notice each', async ({ page }) => {
  await recordNotices(page);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  const pick = (name: string) => page.locator('.dc-batch-pick', { hasText: `选择${name}` }).click();

  await page.goto('/admin/staff');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pick('柜员乙');
  await pick('库管甲');
  await page.getByRole('toolbar').getByRole('button', { name: '重置密码' }).click();
  await confirmIn(page, '重置');
  await expect(page.locator('.dc-sheet')).toContainText('2 份重置密码通知单');
  let file = await downloadNotices(page);
  expect(file.suggestedFilename()).toMatch(RESET_FILE(2));
  expect(await pages(file)).toBe(2);
  expect(await drawn(page)).toContain('库管甲，密码已重置');
  expect(await noticePassword(page, 'store71')).toMatch(/^\d{8}$/);

  await page.goto('/admin/students');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pick('王小雨');
  await page.getByRole('toolbar').getByRole('button', { name: '重置密码' }).click();
  await confirmIn(page, '重置并生成通知单');
  await expect(page.locator('.dc-sheet')).toContainText('1 份重置密码通知单');
  file = await downloadNotices(page);
  expect(file.suggestedFilename()).toMatch(RESET_FILE(1));
  expect(await drawn(page)).toContain('王小雨同学，密码已重置');
  expect(await noticePassword(page, '20260003')).toMatch(/^\d{8}$/);
});

test('the new login signs in with the notice and must set a new password', async ({ page }) => {
  await signIn(page, '工作人员', 'teller71', '/login?add=1', password);
  await expect(page).toHaveURL(/\/change-password$/);
});

test('the bank admin binds one teller without the student password', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff');
  await page.locator('.dc-list-link', { hasText: '柜员乙' }).click();
  const section = page.locator('section[aria-label="工资账户"]');
  await expect(section.locator('input[type="password"]')).toHaveCount(0);
  await section.locator('input').first().fill('20260003');
  await section.getByRole('button', { name: '绑定' }).click();
  await expect(page.getByText('工资账户已绑定')).toBeVisible();
  await page.goto('/admin/audit');
  await expect(page.locator('section[aria-label="操作日志"] .dc-txn', { hasText: '绑定工资账户' }).first()).toContainText('柜员乙');
});
