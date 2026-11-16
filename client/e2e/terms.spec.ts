import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 学期 (PHASE-2.md §6): the bank admin registers, changes and closes terms; the president and the accountant only read them. And the
// sysadmin's overview while a scheduled job has failed (§13). The tests build on each other's terms.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const day = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(Date.now() + offset * 86_400_000));
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`;
const fullDate = (d: string) => `${d.slice(0, 4)}年${monthDay(d)}`;
const FIRST = '2026 学年第一学期';
const row = (page: Page, name: string) => page.getByRole('table', { name: '学期' }).locator('tr', { hasText: name });
const sheet = (page: Page) => page.locator('.dc-sheet');

async function pickDate(page: Page, label: string, date: string) {
  await sheet(page).getByLabel(label, { exact: true }).click();
  const target = page.locator(`.dc-cal:visible [data-day="${date}"]`);
  while (!(await target.isVisible())) await page.locator('.dc-cal:visible').getByRole('button', { name: '下个月' }).click();
  await target.click();
}

test('the bank admin registers a term, then changes its end', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '学期' }).click();
  const empty = page.locator('.dc-empty');
  await expect(empty).toContainText('还没有登记学期');
  await expect(empty).toContainText('登记学期后，才能按学期结转和查看历史。');
  await empty.getByRole('button', { name: '登记学期' }).click();

  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('登记学期');
  await sheet(page).getByPlaceholder('例如 2026 学年第一学期').fill(FIRST);
  await pickDate(page, '结束日', day(20));
  await confirmIn(page, '保存');
  await expect(sheet(page)).toHaveCount(0);
  await expect(row(page, FIRST)).toContainText(fullDate(day()));
  await expect(row(page, FIRST)).toContainText(fullDate(day(20)));
  await expect(row(page, FIRST)).toContainText('进行中');

  await row(page, FIRST).getByRole('button', { name: '修改' }).click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('修改学期');
  await pickDate(page, '结束日', day(30));
  await confirmIn(page, '保存');
  await expect(sheet(page)).toHaveCount(0);
  await expect(row(page, FIRST)).toContainText(fullDate(day(30)));
});

test('a term that has started keeps its start: the date is locked and says why', async ({ page }) => {
  sql(`update public.terms set starts_on = app_private.cn_date(now()) - 10 where name = '${FIRST}'`);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/terms');
  await row(page, FIRST).getByRole('button', { name: '修改' }).click();
  await expect(sheet(page).getByLabel('开始日', { exact: true })).toBeDisabled();
  await expect(sheet(page).getByLabel('开始日', { exact: true })).toContainText(fullDate(day(-10)));
  await expect(sheet(page)).toContainText('学期已开始，开始日不能再改');
  await expect(sheet(page).getByLabel('结束日', { exact: true })).toBeEnabled();
});

test('a term whose days overlap another one is refused in the sheet', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/terms');
  await page.getByRole('button', { name: '登记学期' }).click();
  await sheet(page).getByPlaceholder('例如 2026 学年第一学期').fill('重叠的学期');
  await confirmIn(page, '保存');
  const notice = sheet(page).locator('.dc-notice-danger');
  await expect(notice).toContainText('学期日期重叠');
  await expect(notice).toContainText(`和「${FIRST}」的日期重叠，请调整开始日或结束日。`);
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('登记学期');
  await confirmIn(page, '取消');
  await expect(row(page, '重叠的学期')).toHaveCount(0);
});

test('after its last day a term is closed, and then only read', async ({ page }) => {
  sql(`update public.terms set starts_on = app_private.cn_date(now()) - 40, ends_on = app_private.cn_date(now()) - 2 where name = '${FIRST}';
    update public.job_runs set done_to = app_private.cn_date(now()) - 1 where job = 'daily'`);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/terms');
  await expect(row(page, FIRST)).toContainText('已结束未结转');
  await row(page, FIRST).getByRole('button', { name: '结转' }).click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText(`结转 ${FIRST}？`);
  await expect(sheet(page)).toContainText('结转后这个学期只读。余额和信用分原样转入下学期，不生成流水。');
  await confirmIn(page, '结转');
  await expect(sheet(page)).toHaveCount(0);
  await expect(row(page, FIRST)).toContainText('已结转');
  await expect(row(page, FIRST).getByRole('button')).toHaveCount(0);
  expect(sql(`select closed_at is not null from public.terms where name = '${FIRST}'`)).toBe('t');
});

test('a term the daily job has not finished is not closed: the sheet lists what is open', async ({ page }) => {
  sql(`insert into public.terms (name, starts_on, ends_on) values ('2025 学年第二学期', app_private.cn_date(now()) - 100, app_private.cn_date(now()) - 50);
    update public.job_runs set done_to = app_private.cn_date(now()) - 55 where job = 'daily'`);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/terms');
  await row(page, '2025 学年第二学期').getByRole('button', { name: '结转' }).click();
  await confirmIn(page, '结转');
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('还不能结转');
  await expect(sheet(page)).toContainText('下面这些处理完后，再结转学期。');
  const list = sheet(page).getByRole('list', { name: '还要处理的事项' });
  await expect(list).toContainText('每天的任务');
  await expect(list).toContainText(`已处理到 ${monthDay(day(-55))}，需处理到 ${monthDay(day(-50))}`);
  await expect(sheet(page).getByRole('button')).toHaveText(['知道了']);
  await confirmIn(page, '知道了');
  await expect(sheet(page)).toHaveCount(0);
  await expect(row(page, '2025 学年第二学期')).toContainText('已结束未结转');
});

test('on a phone 登记学期 is in the action bar', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/terms');
  await expect(row(page, FIRST)).toBeVisible();
  await expect(page.locator('.dc-actions').getByRole('button', { name: '登记学期' })).toBeInViewport();
  await expect(page.getByRole('button', { name: '登记学期' })).toHaveCount(1);
});

test('the president reads the terms without a way to change them', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '学期' }).click();
  await expect(page.getByText('学期用于结转和按学期查看历史，由银行管理员登记和结转。')).toBeVisible();
  await expect(row(page, FIRST)).toContainText('已结转');
  await expect(row(page, '2025 学年第二学期')).toContainText('已结束未结转');
  await expect(page.getByRole('table', { name: '学期' }).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登记学期' })).toHaveCount(0);
});

test('the accountant reads the terms without a way to change them', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '学期' }).click();
  await expect(page.getByText('学期用于结转和按学期查看历史，由银行管理员登记和结转。')).toBeVisible();
  await expect(row(page, FIRST)).toContainText('已结转');
  await expect(page.getByRole('table', { name: '学期' }).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登记学期' })).toHaveCount(0);
});

test('the sysadmin overview shows a failed scheduled job until it runs again', async ({ page }) => {
  sql(`update public.job_runs set done_to = '2026-11-09', last_err = '2026-11-10: division by zero' where job = 'daily'`);
  await signIn(page, '工作人员', 'ops01');
  await expect(page).toHaveURL(/\/admin$/);
  const notice = page.locator('.dc-notice-danger', { hasText: '定时任务没有完成' });
  await expect(notice).toContainText('每天的任务已处理到 11月9日，11月10日 没有完成：division by zero。在服务器上运行 dolphin jobs 查看，用 dolphin jobs run 重试。');
  await expect(notice.locator('code')).toHaveText(['division by zero', 'dolphin jobs', 'dolphin jobs run']);

  sql(`update public.job_runs set last_err = null where job = 'daily'`);
  await page.reload();
  await expect(page.locator('.dc-top-title')).toContainText('总览');
  await expect(notice).toHaveCount(0);
});
