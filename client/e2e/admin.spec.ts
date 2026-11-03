/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn } from './helpers';

// The back office's logins (M4, PHASE-1.md §6.4–6.5): the teacher imports a roster and a new student signs in for the
// first time; staff logins are created and managed.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

// The 开户通知单 PDF is drawn on a canvas: record every text drawn, before the page loads.
const recordNotices = (page: Page) => page.addInitScript(() => {
  const drawn: string[] = ((window as unknown as { notices: string[] }).notices = []);
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    drawn.push(String(text));
    return fill.call(this, text, ...rest);
  };
});
// The initial password on a student's notice: the text after the first 初始密码 label that follows their number.
const noticePassword = (page: Page, no: string) =>
  page.evaluate((no) => { const t = (window as unknown as { notices: string[] }).notices; return t[t.indexOf('初始密码', t.indexOf(no)) + 1] ?? ''; }, no);
// The downloaded PDF has one page per notice.
async function noticePages(download: Download) {
  expect(download.suggestedFilename()).toMatch(/^开户通知单-\d{4}-\d{2}-\d{2}-\d+人\.pdf$/);
  return (await readFile(await download.path())).toString('latin1').match(/\/Type \/Page /g)?.length ?? 0;
}
let reissued = ''; // 20260003's password from the reprinted notices, for the lockout test

const now = new Date();
const schoolYear = now.getFullYear() - (now.getMonth() < 8 ? 1 : 0); // promotion_date 09-01
const roster = (rows: (string | number)[][]) => ({
  name: '名册.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from('﻿' + [['学号', '姓名', '学部', '学届', '班号', '期初余额'], ...rows].map((r) => r.join(',')).join('\n')),
});

test('a roster with problems is shown row by row and nothing is imported', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '学生' }).click();
  await page.getByRole('link', { name: '导入名册' }).click();
  await page.getByLabel('选择名册文件').setInputFiles(roster([
    ['20269001', '周一', '高中部', schoolYear - 3, 1, 10],
    ['20269001', '', '小学部', schoolYear - 3, 1, ''],
  ]));
  await expect(page.locator('.dc-notice-danger')).toContainText('名册有 3 处需要修改');
  await expect(page.getByRole('list', { name: '需要修改的地方' })).toContainText('第 3 行：学号 20269001 与第 2 行重复。');
});

test('the teacher imports a roster, the new student signs in and must set a new password', async ({ page }) => {
  await recordNotices(page);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students/import');
  await page.getByLabel('选择名册文件').setInputFiles(roster([
    ['20269001', '周一鸣', '小学部', schoolYear - 3, 1, 30],
    ['20269002', '吴二', '初中部', schoolYear - 1, 2, ''],
    ['20260001', '张小明', '小学部', schoolYear - 4, 1, 999], // existing: details only, never the balance
  ]));
  await expect(page.locator('.dc-kv')).toContainText('期初余额合计');
  await page.getByRole('button', { name: '确认导入' }).click();
  await expect(page.locator('.dc-result')).toContainText('新开户 2 人，更新 1 人');
  await page.getByRole('button', { name: '开户通知单' }).click();
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  expect(await noticePages(await download)).toBe(2);
  const drawn = await page.evaluate(() => (window as unknown as { notices: string[] }).notices);
  expect(drawn).toContain('四年级(1)班');
  // The address to sign in at is the site's configured one (https://$DOLPHIN_DOMAIN), not the one this page uses.
  expect(drawn).toContain(await page.evaluate(() => window.__DOLPHIN_CONFIG__!.supabaseUrl));
  expect(drawn).not.toContain(new URL(page.url()).origin);
  const password = await noticePassword(page, '20269001');
  expect(password).toMatch(/^\d{8}$/);
  expect(await noticePassword(page, '20269002')).not.toBe(password);
  await confirmIn(page, '取消');

  await page.getByRole('button', { name: '返回学生' }).click();
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zym');
  await page.locator('.dc-list-link', { hasText: '周一鸣' }).click();
  await expect(page.locator('.dc-person')).toContainText('30');
  await expect(page.locator('.dc-kv')).toContainText('还未设置新密码');

  // The student signs in on this device too (it becomes a second account here), with the password on their notice.
  await signIn(page, '学生', '20269001', '/login?add=1', password);
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByPlaceholder('至少 8 位，可以全是数字').fill('20262026');
  await page.getByPlaceholder('再次输入新密码').fill('20262026');
  await page.getByRole('button', { name: '设置密码' }).click();
  await expect(page.locator('.dc-balance-amount')).toContainText('30');
});

