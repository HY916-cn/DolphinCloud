import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn, sql } from './helpers';

// 利率与活期利息 (PHASE-2.md §9) on the seed data (supabase/seed.sql): no term and no anchor yet, every student at 600.
// The tests run in order and build the state up: a term around today, then this Monday's anchor, then a week's interest
// paid to 张小明 (20260001), then the term moved into the past; the last one edits the 利率 group of 参数. 定期 has the fixed
// rates of term_rates (2 周 2.5%, 4 周 2.75%, 12 周 3%, 24 周 3.25%, 48 周 3.5%) whatever the score and the anchor.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const DAY = `(now() at time zone 'Asia/Shanghai')::date`;
const MONDAY = `date_trunc('week', now() at time zone 'Asia/Shanghai')::date`;
const md = (date: string) => sql(`select to_char(${date}, 'FMMM月FMDD日')`);
const rates = (page: Page) => page.getByRole('region', { name: '本周利率' });
const caption = (page: Page) => rates(page).locator('.dc-caption');
const TERM_BACK = ['105.00 HTB', '111.00 HTB', '136.00 HTB', '178.00 HTB', '268.00 HTB'];

async function studentCredit(page: Page) {
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await page.goto('/student/credit');
}

test('学生「信用」: the week’s rates at my score, with no term and no anchor yet', async ({ page }) => {
  await studentCredit(page);
  await expect(page.locator('.dc-list-title', { hasText: '本周利率' })).toHaveText('本周利率 · 按 600 分');
  // Each rate as an example on 100 HTB, the weekly rate in small type below it.
  await expect(rates(page).locator('.dc-rate-list > li')).toHaveText([
    '活期存 100 HTB，一周多得约 2.08 HTB2.08%/周', '定期 2 周存 100 HTB，到期拿回 105.00 HTB2.5%/周',
    '定期 4 周存 100 HTB，到期拿回 111.00 HTB2.75%/周', '定期 12 周存 100 HTB，到期拿回 136.00 HTB3%/周',
    '定期 24 周存 100 HTB，到期拿回 178.00 HTB3.25%/周', '定期 48 周存 100 HTB，到期拿回 268.00 HTB3.5%/周',
    '借 100 HTB，一周利息约 6.27 HTB6.2667%/周',
  ]);
  await expect(rates(page).locator('.dc-rate-list > li').locator('b')).toHaveText(['2.08 HTB', ...TERM_BACK, '6.27 HTB']);
  await expect(rates(page).locator('.dc-rate-list > li').locator('small')).toHaveText(['2.08%/周', '2.5%/周', '2.75%/周', '3%/周', '3.25%/周', '3.5%/周', '6.2667%/周']);
  await expect(caption(page)).toHaveText('信用分越高，活期多得，借钱少付；定期利率是固定的。本周利率还没有公布，先按初始利率显示。每周一公布。');

  // Below the lowest score to borrow, no loan rate.
  sql(`update public.credit_scores set score = 350 where student_no = '20260001'`);
  await page.reload();
  await expect(page.locator('.dc-list-title', { hasText: '本周利率' })).toHaveText('本周利率 · 按 350 分');
  await expect(rates(page).locator('.dc-rate-list > li').last()).toHaveText('400 分以上才能贷款');
  await expect(rates(page).locator('.dc-rate-list > li').last().locator('small')).toHaveCount(0);
  sql(`update public.credit_scores set score = 600 where student_no = '20260001'`);

  // 首页: nothing saved up yet.
  await page.goto('/student');
  await expect(page.locator('.dc-credit-summary .dc-kv')).toHaveText('攒着的利息0.00 HTB满 1 HTB 再存进余额定期合计没有理财没有贷款没有');
});

