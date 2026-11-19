import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 贷款 (PHASE-2.md §10.3–10.9, design system Loan) on the seed data (supabase/seed.sql): every student has 600 points
// (limit 130 HTB, 6.2667%/周, 罚息 9.4001%/周 with no anchor published). 张小明 (20260001) has 108 HTB, 王小雨 (20260003) 0. A term around today ends in 40 days; a loan runs 8 weeks at most, past the term's end. The tests run in order:
// teller01 lends to 张小明 and takes repayments, lends 李思远 cash and reverses it, lends 王小雨; 张小明 reads it; the loan
// falls overdue and is paid off; the back office lists, opens and terminates.
test.describe.configure({ mode: 'serial' });
const DAY = 'app_private.cn_date(now())';
test.beforeAll(() => {
  resetData();
  sql(`insert into public.terms (name, starts_on, ends_on) values ('本学期', ${DAY} - 30, ${DAY} + 40)`);
});

const md = (date: string) => sql(`select to_char(${date}, 'FMMM月FMDD日')`);
const LOAN = (no: string) => `(select id from public.loans where student_no = '${no}' and status <> 'reversed')`;
const pick = (page: Page, name: string) => page.locator('.dc-seg label', { hasText: name }).click();
const receipt = (page: Page) => page.locator('aside[aria-label="办理单"]');
const sheet = (page: Page) => page.locator('.dc-sheet');
const plan = (page: Page) => page.getByRole('list', { name: '还款计划' }).locator('.dc-list-item');
const bar = (page: Page, name: string) => page.locator('.dc-actions').getByRole('button', { name, exact: true });

async function serve(page: Page, search: string, name: string) {
  await page.getByRole('searchbox', { name: '搜索学生' }).fill(search);
  await page.locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-person-name')).toContainText(name);
  await pick(page, '贷款');
}
async function teller(page: Page) {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
}
async function reverse(page: Page) {
  await sheet(page).locator('label', { hasText: '金额录错' }).click();
  await confirmIn(page, '确认冲正');
}
// The plan as the database has it: "第 N 期 · 日期 应还本金 X HTB" for each period.
const planTitles = (no: string) => sql(`select string_agg('第 ' || seq || ' 期 · ' || to_char(due_on, 'FMMM月FMDD日') || ' 应还本金 ' || principal || ' HTB', '|' order by seq)
  from public.loan_periods where loan_id = ${LOAN(no)}`).split('|');

