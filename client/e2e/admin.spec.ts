/// <reference types="node" />
import { expect, test } from '@playwright/test';
import { confirmIn, signIn } from './helpers';

// The back office's logins (M4, PHASE-1.md §6.4–6.5): the teacher imports a roster and a new student signs in for the
// first time; staff logins are created and managed. Only new students and logins are touched: the counter tests
// that run after these rely on the seed's balances.
test.describe.configure({ mode: 'serial' });

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
  await expect(page.locator('#dc-notices')).toContainText('四年级(1)班');
  await expect(page.locator('#dc-notices article')).toHaveCount(2);

  await page.getByRole('button', { name: '返回学生' }).click();
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zym');
  await page.locator('.dc-list-link', { hasText: '周一鸣' }).click();
  await expect(page.locator('.dc-person')).toContainText('30');
  await expect(page.locator('.dc-kv')).toContainText('还未设置新密码');

  // The student signs in on this device too (it becomes a second account here).
  await signIn(page, '学生', '20269001', '/login?add=1');
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByPlaceholder('至少 8 位，含英文字母和数字').fill('zhou2026a');
  await page.getByPlaceholder('再次输入新密码').fill('zhou2026a');
  await page.getByRole('button', { name: '设置密码' }).click();
  await expect(page.locator('.dc-balance-amount')).toContainText('30');
});

test('the teacher resets a student password back to the default', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students/20269001');
  await expect(page.locator('.dc-kv')).toContainText('已设置新密码');
  await page.getByRole('button', { name: '重置密码' }).click();
  await confirmIn(page, '重置密码');
  await expect(page.locator('.dc-notice-success')).toContainText('密码已重置');
  await expect(page.locator('.dc-kv')).toContainText('还未设置新密码');
});

test('staff logins: create one, change its role, stop it; a sysadmin cannot touch a teacher', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await page.locator('.dc-nav-item', { hasText: '人员' }).click();
  await page.getByRole('link', { name: '新增账号' }).click();
  await page.getByPlaceholder('如 teller02').fill('Teller09');
  await page.getByPlaceholder('如 柜员小王').fill('柜员小周');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.locator('.dc-notice-success')).toContainText('teller09 已创建');

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
  await expect(page.getByPlaceholder('全部学生')).toHaveValue('20269001');
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