test('in a term with no anchor published: the initial rates, and 利率 says so; the storekeeper has no 利率', async ({ page, browser }) => {
  sql(`insert into public.terms (name, starts_on, ends_on) values ('本学期', ${DAY} - 60, ${DAY} + 60)`);
  await studentCredit(page);
  await expect(caption(page)).toHaveText('信用分越高，活期多得，借钱少付；定期利率是固定的。本周利率还没有公布，先按初始利率显示。每周一公布。');
  await expect(rates(page).locator('.dc-rate-list > li').first()).toHaveText('活期存 100 HTB，一周多得约 2.08 HTB2.08%/周');

  const accountant = await browser.newPage();
  await signIn(accountant, '工作人员', 'accountant01');
  await expect(accountant).toHaveURL(/\/admin$/);
  await accountant.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '利率', exact: true }).click();
  await expect(accountant).toHaveURL(/\/admin\/rates$/);
  const anchor = accountant.getByRole('region', { name: '本周锚点' });
  await expect(anchor.locator('.dc-stat')).toHaveText(['本周锚点2%', '存贷比—', '存款余额—HTB']);
  await expect(anchor.locator('p.dc-caption')).toHaveText('还没有公布锚点，现在按初始锚点 2% 计算。每周一公布。');
  await expect(accountant.getByRole('region', { name: '每周历史' })).toContainText('还没有记录。每周一公布一次锚点。');
  await expect(accountant.getByRole('region', { name: '计算参数' })).toContainText('罚息倍数×1.5');
  await expect(accountant.getByRole('link', { name: '在参数页修改' })).toHaveCount(0);
  await accountant.close();

  const keeper = await browser.newPage();
  await signIn(keeper, '工作人员', 'keeper01');
  await expect(keeper).toHaveURL(/\/admin$/);
  await expect(keeper.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '利率', exact: true })).toHaveCount(0);
  await keeper.goto('/admin/rates');
  await expect(keeper).toHaveURL(/\/admin$/);
  await keeper.close();
});

test('this Monday’s anchor: the student’s rates follow it, and 利率 lists the table, the history and its parameters', async ({ page }) => {
  const params = `'{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}'`;
  sql(`insert into public.rate_weeks (week_start, prev_anchor, deposits, loans, ratio, growth, adjust, anchor, params) values
         (${MONDAY} - 7, 2, 12000, 0, 0, null, 0, 2, ${params}),
         (${MONDAY}, 2, 12480, 4992, 40, 2, 0.25, 2.25, ${params})`);
  await studentCredit(page);
  await expect(caption(page)).toHaveText(`信用分越高，活期多得，借钱少付；定期利率是固定的。${md(MONDAY)}公布，每周一更新。`);
  await expect(rates(page).locator('.dc-rate-list > li').locator('b')).toHaveText(['2.34 HTB', ...TERM_BACK, '7.05 HTB']);

  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/rates');
  const anchor = page.getByRole('region', { name: '本周锚点' });
  await expect(anchor.locator('.dc-stat')).toHaveText(['本周锚点2.25%比上周 +0.25 个百分点', '存贷比40.0%', '存款余额12,480HTB']);
  await expect(anchor.locator('.dc-stat em')).toHaveClass('is-up');
  await expect(anchor.locator('p.dc-caption')).toHaveText(`${md(MONDAY)}公布，下次 ${md(`${MONDAY} + 7`)}。`);
  const table = page.getByRole('table', { name: '按分数的周利率' });
  await expect(page.getByRole('heading', { name: '按分数的周利率 · 锚点 2.25%' })).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['分数', '活期', '贷款', '逾期罚息']);
  await expect(table.locator('tbody tr').first()).toHaveText('0 分1.8%不能贷款不能贷款');
  await expect(table.locator('tbody tr', { hasText: '600 分' })).toHaveText('600 分2.34%7.05%10.575%');
  // 定期周利率: the fixed rates, below the table; the bank admin, not the president, changes them on 参数.
  const term = page.getByRole('region', { name: '定期周利率' });
  await expect(term.locator('.dc-kv > div')).toHaveText(['2 周2.5%', '4 周2.75%', '12 周3%', '24 周3.25%', '48 周3.5%']);
  await expect(term.getByRole('link', { name: '在参数页修改' })).toHaveCount(0);

  const history = page.getByRole('table', { name: '每周历史' }).locator('tbody tr');
  await expect(history).toHaveCount(2);
  await expect(history.first()).toHaveText(`${md(MONDAY)}2%12,4804,99240.0%+2.0%+0.252.25%查看`);
  await expect(history.last()).toHaveText(`${md(`${MONDAY} - 7`)} 不调整2%12,00000.0%—0.002%查看`);
  await history.first().getByRole('button', { name: '查看' }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText(`${md(MONDAY)}的锚点参数`);
  await expect(sheet.locator('.dc-kv > div')).toHaveText(['初始锚点2%', '锚点范围1%～4%', '目标存贷比30%（每差 10% 调整 0.25 个百分点）',
    '目标增速2%（每差 1% 调整 0.25 个百分点）', '每周最多调整±0.5 个百分点']);
  await sheet.getByRole('button', { name: '关闭' }).click();
  await expect(sheet).toHaveCount(0);
  // 计算参数: what 参数 changes, then what the system fixes, each value read from settings.
  const card = page.getByRole('region', { name: '计算参数' });
  await expect(card.locator('.dc-list-title')).toHaveText(['可在参数页修改', '系统固定']);
  await expect(card.locator('.dc-kv').first().locator('> div')).toHaveText(['初始锚点2%', '锚点范围1%～4%']);
  await expect(card.locator('.dc-kv').last().locator('> div')).toHaveText(['目标存贷比30%（每差 10% 调整 0.25 个百分点）',
    '目标增速2%（每差 1% 调整 0.25 个百分点）', '每周最多调整±0.5 个百分点', '贷款倍数×2', '罚息倍数×1.5']);
  await expect(card.getByRole('link', { name: '在参数页修改' })).toHaveCount(0);
});