test('柜台「贷款」: the seven businesses, a new loan with its plan, repayments, paying more, cash, and 冲正', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await teller(page);
  await serve(page, 'zxm', '张小明');
  // 存款 / 取款 / 兑换 / 贷款 on the first row, 定期 / 理财 / 查询 on the second.
  const labels = page.getByRole('group', { name: '业务' }).locator('label');
  await expect(labels).toHaveText(['存款', '取款', '兑换', '贷款', '定期', '理财', '查询']);
  const [first, fifth] = [await labels.nth(0).boundingBox(), await labels.nth(4).boundingBox()];
  expect(fifth!.y).toBeGreaterThan(first!.y + first!.height / 2);
  await page.setViewportSize({ width: 1180, height: 820 });

  await expect(page.locator('.dc-credit-summary .dc-kv > div')).toHaveText(['单笔额度130 HTB', '本周贷款利率6.2667%/周', '最长期限8 周']);
  const amount = page.getByPlaceholder('请输入金额');
  const hint = page.locator('.dc-field-hint').first();
  await expect(hint).toHaveText('1 HTB 起，最多 130 HTB');
  await amount.fill('200');
  await expect(hint).toHaveText('超过贷款额度：按现在的信用分最多能贷 130 HTB');
  await amount.fill('100');
  await expect(bar(page, '放款')).toBeDisabled(); // no purpose yet
  await page.getByPlaceholder('例如：买文具').fill('买文具');
  await expect(page.locator('.dc-qty-sum')).toHaveText(`期数最后一期 ${md(`${DAY} + 28`)}`);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '期数增加 1' }).click();
  await expect(page.locator('.dc-qty-sum')).toHaveText(`期数最后一期 ${md(`${DAY} + 56`)}`);
  await expect(page.getByRole('button', { name: '期数增加 1' })).toBeDisabled();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '期数减少 1' }).click();
  await expect(receipt(page)).toContainText('贷款（正在办理）分 4 期，存入账户+100');
  await expect(receipt(page)).toContainText('办理后余额208 HTB');

  await bar(page, '放款').click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('给张小明放款 100 HTB？');
  await expect(sheet(page).locator('.dc-kv > div')).toHaveText(['用途买文具', '还款方式分 4 期，每周一期', '周利率6.2667%/周（还清前不变）', '放款方式存入账户，活期 108 → 208 HTB']);
  const rows = sheet(page).getByRole('table', { name: '还款计划' }).locator('tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText(`1${md(`${DAY} + 7`)}25约 `);
  await expect(sheet(page)).toContainText('利息按天算，提前还就少付。逾期部分按罚息 9.4001%/周 计息，并扣信用分。');
  await confirmIn(page, '确认放款');
  await expect(receipt(page)).toContainText('贷款分 4 期，存入账户 · HT');
  await expect(page.locator('.dc-person-side')).toHaveText('208当前余额 HTB');

  // The open loan: its card and plan; the repayment defaults to this period's payment.
  const card = page.locator('section[aria-label="这笔贷款"]');
  await expect(card.locator('.dc-list-item')).toContainText(/^贷款 100 HTBDK\d{10,} · 分 4 期，每周一期还款中$/);
  await expect(card.locator('.dc-kv > div')).toHaveText(['剩余本金100 HTB', '已产生利息0.00 HTB', `本期应还${md(`${DAY} + 7`)} · 本金 25 HTB，利息 0 HTB`, '周利率6.2667%/周']);
  await expect(page.getByText('先还清这笔贷款，才能办新贷款或新定期。')).toBeVisible();
  await expect(plan(page)).toHaveText(planTitles('20260001').map((t, i) => `${t}还没还${i ? '待还' : '本期'}`));
  await expect(amount).toHaveValue('25');
  await expect(page.locator('.dc-field-hint')).toHaveText('本期应还 25 HTB · 全部结清 100 HTB');
  await expect(page.getByText('活期 208 → 183 HTB')).toBeVisible();
  await bar(page, '确认还款').click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('张小明还款 25 HTB？');
  await expect(sheet(page).locator('.dc-kv > div')).toHaveText(['先付利息0 HTB', '再还本金25 HTB', '还后剩余本金75 HTB', '付款方式从账户扣，活期 208 → 183 HTB']);
  await confirmIn(page, '确认还款');
  await expect(receipt(page)).toContainText('还款利息 0，本金 25 · HT');
  await expect(plan(page).first()).toContainText('已还清已还清');

  // Paying more than the period: the rest is spread over the later periods.
  await expect(amount).toHaveValue('25');
  await amount.fill('101');
  await expect(page.locator('.dc-field-hint')).toHaveText('这笔贷款现在一共只需还 75 HTB。');
  await amount.fill('50');
  await bar(page, '确认还款').click();
  await confirmIn(page, '确认还款');
  await expect(card.locator('.dc-kv > div').first()).toHaveText('剩余本金25 HTB');
  const titles = planTitles('20260001');
  await expect(plan(page).locator(':scope > span:first-child')).toHaveText(titles.map((t, i) => `${t}${i < 2 ? '已还清' : '还没还'}`));

  // In cash: the notes counted are the amount.
  await page.locator('.dc-seg label', { hasText: '交现金' }).click();
  await page.getByLabel('增加一张 10 元').click();
  await expect(amount).toHaveValue('10');
  await bar(page, '确认还款').click();
  await expect(sheet(page).locator('.dc-kv > div').last()).toHaveText('付款方式交现金，10 元 × 1 张');
  await confirmIn(page, '确认还款');
  await expect(receipt(page)).toContainText('还款利息 0，本金 10，现金 10 元 × 1 张 · HT');
  await expect(page.locator('.dc-person-side')).toHaveText('133当前余额 HTB');

  // Only the latest repayment has 冲正.
  await expect(receipt(page).getByRole('button', { name: '冲正还款' })).toHaveCount(1);
  await expect(receipt(page).getByRole('button', { name: '冲正贷款' })).toHaveCount(0);
  await receipt(page).getByRole('button', { name: '冲正还款' }).click();
  await reverse(page);
  await expect(receipt(page)).toContainText('还款（已冲正）');
  await expect(card.locator('.dc-kv > div').first()).toHaveText('剩余本金25 HTB');

  // A 定期 waits for the loan to be paid off; the sheet stays open with the reason.
  await pick(page, '定期');
  await page.getByRole('radiogroup', { name: '存期' }).locator('.dc-choice', { hasText: /^2 周/ }).click();
  await page.getByPlaceholder('请输入金额').fill('10');
  await page.getByRole('button', { name: '开定期', exact: true }).click();
  await confirmIn(page, '确认开定期');
  await expect(sheet(page).locator('.dc-notice-danger')).toContainText('先还清这笔贷款，才能办新贷款或新定期。');
  await sheet(page).getByRole('button', { name: '取消' }).click();

  await pick(page, '查询');
  await expect(page.locator('.dc-stat', { hasText: '贷款剩余' })).toHaveText('贷款剩余25HTB');
});

