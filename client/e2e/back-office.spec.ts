import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// 流水, 发行, 参数 and 日志 (PHASE-1.md §4.2) as admin on the seed data. The counter tests that follow rely on the
// seed's faces and withdrawal limits, so these tests leave them alone and switch 排名匿名 back to how they found it.
// The 日志 test looks for the batch the 发行 test registers.
test.describe.configure({ mode: 'serial' });

const batch = `E2E-${Date.now()}`;

async function open(page: Page, label: string, path: string) {
  await signIn(page, '工作人员', 'admin');
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

test('流水: pick today as the start date in the calendar', async ({ page }) => {
  await open(page, '流水', 'txns');
  const start = page.getByRole('button', { name: '开始日期' });
  await expect(start).toHaveText('不限');
  await start.click();
  const calendar = page.getByRole('dialog', { name: '选择开始日期' });
  await expect(calendar.locator('.dc-cal-day.is-today')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(calendar.locator('.dc-cal-day.is-today')).toBeFocused(); // tomorrow cannot be picked
  await page.keyboard.press('Enter');
  await expect(calendar).toBeHidden();
  await expect(start).toHaveText(/^\d{4}年\d{1,2}月\d{1,2}日 星期[一二三四五六日]$/);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.locator('.dc-list-title', { hasText: /^共 \d+ 笔$/ })).toBeVisible();
});

test('流水: jump to a day last year through the month panel', async ({ page }) => {
  await open(page, '流水', 'txns');
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()).split('-').map(Number);
  const start = page.getByRole('button', { name: '开始日期' });
  const calendar = page.getByRole('dialog', { name: '选择开始日期' });
  const title = calendar.getByRole('button', { name: '选择年月' });

  // Keyboard: arrows move through the months and cross into last year; Esc goes back to the days, then closes.
  await start.click();
  await title.click();
  await expect(calendar).toHaveClass(/is-months/);
  await expect(title).toHaveText(`${y}年`);
  await expect(calendar.getByRole('button', { name: '下一年' })).toBeDisabled();
  await expect(calendar.locator('.dc-cal-month.is-today')).toBeFocused();
  await page.keyboard.press('ArrowRight'); // next month cannot be picked
  await expect(calendar.locator('.dc-cal-month.is-today')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(title).toHaveText(`${y - 1}年`);
  await expect(calendar.getByRole('button', { name: `${y - 1}年${m}月` })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(calendar).not.toHaveClass(/is-months/);
  await expect(title).toHaveText(`${y}年${m}月`);
  await expect(calendar.locator('.dc-cal-day.is-today')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(start).toBeFocused();

  // Mouse: title, 上一年, 3月, 15.
  await start.click();
  await title.click();
  await calendar.getByRole('button', { name: '上一年' }).click();
  await calendar.getByRole('button', { name: `${y - 1}年3月` }).click();
  await expect(title).toHaveText(`${y - 1}年3月`);
  await calendar.getByRole('button', { name: /^3月15日/ }).click();
  await expect(start).toHaveText(new RegExp(`^${y - 1}年3月15日 星期`));

  // A click outside closes it, even from the month panel.
  await start.click();
  await title.click();
  await expect(title).toHaveText(`${y - 1}年`);
  await page.locator('.dc-top-title').click();
  await expect(calendar).toBeHidden();
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

  // The form starts empty again, approver included; the same batch number again is refused.
  await expect(page.getByLabel('审批人')).toHaveValue('');
  await page.getByLabel('批次号').fill(batch);
  await page.getByLabel('增加一张 1 元').click();
  await page.getByLabel('用途').fill('测试发行');
  await page.getByLabel('审批人').fill('王老师');
  await page.getByRole('button', { name: '登记发行' }).click();
  await expect(page.locator('.dc-notice-danger')).toContainText('批次号已被使用');
});

test('参数: switch 排名匿名 off and on again', async ({ page }) => {
  await open(page, '参数', 'settings');
  const anonymous = page.getByRole('switch', { name: /排名匿名/ });
  const toggle = () => page.locator('.dc-switch', { hasText: '排名匿名' }).click();
  await expect(anonymous).toBeChecked();

  // The steppers change a value; back to the saved value, there is nothing to save.
  const save = page.getByRole('button', { name: '保存参数' });
  await page.getByLabel('排名人数增加 1').click();
  await expect(page.getByLabel('排名人数', { exact: true })).toHaveValue('11');
  await expect(save).toBeEnabled();
  await page.getByLabel('排名人数减少 1').click();
  await expect(save).toBeDisabled();

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

test('人员 → 操作日志 shows only that login, and the filter can be removed', async ({ page }) => {
  await open(page, '人员', 'staff');
  await page.locator('.dc-list-link', { hasText: '柜员小林' }).click();
  await page.getByRole('link', { name: '查看他办理的流水' }).click();
  await expect(page).toHaveURL(/\/admin\/txns\?operator=[0-9a-f-]{36}$/);
  const rows = page.locator('section[aria-label="流水"] .dc-txn');
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: '经办人 柜员小林' })).toHaveCount(0);

  await page.goto('/admin/staff');
  await page.locator('.dc-list-link', { hasText: '银行管理员' }).first().click();
  await page.getByRole('link', { name: '操作日志' }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?actor=[0-9a-f-]{36}$/);
  const chip = page.getByRole('button', { name: /只看 银行管理员 的操作/ });
  await expect(chip).toBeVisible();
  await expect(page.locator('section[aria-label="操作日志"] .dc-txn').first()).toContainText('银行管理员 · ');
  await chip.click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
});

test('日志: the batch registered above, with its fields', async ({ page }) => {
  await open(page, '日志', 'audit');
  const entry = page.locator('details', { has: page.locator('.dc-txn-title', { hasText: `新增发行 · ${batch}` }) });
  await expect(entry).toContainText('银行管理员');
  await entry.locator('summary').click();
  await expect(entry.locator('.dc-kv')).toContainText('批次号');
  await expect(entry.locator('.dc-kv')).toContainText('总额25');
  await expect(page.locator('.dc-txn-title', { hasText: '修改参数 · 排名匿名' }).first()).toBeVisible();
});