test('a week’s 活期 interest: 攒着的利息 on 首页, the 利息 entry under 明细 and in 流水, never reversible', async ({ page }) => {
  // 2.00 + 0.50 paid in on Monday (2 HTB, 0.50 carried), then 0.37 more since: 0.87 to come.
  sql(`insert into public.interest_accruals (student_no, day, balance, rate, centi) values
         ('20260001', ${MONDAY} - 3, 108, 2.08, 200), ('20260001', ${MONDAY} - 2, 108, 2.08, 50);
       select app_private.settle_interest(${MONDAY}::timestamp at time zone 'Asia/Shanghai');
       insert into public.interest_accruals (student_no, day, balance, rate, centi) values ('20260001', ${MONDAY}, 110, 2.34, 37);`);
  const reason = `${md(`${MONDAY} - 3`)}至${md(`${MONDAY} - 2`)}活期利息`;
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-credit-summary .dc-kv')).toHaveText('攒着的利息0.87 HTB满 1 HTB 再存进余额定期合计没有理财没有贷款没有');

  await page.goto('/student/txns');
  await page.getByRole('tab', { name: '利息' }).click();
  const rows = page.getByRole('tabpanel').locator('.dc-txn');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.dc-txn-title')).toHaveText(`利息 · ${reason}`);
  await expect(rows.first()).toHaveClass(/dc-kind-reward/);
  await expect(rows.first().locator('.dc-txn-amount')).toHaveText('+2存入');
  await expect(page.getByRole('button', { name: '冲正' })).toHaveCount(0);

  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/txns?type=interest');
  const line = page.locator('details', { hasText: reason });
  await expect(line.locator('.dc-txn-time').first()).toContainText('经办人 系统');
  await line.locator('summary').click();
  await expect(line.locator('.dc-kv')).toContainText('经办人系统');
  await expect(line.getByRole('link', { name: '查看学生' })).toBeVisible();
  await expect(line.getByRole('button', { name: '冲正' })).toHaveCount(0);
  await expect(line.getByRole('link', { name: '查看经办人' })).toHaveCount(0);
});

test('in the holidays interest goes on, and both pages say when the anchor was published as in term', async ({ page }) => {
  sql(`update public.terms set starts_on = ${DAY} - 120, ends_on = ${DAY} - 1`);
  await studentCredit(page);
  await expect(caption(page)).toHaveText(`信用分越高，活期多得，借钱少付；定期利率是固定的。${md(MONDAY)}公布，每周一更新。`);
  await expect(rates(page).locator('.dc-rate-list > li').first()).toHaveText('活期存 100 HTB，一周多得约 2.34 HTB2.34%/周');
  await page.goto('/student');
  await expect(page.locator('.dc-credit-summary .dc-kv')).toHaveText('攒着的利息0.87 HTB满 1 HTB 再存进余额定期合计没有理财没有贷款没有');

  // A whole 1 HTB or more saved up: paid in next Monday.
  sql(`update public.interest_accruals set centi = 77 where student_no = '20260001' and day = ${MONDAY}`);
  await page.reload();
  await expect(page.locator('.dc-credit-summary .dc-kv')).toHaveText('攒着的利息1.27 HTB下周一存进余额定期合计没有理财没有贷款没有');

  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/rates');
  await expect(page.getByRole('region', { name: '本周锚点' }).locator('p.dc-caption')).toHaveText(`${md(MONDAY)}公布，下次 ${md(`${MONDAY} + 7`)}。`);
});