test('柜台: a loan paid out in cash shows its notes, and 冲正 voids it; 今日业务 refuses to reverse a loan being repaid', async ({ page }) => {
  const balance = sql(`select balance from public.accounts where student_no = '20260002'`);
  await teller(page);
  await serve(page, 'lsy', '李思远');
  await page.getByPlaceholder('请输入金额').fill('50');
  await page.getByPlaceholder('例如：买文具').fill('买书');
  await page.locator('.dc-seg label', { hasText: '一次还清' }).click();
  await page.getByRole('button', { name: '期限（周）减少 1' }).click();
  await page.getByRole('button', { name: '期限（周）减少 1' }).click();
  await expect(page.locator('.dc-qty-sum')).toHaveText(`期限（周）最后一期 ${md(`${DAY} + 14`)}`);
  await page.locator('.dc-choice', { hasText: '付现金' }).click();
  await expect(receipt(page)).toContainText('贷款（正在办理）一次还清 2 周，付现金现金 50');
  await expect(receipt(page)).toContainText(`办理后余额${balance} HTB`);
  await bar(page, '放款').click();
  await expect(sheet(page).locator('.dc-kv > div')).toContainText(['还款方式一次还清，2 周后']);
  await expect(sheet(page).getByRole('table', { name: '还款计划' }).locator('tbody tr')).toHaveCount(1);
  await confirmIn(page, '确认放款');
  const notes = sql(`select string_agg(key || ' 元 × ' || value || ' 张', '、' order by key::int desc) from public.txns t, jsonb_each_text(t.denominations)
    where t.student_no = '20260002' and t.type = 'loan'`);
  await expect(receipt(page)).toContainText(`贷款一次还清 2 周，付现金，配钞 ${notes} · HT`);
  await expect(page.locator('.dc-person-side')).toHaveText(`${balance}当前余额 HTB`);

  await receipt(page).getByRole('button', { name: '冲正贷款' }).click();
  await reverse(page);
  await expect(receipt(page)).toContainText('贷款（已冲正）');
  await expect(page.getByPlaceholder('例如：买文具')).toBeVisible(); // a new loan again
  expect(sql(`select status from public.loans where student_no = '20260002'`)).toBe('reversed');

  await page.goto('/counter/today');
  const line = page.locator('.dc-txns > li', { hasText: '张小明 · 贷款 100 HTB（账户）' });
  await expect(page.locator('.dc-txns > li', { hasText: '李思远 · 贷款 50 HTB（现金）（已冲正）' })).toBeVisible();
  await line.getByRole('button', { name: /^冲正/ }).click();
  await reverse(page);
  await expect(sheet(page).locator('.dc-notice-danger')).toContainText('这笔贷款已经开始还款，不能再冲正。');
});