test('the teacher resets a student password to a new initial one, shown once', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students/20269001');
  await expect(page.locator('.dc-kv')).toContainText('已设置新密码');
  await page.getByRole('button', { name: '重置密码' }).click();
  await confirmIn(page, '重置密码');
  await expect(page.locator('.dc-notice-success')).toContainText('密码已重置');
  await expect(page.locator('.dc-kv')).toContainText('还未设置新密码');
  const password = (await page.locator('.dc-notice-success').innerText()).match(/新的初始密码：(\d{8})/)?.[1];
  expect(password).toBeTruthy();
  await signIn(page, '学生', '20269001', '/login?add=1', password);
  await expect(page).toHaveURL(/\/change-password$/);
});

test('staff logins: create one, change its role, stop it; a sysadmin cannot touch a teacher', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '人员' }).click();
  await page.getByRole('link', { name: '新增账号' }).click();
  await page.getByPlaceholder('如 teller02').fill('Teller09');
  await page.getByPlaceholder('如 柜员小王').fill('柜员小周');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText('teller09 已创建');
  await expect(page.locator('.dc-notice-success')).toContainText(/初始密码 \d{8}。/);

  await page.goto('/admin/staff');
  await page.locator('.dc-list-link', { hasText: '柜员小周' }).click();
  await page.getByRole('combobox').selectOption({ label: '库管' });
  await page.getByRole('button', { name: '保存身份' }).click();
  await confirmIn(page, '确认修改');
  await expect(page.locator('.dc-person')).toContainText('库管');
  await page.getByRole('button', { name: '停用账号' }).click();
  await confirmIn(page, '停用账号');
  await expect(page.locator('.dc-kv')).toContainText('已停用');

  await signIn(page, '工作人员', 'ops01', '/login?add=1');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff');
  await page.locator('.dc-list-link', { hasText: '银行管理员' }).first().click();
  await expect(page.locator('.dc-notice')).toContainText('银行管理员只有一个');
  await expect(page.getByRole('button', { name: '重置密码' })).toHaveCount(0);
});

test('批量: create two staff logins at once, stop one, which then cannot sign in, and close the other', async ({ page }) => {
  await recordNotices(page);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/staff/new');
  await page.getByLabel('每行一个账号').fill('teller21 柜员甲\nteller22 柜员乙 柜员');
  await page.getByRole('button', { name: '创建 2 个账号' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('2 个账号的初始密码');
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  expect((await download).suggestedFilename()).toMatch(/^工作人员初始密码-\d{4}-\d{2}-\d{2}\.pdf$/);
  const password = await page.evaluate(() => { const t = (window as unknown as { notices: string[] }).notices; return t[t.indexOf('teller21') + 1]; });
  expect(password).toMatch(/^\d{8}$/);
  await confirmIn(page, '取消');

  const pick = async (name: string) => page.locator('.bt-pick', { hasText: `选择${name}` }).click();
  await page.goto('/admin/staff');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pick('柜员甲');
  await page.getByRole('toolbar', { name: '批量操作' }).getByRole('button', { name: '停用' }).click();
  await confirmIn(page, '停用');
  await expect(page.locator('.dc-notice-success')).toContainText('已停用 1 个账号');
  await expect(page.getByRole('list', { name: '工作人员' })).not.toContainText('柜员甲');

  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pick('柜员乙');
  await page.getByRole('toolbar', { name: '批量操作' }).getByRole('button', { name: '注销' }).click();
  await confirmIn(page, '继续');
  await confirmIn(page, '确认注销');
  await expect(page.locator('.dc-notice-success')).toContainText('已注销 1 个账号');
  await expect(page.getByRole('list', { name: '工作人员' })).not.toContainText('柜员乙');
  // 待办 counts the stopped logins 已停用 lists; the closed one is gone for good.
  const stopped = (await page.getByRole('group', { name: '筛选' }).getByRole('button', { name: /^已停用 \d+$/ }).textContent())!.match(/\d+/)![0];
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: /个工作人员账号已停用/ })).toHaveText(new RegExp(`^${stopped} 个工作人员账号已停用`));

  await signIn(page, '工作人员', 'teller21', '/login?add=1', password);
  await expect(page.locator('.dc-notice-danger')).toContainText('这个账号已被停用');
});

