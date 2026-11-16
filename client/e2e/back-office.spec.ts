import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn } from './helpers';

// 流水, 参数 and 日志 (PHASE-1.md §4.2) as admin on the seed data. The 日志 test looks for the change the 参数 test
// makes.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

async function open(page: Page, label: string, path: string) {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.locator('.dc-nav-item', { hasText: label }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${path}$`));
  await expect(page.locator('.dc-top-title')).toContainText(label);
}

test('流水: filter by a student found as at the counter, by class, type and 时段', async ({ page }) => {
  await open(page, '流水', 'txns');
  const search = page.getByRole('searchbox', { name: '搜索学生、班级、柜员或交易号' });
  const found = page.getByRole('list', { name: '搜索建议' });
  const rows = page.locator('section[aria-label="流水"] .dc-txn');
  await search.fill('zxm');
  await found.locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(page.locator('.dc-list-title', { hasText: /^共 \d+ 笔$/ })).toBeVisible();
  await expect(rows.filter({ has: page.locator('.dc-txn-title', { hasText: /^期初余额/ }) })).toContainText('+120');
  await expect(rows.filter({ has: page.locator('.dc-txn-title', { hasText: /^存款/ }) }).first()).toContainText('学号 20260001');
  await expect(rows.filter({ hasNotText: '学号 20260001' })).toHaveCount(0);

  // A whole class: 八年级(3)班 is 李思远's.
  await page.getByRole('button', { name: /^去掉条件：张小明/ }).click();
  await search.fill('八年级3班');
  await found.locator('.dc-list-link', { hasText: '整个班级：八年级(3)班' }).click();
  await expect(page.locator('.dc-list-title')).toHaveText('共 3 笔');
  await expect(rows.filter({ hasNotText: '学号 20260002' })).toHaveCount(0);

  // 兑换 only, then a 时段 that ends before any business of the day.
  await page.getByRole('button', { name: '兑换', exact: true }).click();
  await expect(page.locator('.dc-list-title')).toHaveText('共 1 笔');
  await page.getByRole('button', { name: '按时段' }).click();
  await page.getByRole('button', { name: '每天到', exact: true }).click();
  await page.getByRole('button', { name: '0时', exact: true }).click();
  await page.getByRole('button', { name: '5分', exact: true }).click();
  await expect(page.locator('.dc-empty')).toContainText('没有符合条件的流水');
});

test('流水: pick today as the start date in the calendar', async ({ page }) => {
  await open(page, '流水', 'txns');
  const start = page.getByRole('button', { name: '从', exact: true });
  await expect(start).toHaveText('不限');
  await start.click();
  const calendar = page.getByRole('dialog', { name: '选择从' });
  await expect(calendar.locator('.dc-cal-day.is-today')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(calendar.locator('.dc-cal-day.is-today')).toBeFocused(); // tomorrow cannot be picked
  await page.keyboard.press('Enter');
  await expect(calendar).toBeHidden();
  await expect(start).toHaveText(/^\d{1,2}月\d{1,2}日 周[一二三四五六日]$/);
  await expect(page.locator('.dc-list-title', { hasText: /^共 \d+ 笔$/ })).toBeVisible();
});

test('流水: jump to a day last year through the month panel', async ({ page }) => {
  await open(page, '流水', 'txns');
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()).split('-').map(Number);
  const start = page.getByRole('button', { name: '从', exact: true });
  const calendar = page.getByRole('dialog', { name: '选择从' });
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
  await expect(start).toHaveText(new RegExp(`^${y - 1}年3月15日 周`));

  // A click outside closes it, even from the month panel.
  await start.click();
  await title.click();
  await expect(title).toHaveText(`${y - 1}年`);
  await page.locator('.dc-top-title').click();
  await expect(calendar).toBeHidden();
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
  const chip = page.getByRole('button', { name: '去掉条件：操作人 银行管理员' });
  await expect(chip).toBeVisible();
  await expect(page.locator('section[aria-label="操作日志"] .dc-txn').first()).toContainText('银行管理员 · ');
  await chip.click();
  await expect(chip).toHaveCount(0);
});

test('日志: the 参数 change made above, with its fields', async ({ page }) => {
  await open(page, '日志', 'audit');
  const entry = page.locator('details', { has: page.locator('.dc-txn-title', { hasText: '修改参数 · 排名匿名' }) }).first();
  await expect(entry).toContainText('银行管理员');
  await entry.locator('summary').click();
  await expect(entry.locator('.dc-kv')).toContainText('取值');

  // The type chips, then a student found by the search: their own entries and those about them.
  const titles = page.locator('section[aria-label="操作日志"] .dc-txn-title');
  await page.getByRole('button', { name: '参数', exact: true }).click();
  await expect(titles.first()).toContainText('参数');
  await expect(titles.filter({ hasNotText: '参数' })).toHaveCount(0);
  await page.getByRole('button', { name: '清除条件' }).click();
  await page.getByRole('searchbox', { name: '搜索操作人、学生或操作' }).fill('张小明');
  await page.getByRole('list', { name: '搜索建议' }).locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(page.getByRole('button', { name: '去掉条件：张小明 · 学号 20260001' })).toBeVisible();
  const rows = page.locator('section[aria-label="操作日志"] .dc-txn');
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: '张小明' })).toHaveCount(0);
});

test('全部功能: every page from the phone header, 利率 from it, Esc back to the button; not for tellers or computers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  const apps = page.getByRole('button', { name: '全部功能' });
  const sheet = page.getByRole('dialog', { name: '全部功能' });
  const tiles = sheet.getByRole('navigation', { name: '全部功能' }).getByRole('link');
  await apps.click();
  await expect(tiles).toHaveText(['总览', '学生', '流水', '报表', '轧账', '商品', '出入库', '人员', '考勤', '学期', '信用分', '贷款', '利率', '理财', '参数', '日志', '我的']);
  await expect(sheet.locator('[aria-current="page"]')).toHaveText('总览');
  await expect(tiles.first()).toBeFocused();
  await tiles.filter({ hasText: '利率' }).click();
  await expect(page).toHaveURL(/\/admin\/rates$/);
  await expect(sheet).toHaveCount(0);

  await apps.click();
  await expect(tiles.filter({ hasText: '利率' })).toBeFocused();
  await expect(tiles.filter({ hasText: '利率' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(apps).toBeFocused();

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(apps).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await expect(page.locator('.dc-top-title')).toContainText('办理');
  await expect(apps).toHaveCount(0);
});