test('柜台: 王小雨 borrows 130 and takes 20 out, so her 存款 for the ranking is −20', async ({ page }) => {
  await teller(page);
  await serve(page, 'wxy', '王小雨');
  await page.getByPlaceholder('请输入金额').fill('130');
  await page.getByPlaceholder('例如：买文具').fill('春游');
  await bar(page, '放款').click();
  await confirmIn(page, '确认放款');
  await expect(page.locator('.dc-person-side')).toHaveText('130当前余额 HTB');
  await pick(page, '取款');
  await page.getByPlaceholder('请输入金额').fill('20');
  await page.getByRole('button', { name: '确认取款 20 HTB' }).click();
  await confirmIn(page, '确认取款');
  await expect(page.locator('.dc-person-side')).toHaveText('110当前余额 HTB');
});

test('学生: 首页 贷款, 我的贷款 with the plan, 明细 and 存折 「贷款」, money in and out without loans, and the ranking net of loans', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const [due, left] = sql(`select to_char(due_on, 'FMMM月FMDD日') || '|' || (principal - paid) from public.loan_periods
    where loan_id = ${LOAN('20260001')} and paid < principal order by seq limit 1`).split('|');
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-balance-amount')).toHaveText('133HTB');
  await expect(page.locator('.dc-balance-split')).toContainText('本学期支出 −37');
  await expect(page.locator('.dc-credit-summary .dc-kv > div').last()).toHaveText(`贷款剩余 25 HTB${due} 应还 ${left} HTB`);

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '信用', exact: true }).click();
  const mine = page.locator('.dc-card .dc-list-item', { hasText: '借了' });
  await expect(mine).toHaveText(`借了 100 HTB，还剩 25 HTB 没还下次 ${due} 还本金 ${left} HTB，利息约 0 HTB · 6.2667%/周还款中`);
  await expect(plan(page)).toHaveCount(4);

  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '明细', exact: true }).click();
  await page.getByRole('tab', { name: '贷款' }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.locator('.dc-txn-title')).toHaveText([
    '还款 · 利息 0 HTB，本金 10 HTB（已冲正）', '还款 · 利息 0 HTB，本金 50 HTB', '还款 · 利息 0 HTB，本金 25 HTB', '贷款 · 分 4 期，用途：买文具',
  ]);
  await expect(panel.locator('.dc-txn', { hasText: '贷款 · 分 4 期' }).locator('.dc-txn-amount')).toHaveText('+100放款');
  await expect(panel.locator('.dc-txn', { hasText: '本金 25 HTB' }).locator('.dc-txn-amount')).toHaveText('−25还款');
  await expect(panel.locator('.dc-txn', { hasText: '本金 10 HTB' }).locator('.dc-txn-amount')).toHaveText('10现金');
  await expect(page.locator('.dc-kv > div', { hasText: '支出' })).toHaveText('支出−37');

  // The ranking is net of loans: 王小雨 has 110 in 活期 and owes 130.
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '排名', exact: true }).click();
  const podium = page.getByRole('list', { name: '前三名' }).getByRole('listitem');
  await expect(podium).toHaveCount(2);
  await expect(podium.filter({ hasText: '王*雨' })).toContainText('−20HTB');
  await expect(page.locator('.dc-rank-card .dc-rank-place')).toHaveText('第 1 名存款 108 HTB');

  // The 存折's seven printed tabs share one row on an iPhone 13.
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, baseURL: process.env.E2E_BASE, ignoreHTTPSErrors: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  await page.goto('/book');
  const cover = page.getByRole('form', { name: '打开存折' });
  await cover.getByPlaceholder('学号').fill('20260001');
  await cover.getByPlaceholder('密码').fill('a12345678');
  await cover.getByRole('button', { name: '打开存折' }).click();
  await page.getByRole('navigation', { name: '存折栏目' }).getByRole('link', { name: '明细' }).click();
  const tabs = page.locator('.dc-pb-types button');
  for (let i = 0; i < 3 && !(await tabs.first().isVisible()); i++) {
    await page.getByRole('button', { name: '下一页' }).click(); await page.waitForTimeout(900);
  }
  await expect(tabs).toHaveText(['全部', '存款', '取款', '兑换', '工资', '利息', '贷款']);
  const ys = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(ys).size).toBe(1);
  await page.getByRole('tab', { name: '贷款' }).click();
  await expect(page.getByRole('tabpanel').locator('.dc-txn')).toHaveCount(4);
});

