import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 海豚信用分 (PHASE-2.md §8) on the seed data (supabase/seed.sql): every student starts at 600. The counter's card, the
// back office's 信用分 page with the bank admin's adjustment, the president and the accountant who only read it, the
// storekeeper who has no 信用分, and the 信用分 group of 参数. Tests run in order: the adjustment of the third is what
// the student and the accountant see.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

async function findStudent(page: Page, query: string, name: string) {
  await page.getByRole('searchbox', { name: '搜索学生' }).fill(query);
  await page.getByRole('list', { name: '搜索建议' }).locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-person-name')).toHaveText(name);
}
const sheet = (page: Page) => page.locator('.dc-sheet');

test('柜台: the student’s card shows the small gauge after 今日还可取', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  const meta = page.locator('.dc-person-meta', { hasText: '今日还可取' });
  await expect(meta.locator('.dc-gauge.is-sm').getByRole('meter', { name: '海豚信用分' })).toHaveAttribute('aria-valuenow', '600');
  await expect(meta.locator('.dc-gauge-score')).toHaveText('600');
});

test('行长 reads 信用分 with the curve and the rules, and has no 调整信用分', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '信用分', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/credit$/);
  await expect(page.locator('.dc-empty')).toContainText('选择一位学生');
  await findStudent(page, 'lsy', '李思远');
  await expect(page.locator('.dc-gauge.is-lg').getByRole('meter')).toHaveAttribute('aria-valuenow', '600');
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-foot')).toHaveText('贷款额度 130 HTB');
  await expect(page.getByText('还没有变动')).toBeVisible();
  await expect(page.getByRole('button', { name: '调整信用分' })).toHaveCount(0);
  await expect(page.locator('.dc-kv')).toContainText('能贷款的最低分400 分');
  await expect(page.locator('.dc-kv')).toContainText('贷款系数×1.8 → ×1.1');
  await expect(page.getByRole('table', { name: '加减分规则' }).locator('tr', { hasText: '逾期（应还日结束仍未还清）' })).toContainText('−50');
  await expect(page.getByRole('link', { name: '在参数页修改' })).toHaveCount(0); // 参数 is the bank admin's
});

test('银行管理员 adjusts a score in two steps, and the student sees it', async ({ page, browser }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/credit');
  await findStudent(page, '20260001', '张小明');
  await page.getByRole('button', { name: '调整信用分' }).click();
  await page.locator('.dc-sheet .dc-seg label', { hasText: '减分' }).click();
  await sheet(page).getByLabel('分值', { exact: true }).fill('50');
  await expect(sheet(page)).toContainText('600 分 → 550 分');
  await expect(sheet(page).getByRole('button', { name: '下一步' })).toBeDisabled();
  await sheet(page).getByPlaceholder('写清楚调整的原因').fill('损坏公物');
  await confirmIn(page, '下一步');
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('给张小明减 50 分？');
  await expect(sheet(page).locator('.dc-sheet-text')).toHaveText('600 分 → 550 分。原因：损坏公物。调整会生成一条风险提醒，行长和银行管理员都能看到。');
  await confirmIn(page, '确认调整');
  await expect(page.locator('.dc-toast')).toHaveText('已调整为 550 分');
  await expect(page.locator('.dc-gauge.is-lg').getByRole('meter')).toHaveAttribute('aria-valuenow', '550');
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-dial')).not.toHaveClass(/is-low/);
  const first = page.getByRole('table', { name: '信用分变动' }).locator('tbody tr').first();
  await expect(first).toContainText('−50');
  await expect(first).toContainText('550');
  await expect(first).toContainText('银行管理员调整：损坏公物');

  // A score already at 0 cannot go lower: the server says so in the sheet.
  sql(`update public.credit_scores set score = 0 where student_no = '20260002'`);
  await findStudent(page, '20260002', '李思远');
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-dial')).toHaveClass(/is-low/); // below 400: red
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-foot')).toHaveText('400 分以上才能贷款');
  await page.getByRole('button', { name: '调整信用分' }).click();
  await page.locator('.dc-sheet .dc-seg label', { hasText: '减分' }).click();
  await expect(sheet(page)).toContainText('0 分 → 0 分（最低 0 分）');
  await sheet(page).getByPlaceholder('写清楚调整的原因').fill('测试');
  await confirmIn(page, '下一步');
  await confirmIn(page, '确认调整');
  await expect(sheet(page).getByRole('alert')).toContainText('李思远已经是 0 分，不能再减');

  // The student in a browser of their own (a context shares nothing with the admin's).
  const { baseURL, ignoreHTTPSErrors, locale, timezoneId } = test.info().project.use;
  const student = await (await browser.newContext({ baseURL, ignoreHTTPSErrors, locale, timezoneId })).newPage();
  await signIn(student, '学生', '20260001');
  await expect(student).toHaveURL(/\/student$/);
  await student.goto('/student/credit');
  await expect(student.locator('.dc-gauge.is-lg').getByRole('meter')).toHaveAttribute('aria-valuenow', '550');
  await expect(student.locator('.dc-txn').first()).toContainText('银行管理员调整：损坏公物');
  await student.context().close();
});

test('财务 reads a student’s score and changes, without 调整信用分 or 参数', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '参数', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: '信用分', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/credit$/);
  await findStudent(page, '20260001', '张小明');
  await expect(page.locator('.dc-gauge.is-lg').getByRole('meter')).toHaveAttribute('aria-valuenow', '550');
  await expect(page.getByRole('table', { name: '信用分变动' }).locator('tbody tr').first()).toContainText('银行管理员调整：损坏公物');
  await expect(page.getByRole('button', { name: '调整信用分' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: '加减分规则' })).toBeVisible();
  await expect(page.getByRole('link', { name: '在参数页修改' })).toHaveCount(0);
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/admin$/);
});