test('参数「利率」: 定期周利率 and the anchor’s start and bounds, checked as the server checks them, the rest kept as read', async ({ page }) => {
  const fixed = `select jsonb_build_object('loan', (select value from public.settings where key = 'loan_multiplier'),
    'penalty', (select value from public.settings where key = 'penalty_multiplier'))`;
  const multipliers = sql(fixed);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings');
  const save = page.getByRole('button', { name: '保存参数' });
  const field = (label: string) => page.locator('.dc-field', { has: page.getByLabel(label, { exact: true }) });
  const group = page.locator('section', { has: page.getByRole('heading', { name: '利率', exact: true }) });
  await expect(group.locator('.dc-list-title')).toHaveText(['定期周利率', '锚点']);
  await expect(group.locator('p.dc-caption')).toHaveText(['新开的定期按这里的利率锁定，已经开的定期不变。', '从下周一起生效。其余计算参数由系统固定，可在利率页查看。']);
  await expect(group.locator('.dc-field')).toHaveCount(8);
  for (const [label, value] of [['2 周', '2.5'], ['4 周', '2.75'], ['12 周', '3'], ['24 周', '3.25'], ['48 周', '3.5']]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  for (const [label, value] of [['初始锚点', '2'], ['锚点下限', '1'], ['锚点上限', '4']]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  await expect(group.getByRole('table')).toHaveCount(0);

  // Each 定期 length on its own: 0.01 to 100, 2 decimals at most.
  await page.getByLabel('12 周', { exact: true }).fill('3.255');
  await expect(field('12 周')).toContainText('请输入 0.01 到 100 的数，最多 2 位小数');
  await expect(save).toBeDisabled();
  await page.getByLabel('48 周', { exact: true }).fill('0');
  await expect(field('48 周')).toHaveClass(/is-error/);
  await page.getByLabel('12 周', { exact: true }).fill('3.05');
  await page.getByLabel('48 周', { exact: true }).fill('3.6');
  await expect(group.locator('.is-error')).toHaveCount(0);

  await page.getByLabel('初始锚点', { exact: true }).fill('5');
  await expect(field('初始锚点')).toHaveClass(/is-error/);
  await expect(field('锚点上限')).toContainText('要满足：下限 ≤ 初始锚点 ≤ 上限');
  await expect(save).toBeDisabled();
  await page.getByLabel('初始锚点', { exact: true }).fill('2.005');
  await expect(field('初始锚点')).toContainText('请输入 0.01 到 100 的数，最多 2 位小数');
  await expect(field('锚点上限')).not.toHaveClass(/is-error/);
  await page.getByLabel('锚点下限', { exact: true }).fill('0');
  await expect(field('锚点下限')).toContainText('请输入 0.01 到 100 的数，最多 2 位小数');
  await expect(save).toBeDisabled();

  await page.getByLabel('初始锚点', { exact: true }).fill('2.5');
  await page.getByLabel('锚点下限', { exact: true }).fill('1.25');
  await page.getByLabel('锚点上限', { exact: true }).fill('5');
  await expect(group.locator('.is-error')).toHaveCount(0);
  await save.click();
  await expect(page.getByText('参数已保存')).toBeVisible();
  expect(sql(`select value = '{"initial":2.5,"min":1.25,"max":5,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5}'
    from public.settings where key = 'anchor_params'`)).toBe('t');
  expect(sql(`select value = '{"2":2.5,"4":2.75,"12":3.05,"24":3.25,"48":3.6}' from public.settings where key = 'term_rates'`)).toBe('t');
  expect(sql(fixed)).toBe(multipliers);
});