test('逾期: the counter tags the student, says what is late with the 罚息, refuses a payment short of the interest’s cents, and pays it off', async ({ page }) => {
  const loan = LOAN('20260001');
  sql(`update public.loan_periods set due_on = ${DAY} - 8 * (4 - seq) + 6, overdue_at = case when seq = 3 then now() end where loan_id = ${loan}`);
  sql(`update public.loans set status = 'overdue', interest_centi = 150 where id = ${loan}`);
  const due3 = md(`${DAY} - 2`);
  const late = Number(sql(`select principal - paid from public.loan_periods where loan_id = ${loan} and seq = 3`));

  // The student reads it first.
  await signIn(page, '学生', '20260001');
  await expect(page.locator('.dc-credit-summary .dc-kv > div.is-danger')).toHaveText(`贷款已逾期 · 应还 ${late} HTB`);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '信用', exact: true }).click();
  await expect(page.locator('.dc-notice-danger')).toHaveText(`贷款已逾期${due3} 那期还差 ${late} HTB。请尽快到柜台还款，每晚会先从活期自动扣。`);
  await expect(plan(page).nth(2)).toContainText('已逾期');
  await expect(plan(page).nth(3)).toContainText('本期');

  await teller(page);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(page.locator('.dc-person-name')).toHaveText('张小明 贷款逾期');
  await pick(page, '贷款');
  await expect(page.locator('.dc-notice-danger')).toHaveText(`贷款已逾期${due3} 那期还差 ${late} HTB。逾期的本金按罚息计息，每满一周再扣 30 分。`);
  const card = page.locator('section[aria-label="这笔贷款"]');
  await expect(card.locator('.dc-kv > div')).toHaveText(['剩余本金25 HTB', '已产生利息1.50 HTB', `本期应还${due3} · 本金 ${late} HTB，利息 1 HTB`, '周利率6.2667%/周', '罚息利率9.4001%/周']);
  await expect(card.locator('.dc-kv > div.is-danger')).toHaveText('罚息利率9.4001%/周');
  const amount = page.getByPlaceholder('请输入金额');
  await expect(amount).toHaveValue(String(late + 1));
  await expect(page.locator('.dc-field-hint')).toHaveText(`本期应还 ${late + 1} HTB · 全部结清 27 HTB`);

  // 剩余本金 + the interest's whole HTB leaves its cents: the server refuses, and the sheet stays open with why.
  await amount.fill('26');
  await bar(page, '确认还款').click();
  await confirmIn(page, '确认还款');
  await expect(sheet(page).locator('.dc-notice-danger')).toContainText('还清本金要连利息零头一起付，全部结清是 27 HTB。');
  await sheet(page).getByRole('button', { name: '取消' }).click();
  await amount.fill('27');
  await bar(page, '确认还款').click();
  await expect(sheet(page).locator('.dc-kv > div').first()).toHaveText('先付利息2 HTB');
  await confirmIn(page, '确认还款');
  await expect(page.getByText('贷款已结清。')).toBeVisible();
  await expect(page.locator('section[aria-label="这笔贷款"] .dc-tag')).toHaveText('已结清');
  await expect(page.getByPlaceholder('例如：买文具')).toBeVisible();
  expect(sql(`select status from public.loans where student_no = '20260001'`)).toBe('closed');
});