test('注销 a student: after a second confirmation the student leaves the list', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students/20269002');
  await page.getByRole('button', { name: '注销账号' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('永久停用');
  await confirmIn(page, '继续');
  await confirmIn(page, '确认注销');
  await expect(page.locator('.dc-notice-success')).toContainText('已注销 1 个账号');
  await page.goto('/admin/students');
  await expect(page.getByRole('list', { name: '学生' })).not.toContainText('吴二');
});

test('总览 links the students who have not set a new password to the filtered 学生 list', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('section[aria-label="待办"] .dc-list-link', { hasText: '名学生还未设置新密码' }).click();
  await expect(page).toHaveURL(/\/admin\/students\?filter=waiting$/);
  const chip = page.getByRole('button', { name: /^未设置密码/ });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const rows = page.getByRole('list', { name: '学生' }).locator('.dc-list-link');
  await expect(rows.filter({ hasText: '王小雨' })).toHaveCount(1);
  await expect(rows.filter({ hasNotText: '未设置密码' })).toHaveCount(0);
  await chip.click();
  await expect(rows.filter({ hasText: '张小明' })).toHaveCount(1);
});

// 20269001 was imported above with an opening balance of 30; nothing after this relies on it.
test('学生 → 查看全部流水 shows only that student, and the teacher reverses the opening balance there', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students/20269001');
  await page.getByRole('link', { name: '查看全部流水' }).click();
  await expect(page).toHaveURL(/\/admin\/txns\?student=20269001$/);
  await expect(page.getByRole('button', { name: '去掉条件：周一鸣 · 学号 20269001' })).toBeVisible();
  const list = page.locator('section[aria-label="流水"]');
  const rows = list.locator('.dc-txn');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('期初余额');
  await expect(rows.first()).toContainText('学号 20269001');

  await rows.first().click();
  await list.getByRole('button', { name: '冲正', exact: true }).click();
  await page.locator('.dc-sheet .dc-check', { hasText: '金额录错' }).click();
  await confirmIn(page, '确认冲正');
  await expect(page.locator('.dc-notice-success')).toContainText('冲正成功');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: '冲正 · 金额录错' })).toHaveCount(1);
  const original = list.locator('details', { has: page.locator('.dc-txn-title', { hasText: '期初余额（已冲正）' }) });
  await expect(original.locator('.dc-kv')).toContainText('已冲正 · 金额录错');
  await expect(original.getByRole('button', { name: '冲正', exact: true })).toHaveCount(0);
});

test('reprinting the notices gives the waiting students new initial passwords', async ({ page }) => {
  await recordNotices(page);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students');
  await page.getByRole('button', { name: '开户通知单' }).click();
  await expect(page.locator('.dc-sheet')).toContainText('之前发出的通知单随即失效');
  await confirmIn(page, '生成通知单');
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  expect(await noticePages(await download)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as unknown as { notices: string[] }).notices)).toContain('王小雨同学，你好');
  reissued = await noticePassword(page, '20260003');
  expect(reissued).toMatch(/^\d{8}$/);
});

// 20260003 is not used after this: five wrong passwords lock the login for 15 minutes, even with the right one.
test('five wrong passwords lock a login', async ({ page }) => {
  for (let i = 0; i < 5; i++) {
    await signIn(page, '学生', '20260003', '/login?add=1', 'wrong0000');
    await expect(page.locator('.dc-notice-danger')).toBeVisible();
  }
  await signIn(page, '学生', '20260003', '/login?add=1', reissued);
  await expect(page.locator('.dc-notice-danger')).toContainText('密码错误次数过多');
  await expect(page.locator('.dc-notice-danger')).toContainText('请 15 分钟后再试，或请银行管理员重置密码。');
  await expect(page).toHaveURL(/\/login\?add=1$/);
});