test('库管 has no 信用分 or 学期: the addresses go back to 总览 and read nothing', async ({ page }) => {
  const read: string[] = [];
  page.on('request', (r) => { if (/\/rest\/v1\/(credit_|terms)/.test(r.url())) read.push(r.url()); });
  await signIn(page, '工作人员', 'keeper01');
  await expect(page).toHaveURL(/\/admin$/);
  const nav = page.getByRole('navigation', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '商品', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: '信用分', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: '学期', exact: true })).toHaveCount(0);
  for (const path of ['/admin/credit', '/admin/terms']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.locator('.dc-top-title')).toContainText('总览');
  }
  expect(read).toEqual([]);
});

// Skipped until 参数 reads wealth_params of six products (PHASE-2.md §14.3, M24).
test.skip('参数 → 信用分: a wrong value or order is marked and never sent; a right one is saved', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: '信用分' })).toBeVisible();
  await expect(page.locator('.heading.is-section')).toHaveText(['柜台', '货币', '排名', '考勤与工资', '学年', '利率', '理财', '信用分', '风险提醒']);
  const sent: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/rpc/set_setting')) sent.push(r.url()); });
  const save = page.getByRole('button', { name: '保存参数' });
  const kept = sql(`select concat_ws(',', value ->> 'saving_min', value ->> 'saving_max') from public.settings where key = 'credit_curve'`);
  const preview = page.getByRole('table', { name: '按当前填写预览' });
  await expect(preview.locator('tr', { hasText: '600 分' })).toHaveText('600 分130 HTB×1.5667');
  await expect(preview.locator('tr', { hasText: '1000 分' })).toContainText('300 HTB');

  // Out of range.
  const minScore = page.getByLabel('能贷款的最低分', { exact: true });
  await minScore.fill('1000');
  await expect(page.locator('.dc-field.is-error')).toContainText('请输入 0 到 999 的整数');
  await expect(save).toBeDisabled();
  await minScore.press('Enter');
  await minScore.fill('400');
  await expect(save).toBeDisabled(); // nothing changed

  // Against the others: 取整单位 above the low end, the loan factor at 1000 above the one at the low end.
  await page.getByLabel('取整单位', { exact: true }).fill('60');
  await expect(page.locator('.dc-field.is-error').first()).toContainText('取整单位 ≤ 最低分时的额度 ≤ 1000 分时的额度');
  await expect(save).toBeDisabled();
  await page.getByLabel('取整单位', { exact: true }).press('Enter');
  await page.getByLabel('取整单位', { exact: true }).fill('5');
  await page.getByLabel('1000 分时的贷款系数').fill('2');
  await expect(page.locator('.dc-field.is-error').first()).toContainText('1000 分时的贷款系数不能大于最低分时的');
  await expect(save).toBeDisabled();
  await page.getByLabel('1000 分时的贷款系数').fill('1.12345');
  await expect(page.locator('.dc-field.is-error').first()).toContainText('最多 4 位小数');
  await page.getByLabel('1000 分时的贷款系数').press('Enter');
  await page.getByLabel('1000 分时的贷款系数').fill('1.1');
  await page.getByLabel('逾期（应还日结束仍未还清）减的分', { exact: true }).fill('101');
  await expect(page.locator('.dc-field.is-error').first()).toContainText('请输入 0 到 100 的整数');
  await expect(save).toBeDisabled();
  expect(sent).toHaveLength(0);

  // Right: the preview follows, and a loss is saved negative.
  await page.getByLabel('逾期（应还日结束仍未还清）减的分', { exact: true }).fill('60');
  await page.getByLabel('1000 分时的额度', { exact: true }).fill('310');
  await expect(preview.locator('tr', { hasText: '1000 分' })).toContainText('310 HTB');
  await save.click();
  await expect(page.locator('.dc-toast')).toHaveText('参数已保存');
  expect(sql(`select value ->> 'overdue' from public.settings where key = 'credit_rules'`)).toBe('-60');
  expect(sql(`select value ->> 'limit_max' from public.settings where key = 'credit_curve'`)).toBe('310');
  // Keys the page no longer shows go back as they came, until the backend drops them.
  expect(sql(`select concat_ws(',', value ->> 'saving_min', value ->> 'saving_max') from public.settings where key = 'credit_curve'`)).toBe(kept);
  await expect(save).toBeDisabled();
});

test('the gauge follows credit_curve: with 500 to borrow, 450 points are red and say so', async ({ page }) => {
  sql(`update public.settings set value = jsonb_set(value, '{min_score}', '500') where key = 'credit_curve';
       update public.credit_scores set score = 450 where student_no = '20260003';`);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/credit');
  await findStudent(page, '20260003', '王小雨');
  const dial = page.locator('.dc-gauge.is-lg .dc-gauge-dial');
  await expect(dial).toHaveAttribute('aria-valuenow', '450');
  await expect(dial).toHaveClass(/is-low/);
  await expect(dial).toHaveAttribute('style', /--min: ?500/);
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-foot')).toHaveText('500 分以上才能贷款');
  await expect(page.locator('.dc-gauge.is-lg .dc-gauge-next')).toHaveCount(0);
});