test('后台「贷款」: the tabs with their counts, a loan’s page, 注销 refused while it is open, and 终止 by the president', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('.dc-stat', { hasText: '贷款余额' })).toHaveText('贷款余额130HTB1 笔未结清');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '贷款', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/loans$/);
  await expect(page.getByRole('tab')).toHaveText(['全部 3', '还款中 1', '已逾期 0', '已结清 1', '已作废 1']);
  const rows = page.getByRole('table', { name: '贷款' }).locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('王小雨');
  await page.getByRole('tab', { name: '已作废 1' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('李思远');
  await page.getByRole('tab', { name: '全部 3' }).click();
  await page.getByRole('searchbox', { name: '搜索贷款' }).fill('张小明');
  await expect(rows).toHaveCount(1);
  await rows.first().getByRole('link', { name: /^DK/ }).click();
  await expect(page).toHaveURL(/\/admin\/loans\/[0-9a-f-]+$/);
  await expect(page.locator('.dc-person-name')).toHaveText('张小明 已结清');
  await expect(page.locator('.dc-stat')).toHaveText(['本金100HTB', '剩余本金0HTB', '已付利息2HTB', '已产生利息0.00HTB']);
  await expect(page.getByRole('table', { name: '还款记录' }).locator('tbody tr')).toHaveCount(4);
  await expect(page.getByRole('table', { name: '还款记录' })).toContainText('（已冲正）');
  await expect(page.getByRole('button', { name: '终止贷款' })).toHaveCount(0);

  // The bank admin cannot close 王小雨's account while she owes.
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students/20260003');
  await page.getByRole('button', { name: '注销账号' }).click();
  await confirmIn(page, '继续');
  await confirmIn(page, '确认注销');
  await expect(page.locator('.dc-notice-danger')).toContainText('王小雨 还有贷款没还清，结清后才能注销。');

  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/loans');
  await page.getByRole('table', { name: '贷款' }).getByRole('link', { name: /^DK/ }).first().click();
  await expect(page.locator('.dc-person-name')).toHaveText('王小雨 还款中');
  await page.getByRole('button', { name: '终止贷款' }).click();
  await expect(sheet(page).getByRole('button', { name: '下一步' })).toBeDisabled();
  await sheet(page).getByPlaceholder('写清楚终止的原因').fill('转学');
  await confirmIn(page, '下一步');
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('终止王小雨的贷款？');
  await expect(sheet(page)).toContainText('剩余本金 130 HTB 和已产生利息 0.00 HTB 立即全部到期：先从活期扣，不够的部分算逾期。');
  await confirmIn(page, '确认终止');
  await expect(page.locator('.dc-toast')).toHaveText('已终止');
  await expect(page.locator('.dc-notice')).toContainText('由 王行长 终止：转学');
  await expect(page.locator('.dc-person-name')).toHaveText('王小雨 已逾期');
  await expect(page.locator('.dc-stat').nth(1)).toHaveText('剩余本金20HTB');
  await expect(page.getByRole('table', { name: '还款记录' }).locator('tbody tr')).toContainText(['110']);
  await expect(page.getByRole('button', { name: '终止贷款' })).toHaveCount(0);

  await page.goto('/admin');
  const stat = page.locator('.dc-stat', { hasText: '贷款余额' });
  await expect(stat).toHaveText('贷款余额20HTB逾期 1 笔 · 20 HTB');
  await expect(stat.locator('em.is-danger')).toHaveText('逾期 1 笔 · 20 HTB');
  await page.goto('/admin/txns?type=loan,repay');
  await expect(page.locator('.dc-txn-title', { hasText: '还款 · 终止，利息 0 HTB，本金 110 HTB' })).toBeVisible();
});

test('柜台: with no term registered, a loan still runs 8 weeks', async ({ page }) => {
  sql(`delete from public.terms`);
  await teller(page);
  await serve(page, 'lsy', '李思远');
  await expect(page.locator('.dc-credit-summary .dc-kv > div').nth(2)).toHaveText('最长期限8 周');
  await page.getByPlaceholder('请输入金额').fill('20');
  await page.getByPlaceholder('例如：买文具').fill('买书');
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '期数增加 1' }).click();
  await expect(page.locator('.dc-qty-sum')).toHaveText(`期数最后一期 ${md(`${DAY} + 56`)}`);
  await bar(page, '放款').click();
  await expect(sheet(page).getByRole('table', { name: '还款计划' }).locator('tbody tr')).toHaveCount(8);
  await confirmIn(page, '确认放款');
  await expect(receipt(page)).toContainText('贷款分 8 期，存入账户 · HT');
  expect(sql(`select periods from public.loans where student_no = '20260002' and status = 'active'`)).toBe('8');
});
