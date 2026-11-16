import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 手动补录与更正 (PHASE-2.md §10.11, design system ManualEntry) on the seed data: 张小明 (20260001) has 108 HTB, 120 of it
// since 20 days ago. No term is registered: a 补录 goes back to the student's opening, 30 days ago for all three. 张小明's
// 活期 interest was counted for the last three days (0.35 HTB a day on 120 HTB at 2.08%/周), so a 补录 before them corrects
// it. The tests run in order and build the state up.
test.describe.configure({ mode: 'serial' });
test.beforeAll(() => {
  resetData();
  sql(`update public.students set opened_at = now() - interval '30 days';
       insert into public.interest_accruals (student_no, day, balance, rate, centi)
         select '20260001', ${DAY} - n, 120, 2.08, 35 from generate_series(1, 3) n;`);
});

const DAY = `(now() at time zone 'Asia/Shanghai')::date`;
const md = (date: string) => sql(`select to_char(${date}, 'FMMM月FMDD日')`);
const list = (page: Page) => page.locator('section[aria-label="流水"]');
const sheet = (page: Page) => page.locator('.dc-sheet');

async function admin(page: Page) {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
}

// 补录: open the page from 流水, pick the student and the type, and the day `back` days ago.
async function enter(page: Page, name: string, type: string, back = 0) {
  await page.goto('/admin/txns');
  await page.getByRole('link', { name: '补录', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/txns\/new$/);
  await page.getByRole('searchbox', { name: '搜索学生' }).fill(name);
  await page.locator('.dc-filter-found a', { hasText: name }).click();
  await page.locator('.dc-seg label', { hasText: type }).click();
  if (back) {
    const day = sql(`select (${DAY} - ${back})::text`);
    await page.locator('.dc-date .dc-date-trigger').click();
    if (day.slice(0, 7) !== sql(`select ${DAY}::text`).slice(0, 7)) await page.getByRole('button', { name: '上个月' }).click();
    await page.locator(`.dc-cal [data-day="${day}"]`).click();
  }
}
const reason = (page: Page, text: string) => page.getByPlaceholder('写清为什么补录，例如：系统故障，当天未记').fill(text);

test('补录 a 存款 by its notes: it stands at its original time with the day it was entered, and the interest is corrected', async ({ page }) => {
  await admin(page);
  await enter(page, '张小明', '存款', 3);
  await page.getByRole('button', { name: '增加一张 10 元' }).click();
  await page.getByRole('button', { name: '增加一张 10 元' }).click();
  await page.getByRole('button', { name: '增加一张 5 元' }).click();
  await expect(page.locator('.dc-caption', { hasText: '合计' })).toHaveText('合计 25 HTB');
  await expect(page.getByRole('button', { name: '补录', exact: true })).toBeDisabled(); // no reason yet
  await reason(page, '系统故障，当天未记');
  await page.getByRole('button', { name: '补录', exact: true }).click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('补录张小明的存款 25 HTB？');
  await expect(sheet(page).locator('.dc-kv > div')).toHaveText([
    '学生张小明 · 20260001', '类型存款', '金额25 HTB', new RegExp(`^原始时间${md(`${DAY} - 3`)} \\d{2}:\\d{2}$`), '活期余额108 → 133 HTB',
  ]);
  await expect(sheet(page)).toContainText('不计入任何柜员的上班现金。');
  await confirmIn(page, '确认补录');

  // Back on 流水 with the new one open: 3 days × (⌊145 × 2.08 ÷ 7⌋ − 35) = +0.24 HTB.
  await expect(page).toHaveURL(/\/admin\/txns\?no=HT/);
  await expect(page.locator('.dc-toast')).toHaveText('已补录，利息更正 +0.24 HTB');
  const open = list(page).locator('details[open]');
  await expect(open.locator('.dc-txn-title')).toHaveText('存款 · 补录：系统故障，当天未记');
  await expect(open.locator('.dc-txn-time').last()).toContainText(`· ${md(DAY)} 补录`);
  await expect(open.locator('.dc-kv')).toContainText(/补录\d+月\d+日 \d{2}:\d{2} 由银行管理员补录/);
  await expect(open.locator('.dc-kv')).toContainText('办理后余额133 HTB 录入时的余额');
  await expect(open.getByRole('link', { name: '编辑' })).toBeVisible();

  // The student's 明细: after today's business, before the opening 20 days ago.
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await page.goto('/student/txns');
  const rows = page.getByRole('tabpanel').locator('.dc-txn');
  await expect(rows.locator('.dc-txn-title')).toHaveText([/^兑换 · /, '取款', '存款', '存款 · 补录：系统故障，当天未记', '期初余额']);
  await expect(rows.nth(3).locator('.dc-txn-time')).toHaveText(new RegExp(`^\\d{2}:\\d{2} · ${md(DAY)} 补录$`));
});

test('补录 is refused when 活期 would fall short at some time since, or the time is before the account opened', async ({ page }) => {
  await admin(page);
  // 5 days ago 张小明 had 120 HTB: 125 out then leaves him 5 short, although he has 133 now.
  await enter(page, '张小明', '取款', 5);
  await page.getByPlaceholder('请输入金额').fill('125');
  await reason(page, '系统故障，当天未记');
  await page.getByRole('button', { name: '补录', exact: true }).click();
  await confirmIn(page, '确认补录');
  await expect(sheet(page).locator('.dc-notice-danger')).toHaveText(
    new RegExp(`^活期会不够补录后，${md(`${DAY} - 5`)} \\d{2}:\\d{2} 起活期会不够，差 5 HTB。$`));
  await sheet(page).getByRole('button', { name: '取消' }).click();

  // Before a student is picked the form says the range starts at the opening; once picked, from when.
  await page.goto('/admin/txns/new');
  await expect(page.locator('.dc-field-hint', { hasText: '可补录' }).last()).toHaveText('选好学生后，可补录开户以后的业务');
  await enter(page, '王小雨', '调账', 2);
  await expect(page.locator('.dc-field-hint', { hasText: '可补录' }).last()).toHaveText(new RegExp(`^可补录 ${md(`${DAY} - 30`)} \\d{2}:\\d{2} 开户以后的业务$`));
  // The form was opened when 王小雨 had opened 30 days ago; she opened just now after all: two days ago is too early, and
  // the form then says from when, and the calendar no longer offers the days before.
  sql(`update public.students set opened_at = now() - interval '1 minute' where student_no = '20260003'`);
  await page.getByPlaceholder('请输入金额').fill('5');
  await reason(page, '活动奖励漏记');
  await page.getByRole('button', { name: '补录', exact: true }).click();
  await confirmIn(page, '确认补录');
  await expect(sheet(page).locator('.dc-notice-title')).toHaveText('时间不在补录范围内');
  await expect(sheet(page).locator('.dc-notice-text')).toHaveText(new RegExp(`^只能补录 ${md(DAY)} \\d{2}:\\d{2} 开户以后到现在之间发生的业务。$`));
  await sheet(page).getByRole('button', { name: '取消' }).click();
  await expect(page.locator('.dc-field-hint', { hasText: '可补录' }).last()).toHaveText(new RegExp(`^可补录 ${md(DAY)} \\d{2}:\\d{2} 开户以后的业务$`));
  await page.locator('.dc-date .dc-date-trigger').click();
  if (sql(`select (${DAY} - 1)::text`).slice(0, 7) === sql(`select ${DAY}::text`).slice(0, 7)) {
    await expect(page.locator(`.dc-cal [data-day="${sql(`select (${DAY} - 1)::text`)}"]`)).toBeDisabled();
  }
  await expect(page.locator(`.dc-cal [data-day="${sql(`select ${DAY}::text`)}"]`)).toBeEnabled();
  sql(`update public.students set opened_at = now() - interval '30 days' where student_no = '20260003'`);
});

test('补录 调账 both ways: a deposit’s or a withdrawal’s look by its sign, 调账 under the amount', async ({ page }) => {
  await admin(page);
  for (const [way, amount] of [['增加', '20'], ['减少', '20']]) {
    await enter(page, '张小明', '调账');
    await page.locator('.dc-seg label', { hasText: way }).click();
    await page.getByPlaceholder('请输入金额').fill(amount);
    await reason(page, way === '增加' ? '活动奖励漏记' : '重复入账');
    await page.getByRole('button', { name: '补录', exact: true }).click();
    await expect(sheet(page).locator('.dc-sheet-title')).toHaveText(`给张小明调账 ${way === '增加' ? '+' : '−'}20 HTB？`);
    await expect(sheet(page)).not.toContainText('上班现金');
    await confirmIn(page, '确认补录');
    await expect(page.locator('.dc-toast')).toHaveText('已补录');
  }
  await page.goto('/admin/txns?student=20260001&type=adjust');
  const rows = list(page).locator('.dc-txn');
  await expect(rows).toHaveCount(2);
  await expect(rows.locator('.dc-txn-amount')).toHaveText(['−20调账', '+20调账']);
  await expect(rows.nth(0)).toHaveClass(/dc-kind-withdraw/);
  await expect(rows.nth(1)).toHaveClass(/dc-kind-save/);
  await expect(rows.nth(0).locator('.dc-txn-title')).toHaveText('调账 · 补录：重复入账');
});

test('补录 a cash 兑换: the change is worked out and 活期 stays', async ({ page }) => {
  await admin(page);
  await enter(page, '李思远', '兑换');
  await page.getByRole('button', { name: /^海豚书签，10 HTB/ }).click();
  await page.locator('.dc-seg label', { hasText: '现金' }).click();
  await page.getByRole('button', { name: '增加一张 10 元' }).click();
  await page.getByRole('button', { name: '增加一张 10 元' }).click();
  await expect(page.locator('.dc-caption', { hasText: '应付' })).toHaveText('应付 10 HTB，收到 20 HTB，找零 10 HTB');
  await reason(page, '系统故障，当天未记');
  await page.getByRole('button', { name: '补录', exact: true }).click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText('补录李思远的兑换 10 HTB？');
  await expect(sheet(page).locator('.dc-kv > div').last()).toHaveText('活期余额70 → 70 HTB');
  await confirmIn(page, '确认补录');
  await expect(page.locator('.dc-toast')).toHaveText('已补录');
  const no = new URL(page.url()).searchParams.get('no');
  expect(sql(`select change_given from public.txns where txn_no = '${no}'`)).toBe('{"10": 1}');
  await expect(list(page).locator('details[open] .dc-txn-amount')).toHaveText('10现金');
});

test('编辑 a 存款’s amount: the original links to what it became and back, both at the original time', async ({ page }) => {
  await admin(page);
  await page.goto('/admin/txns?student=20260001&type=deposit');
  const line = list(page).locator('details', { hasText: '存款 · 补录：系统故障，当天未记' });
  await line.locator('summary').click();
  const original = (await line.locator('.dc-kv dd').first().textContent())!;
  await line.getByRole('link', { name: '编辑' }).click();
  await expect(page).toHaveURL(/\/admin\/txns\/new\?edit=/);
  await expect(page.locator('.dc-top-title')).toContainText(`编辑 ${original}`);
  await expect(page.locator('.dc-date .dc-date-trigger')).toBeDisabled();
  await expect(page.locator('.dc-time .dc-date-trigger')).toBeDisabled();
  await expect(page.getByText('编辑时间固定为原流水的时间')).toBeVisible();
  await page.locator('.dc-check', { hasText: '金额录错' }).click();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeDisabled(); // nothing changed yet
  await page.getByRole('button', { name: '减少一张 10 元' }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(sheet(page).locator('.dc-sheet-title')).toHaveText(`编辑 ${original}？`);
  await expect(sheet(page).locator('tbody tr')).toHaveText(['学生张小明张小明', '类型存款存款', '金额25 HTB15 HTB']);
  await expect(sheet(page).locator('tbody tr').last().locator('b')).toHaveText('15 HTB');
  await expect(sheet(page).locator('.dc-kv')).toHaveText('张小明 活期133 → 123 HTB');
  await confirmIn(page, '确认编辑');

  // 3 days × (⌊135 × 2.08 ÷ 7⌋ − 35 − 8) = −0.09 HTB.
  await expect(page.locator('.dc-toast')).toHaveText('已编辑，利息更正 −0.09 HTB');
  const made = list(page).locator('details[open]');
  await expect(made.locator('.dc-txn-title')).toHaveText('存款 · 更正：金额录错');
  await expect(made.locator('.dc-kv')).toContainText(`更正自${original}`);
  const fixed = (await made.locator('.dc-kv dd').first().textContent())!;
  await made.getByRole('link', { name: original }).click();
  const back = list(page).locator('details[open]');
  await expect(back.locator('.dc-kv')).toContainText(`已更正为${fixed}`);
  await expect(back.locator('.dc-kv')).toContainText('已冲正 · 金额录错');
  await expect(back.getByRole('link', { name: '编辑' })).toHaveCount(0);
  await back.getByRole('link', { name: fixed }).click();
  await expect(list(page).locator('details[open] .dc-kv dd').first()).toHaveText(fixed);

  // The reversal it made says so.
  await page.goto('/admin/txns?student=20260001&type=reversal');
  const reversal = list(page).locator('details').first();
  await reversal.locator('summary').click();
  await expect(reversal.locator('.dc-kv')).toContainText('状态编辑时冲正');
  await expect(reversal.getByRole('link', { name: '编辑' })).toHaveCount(0);
});

test('编辑 to another student: both students’ 活期 in the confirmation', async ({ page }) => {
  await admin(page);
  await page.goto('/admin/txns?student=20260001&type=adjust');
  const line = list(page).locator('details', { hasText: '+20调账' });
  await line.locator('summary').click();
  await line.getByRole('link', { name: '编辑' }).click();
  await page.getByRole('button', { name: '换一位' }).click();
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('李思远');
  await page.locator('.dc-filter-found a', { hasText: '李思远' }).click();
  await page.locator('.dc-check', { hasText: '学号录错' }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(sheet(page).locator('tbody tr').first()).toHaveText('学生张小明李思远');
  await expect(sheet(page).locator('.dc-kv > div')).toHaveText(['张小明 活期123 → 103 HTB', '李思远 活期70 → 90 HTB']);
  await confirmIn(page, '确认编辑');
  await expect(page.locator('.dc-toast')).toHaveText('已编辑');
  const made = list(page).locator('details[open]');
  await expect(made).toContainText('学号 20260002');
  await expect(made.locator('.dc-txn-title')).toHaveText('调账 · 更正：学号录错');
});

test('the 利息 that pays the corrections says so and has no 编辑; the president and the accountant have neither', async ({ page }) => {
  sql(`select app_private.settle_interest(now())`);
  await admin(page);
  await page.goto('/admin/txns?type=interest');
  const line = list(page).locator('details').first();
  await expect(line.locator('.dc-txn-title')).toHaveText(`利息 · ${md(`${DAY} - 3`)}至${md(`${DAY} - 1`)}活期利息，含更正 +0.15 HTB`);
  await line.locator('summary').click();
  await expect(line.getByRole('link', { name: '编辑' })).toHaveCount(0);

  for (const who of ['president01', 'accountant01']) {
    await signIn(page, '工作人员', who);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/txns?student=20260001&type=deposit');
    await expect(list(page).locator('.dc-txn').first()).toBeVisible();
    await expect(page.getByRole('link', { name: '补录', exact: true })).toHaveCount(0);
    await list(page).locator('details').first().locator('summary').click();
    await expect(list(page).getByRole('link', { name: '编辑' })).toHaveCount(0);
    await page.goto('/admin/txns/new');
    await expect(page).toHaveURL(/\/admin\/txns$/);
  }
});
