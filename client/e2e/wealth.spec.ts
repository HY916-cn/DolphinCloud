import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 理财 (PHASE-2.md §10.10, design system Invest) on the seed data (supabase/seed.sql): 张小明 (20260001) has 108 HTB and no
// loan; wealth_params is the default (沪深 300, factor 2, 12 周 daily base 0.5153%, 稳健 ×1 ±5%, 平衡 ×2 ±10%, 进取 ×4 ±20%).
// The snapshot has no index days: the last three weekdays before today are W1 (latest), W2 and W3; W3 and W2 get a close
// (−0.50%, +1.25%) and W1 none, so W1 waits to be entered (a later trading day would make it a holiday). The tests run in
// order: teller01 buys, reverses and redeems 理财; 张小明 reads them; the bank admin enters W1 and edits the parameters.
test.describe.configure({ mode: 'serial' });
const DAY = 'app_private.cn_date(now())';
// The weekdays before today on the school's clock (Asia/Shanghai is UTC+8 all year), latest first.
const TODAY = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const back = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000);
const [W1, W2, W3] = Array.from({ length: 10 }, (_, i) => back(i + 1)).filter((d) => d.getUTCDay() % 6).slice(0, 3).map((d) => d.toISOString().slice(0, 10));
// A weekend between W3 and today: listed as 休市.
const closedDay = Array.from({ length: 10 }, (_, i) => back(i + 1)).some((d) => !(d.getUTCDay() % 6) && d.toISOString().slice(0, 10) > W3);
test.beforeAll(() => {
  resetData();
  sql(`insert into public.wealth_days (day, change, source, params) values ('${W3}', -0.5, 'tencent', '{}'), ('${W2}', 1.25, 'tencent', '{}')`);
});

const md = (date: string) => sql(`select to_char((${date})::date, 'FMMM月FMDD日')`);
const pick = (page: Page, name: string) => page.locator('.dc-seg label', { hasText: name }).click();
const receipt = (page: Page) => page.locator('aside[aria-label="办理单"]');
const lengths = (page: Page) => page.getByRole('radiogroup', { name: '期限' }).locator('.dc-choice');
const length = (page: Page, weeks: number) => lengths(page).filter({ hasText: new RegExp(`^${weeks} 周`) });
const tiers = (page: Page) => page.getByRole('radiogroup', { name: '倍率' }).locator('.dc-choice');
const balance = () => sql(`select balance from public.accounts where student_no = '20260001'`);
const weekend = () => !(new Date(`${TODAY}T00:00:00Z`).getUTCDay() % 6);

async function serve(page: Page) {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await find(page);
}
// The counter keeps a quote for 30 s; a value changed here is read again on a new visit after a reload.
async function reopen(page: Page) {
  await page.reload();
  await find(page);
}
async function find(page: Page) {
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await expect(page.locator('.dc-person-name')).toHaveText('张小明');
  await pick(page, '理财');
}

async function buy(page: Page, weeks: number, tier: string, amount: number) {
  await length(page, weeks).click();
  await tiers(page).filter({ hasText: tier }).click();
  await page.getByPlaceholder('请输入金额').fill(String(amount));
  await page.getByRole('button', { name: '买入理财', exact: true }).click();
  await confirmIn(page, '确认买入');
  await expect(page.locator('.dc-sheet')).toHaveCount(0);
}

test('柜台「理财」: the index, lengths and tiers, 买理财 with its 冲正, and 赎回 with a gain and a loss', async ({ page }) => {
  await serve(page);
  const card = page.getByRole('region', { name: '指数涨跌' });
  await expect(card.locator('.dc-kv')).toHaveText(`${md(`'${W2}'`)} 指数涨跌+1.25%`);
  await expect(card.locator('.dc-kv .dc-pl')).toHaveClass(/is-up/);
  await expect(card).toContainText(`参考 沪深 300 指数 · ${md(`'${W2}'`)} 收盘 · 腾讯行情`);
  await expect(card.getByText('今天休市，只算基础收益。')).toHaveCount(weekend() ? 1 : 0);
  await expect(card.getByRole('table', { name: '最近 10 个交易日' }).locator('tbody tr')).toHaveText([`${md(`'${W2}'`)}+1.25%`, `${md(`'${W3}'`)}−0.50%`]);
  await expect(page.locator('.dc-notice', { hasText: '理财可能亏损' })).toContainText('到期或赎回时拿回的钱可能少于本金。可以随时按当时的价值赎回。');
  await expect(lengths(page)).toHaveText([2, 4, 12, 24, 48].map((w) => `${w} 周${md(`${DAY} + ${7 * w}`)} 到期`));
  await expect(tiers(page)).toHaveCount(0);
  await expect(page.getByText('还没有理财。')).toBeVisible();

  // 12 周: daily base 0.5153% + multiplier × 2 × 1.25, within the tier's daily bounds.
  await length(page, 12).click();
  await expect(tiers(page)).toHaveText(['稳健 ×1今天 +3.02%每天最多赚 5%每天最多亏 5%', '平衡 ×2今天 +5.52%每天最多赚 10%每天最多亏 10%',
    '进取 ×4今天 +10.52%每天最多赚 20%每天最多亏 20%']);
  await expect(page.getByText('倍率越高，赚得越多，亏得也越多。休市的日子只算基础收益。')).toBeVisible();
  const hint = page.locator('.dc-field-hint');
  const amount = page.getByPlaceholder('请输入金额');
  await expect(hint).toHaveText('1 HTB 起，最多 108 HTB（活期余额）');
  await amount.fill('200');
  await expect(hint).toHaveText('余额不足：活期余额 108 HTB，还差 92 HTB');
  await amount.fill('100');
  await expect(page.getByRole('button', { name: '买入理财', exact: true })).toBeDisabled();
  await tiers(page).filter({ hasText: '平衡' }).click();
  const twelve = md(`${DAY} + 84`);
  await expect(receipt(page)).toContainText(`买理财（正在办理）12 周 · 平衡 ×2，${twelve} 到期−100`);
  await expect(page.locator('.dc-actions-total')).toHaveText('买入理财办理后余额 8 HTB100HTB');

  await page.getByRole('button', { name: '买入理财', exact: true }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('给张小明买理财 100 HTB？');
  await expect(sheet.locator('.dc-kv > div')).toHaveText(['期限12 周', '倍率平衡 ×2', `到期日${twelve}`, '开始计收益明天', '这一档今天的收益率+5.52%',
    '每天范围最多赚 10%，最多亏 10%', '活期余额108 → 8 HTB']);
  await expect(sheet).toContainText('理财可能亏损，到期拿回的钱可能少于 100 HTB，最多亏光本金。平衡 ×2 跟着指数的涨跌是稳健的 2 倍，一天最多可能亏 10%。');
  await confirmIn(page, '确认买入');
  await expect(receipt(page)).toContainText(`买理财12 周 · 平衡 ×2，${twelve} 到期 · HT`);
  await expect(page.locator('.dc-person-side')).toHaveText('8当前余额 HTB');
  await expect(page.locator('.dc-list-item')).toHaveText([`理财 12 周 · 平衡 ×2 · 本金 100 HTB，现在值 100.00 HTB持平 · ${twelve} 到期持有中赎回`]);

  // A 买理财 entered wrong is reversed from the 办理单: the holding is gone and 活期 is back.
  await receipt(page).getByRole('button', { name: '冲正买理财' }).click();
  await page.locator('.dc-sheet .dc-check', { hasText: '金额录错' }).click();
  await confirmIn(page, '确认冲正');
  await expect(receipt(page)).toContainText('买理财（已冲正）');
  await expect(page.locator('.dc-person-side')).toHaveText('108当前余额 HTB');
  await expect(page.getByText('还没有理财。')).toBeVisible();

  // 赎回 with a gain: the value 31.23 HTB, its whole HTB into 活期.
  await buy(page, 4, '稳健', 30);
  sql(`update public.wealth_holdings set value_centi = 3123 where student_no = '20260001' and status = 'open'`);
  await reopen(page);
  await page.getByRole('button', { name: '赎回 4 周理财 30 HTB' }).click();
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('赎回这笔理财 30 HTB？');
  await expect(sheet).toContainText('按现在的价值 31.23 HTB 转回活期，盈 +1.23 HTB。赎回后不再随指数涨跌。');
  let carry = Number(sql(`select interest_carry from public.accounts where student_no = '20260001'`));
  await confirmIn(page, '赎回');
  await expect(page.locator('.dc-toast')).toHaveText(`已赎回，转回活期 ${Math.floor((carry + 3123) / 100)} HTB`);
  await expect(receipt(page)).toContainText('理财赎回4 周，盈 +1.23 HTB · HT');
  await expect(receipt(page).getByRole('button', { name: '冲正理财赎回' })).toHaveCount(0);
  await expect(page.locator('.dc-list-item')).toHaveText(['理财 4 周 · 稳健 ×1 · 本金 30 HTB，拿回 31.23 HTB盈 +1.23 HTB已赎回']);
  await expect(page.locator('.dc-list-item .dc-pl')).toHaveClass(/is-up/);

  await buy(page, 2, '进取', 10);
  // 赎回 with a loss.
  sql(`update public.wealth_holdings set value_centi = 650 where student_no = '20260001' and status = 'open'`);
  await reopen(page);
  await page.getByRole('button', { name: '赎回 2 周理财 10 HTB' }).click();
  await expect(sheet).toContainText('按现在的价值 6.50 HTB 转回活期，亏 −3.50 HTB。赎回后不再随指数涨跌。');
  carry = Number(sql(`select interest_carry from public.accounts where student_no = '20260001'`));
  await confirmIn(page, '赎回');
  await expect(page.locator('.dc-toast')).toHaveText(`已赎回，转回活期 ${Math.floor((carry + 650) / 100)} HTB`);
  const lost = page.locator('.dc-list-item', { hasText: '进取' });
  await expect(lost).toHaveText('理财 2 周 · 进取 ×4 · 本金 10 HTB，拿回 6.50 HTB亏 −3.50 HTB已赎回');
  await expect(lost.locator('.dc-pl')).toHaveClass(/is-down/);
  await expect(page.locator('.dc-person-side')).toHaveText(`${balance()}当前余额 HTB`);

  // One that stays open for the student's pages.
  await buy(page, 2, '平衡', 10);

  // 今日业务: 买理财 has its 冲正, 理财转回 has none.
  await page.goto('/counter/today');
  await expect(page.locator('.dc-txns > li', { hasText: '买理财 10 HTB' }).first().getByRole('button', { name: /^冲正/ })).toBeVisible();
  await expect(page.locator('.dc-txns > li', { hasText: '理财转回' }).getByRole('button', { name: /^冲正/ })).toHaveCount(0);
});

test('学生: 理财 on the home page, 我的理财 on 信用, and the 理财 entries only under 全部', async ({ page }) => {
  sql(`update public.wealth_holdings set value_centi = 1050 where student_no = '20260001' and status = 'open'`);
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-credit-summary .dc-kv > div', { hasText: '理财' })).toHaveText('理财10.50 HTB盈 +0.50 HTB');

  await page.goto('/student/credit');
  await expect(page.getByText(`周末和节假日休市，只加基础收益。${md(`'${W2}'`)} 指数 +1.25%。`)).toBeVisible();
  // All three were bought today, in no fixed order among themselves; the reversed one is not listed.
  const items = page.locator('.dc-list-item', { hasText: '理财 ' });
  await expect(items).toHaveCount(3);
  await expect(items.filter({ hasText: '平衡' })).toHaveText(`理财 2 周 · 平衡 ×2 · 本金 10 HTB，现在值 10.50 HTB盈 +0.50 HTB · ${md(`${DAY} + 14`)} 到期持有中`);
  await expect(items.filter({ hasText: '进取' })).toHaveText(`理财 2 周 · 进取 ×4 · 本金 10 HTB，拿回 6.50 HTB亏 −3.50 HTB · ${md(DAY)} 赎回已赎回`);
  await expect(items.filter({ hasText: '稳健' })).toHaveText(`理财 4 周 · 稳健 ×1 · 本金 30 HTB，拿回 31.23 HTB盈 +1.23 HTB · ${md(DAY)} 赎回已赎回`);
  await expect(page.getByRole('button', { name: /赎回/ })).toHaveCount(0);

  await page.goto('/student/txns');
  const bought = page.locator('.dc-txn', { hasText: '买理财' }).first();
  await expect(bought.locator('.dc-txn-title')).toHaveText(`买理财 · 2 周 · 平衡 ×2，${md(`${DAY} + 14`)} 到期`);
  await expect(bought.locator('.dc-txn-amount')).toHaveText('−10转理财');
  await expect(page.locator('.dc-txn', { hasText: '理财转回 · 赎回，亏 −3.50 HTB' }).locator('.dc-txn-amount small')).toHaveText('转回');
  await page.getByRole('tab', { name: '存款' }).click();
  await expect(page.locator('.dc-txn').first()).toContainText('存款');
  await expect(page.locator('.dc-txn', { hasText: '理财' })).toHaveCount(0);
});

test('后台「理财」: the figures, the rules, each day for one length, entering a waiting day, and the open holdings', async ({ page }) => {
  // The open holding has waited since W1, which has no close yet.
  sql(`update public.wealth_holdings set opened_on = '${W1}'::date - 1, starts_on = '${W1}', valued_to = '${W1}' where student_no = '20260001' and status = 'open'`);
  const name = sql(`select display_name from public.profiles where login_id = 'admin'`);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/wealth');
  await expect(page.locator('.dc-stat')).toHaveText([`${md(`'${W2}'`)} 指数涨跌+1.25%`, '持有中1笔本金 10 HTB', '当前总值10.50HTB']);
  await expect(page.locator('.dc-notice', { hasText: '还没有行情' })).toHaveText(
    `有 1 个工作日还没有行情：${md(`'${W1}'`)}。需要这些日子的理财先停在前一天，取到或登记后自动补上。`);
  const rules = page.getByRole('region', { name: '收益规则' });
  await expect(rules.locator('.dc-kv > div').first()).toHaveText('参考指数沪深 300 · sh000300');
  await expect(rules).toContainText('12 周每天 0.52%');
  await expect(rules).toContainText('平衡 ×2每天 −10%～+10%');

  const table = page.getByRole('table', { name: '每日收益 · 12 周' });
  const row = (day: string) => table.locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${md(`'${day}'`)}$`) }) });
  await expect(row(W2)).toHaveText(/\+1\.25%\+3\.02%\+5\.52%\+10\.52%腾讯行情$/);
  await expect(row(W1)).toHaveText(`${md(`'${W1}'`)}—————待登记 登记`);
  if (closedDay) await expect(table.locator('tbody tr', { hasText: '休市' }).first()).toContainText('+0.52%');
  await page.getByRole('group', { name: '期限' }).locator('label', { hasText: /^2 周$/ }).click();
  await expect(page.getByRole('table', { name: '每日收益 · 2 周' })).toBeVisible();
  await page.getByRole('group', { name: '期限' }).locator('label', { hasText: /^12 周$/ }).click();

  // 登记 from the row: the day, the change, where it came from, then a second look.
  await row(W1).getByRole('button', { name: '登记' }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText(`登记 ${md(`'${W1}'`)} 的指数涨跌`);
  await expect(sheet).toContainText('这一天休市的不用登记。请从最早的一天起按顺序登记');
  await sheet.getByRole('textbox', { name: '指数涨跌' }).fill('60');
  await expect(sheet.locator('.dc-field.is-error')).toContainText('指数涨跌要在 −50% 到 50% 之间，最多 4 位小数。');
  await expect(sheet.getByRole('button', { name: '下一步' })).toBeDisabled();
  await sheet.getByRole('textbox', { name: '指数涨跌' }).fill('−0.8');
  await sheet.locator('textarea').fill('中证指数官网收盘行情');
  await confirmIn(page, '下一步');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText(`按指数涨跌 −0.80% 登记 ${md(`'${W1}'`)}？`);
  await expect(sheet).toContainText('每笔持有中的理财按自己买入时的参数算这一天的收益，登记后不能修改。');
  await confirmIn(page, '确认登记');
  await expect(page.locator('.dc-toast')).toHaveText(`已登记 ${md(`'${W1}'`)} 的指数涨跌`);
  await expect(row(W1)).toHaveText(`${md(`'${W1}'`)}—−0.80%−1.08%−2.68%−5.88%手动登记 · ${name}`);
  await expect(page.locator('.dc-notice', { hasText: '还没有行情' })).toHaveCount(0);
  expect(sql(`select change || ' ' || source || ' ' || note from public.wealth_days where day = '${W1}'`)).toBe('-0.8000 manual 中证指数官网收盘行情');

  // A day that has its close already: the server refuses, and the sheet says why.
  await page.getByRole('button', { name: '登记指数涨跌' }).click();
  await sheet.getByRole('textbox', { name: '指数涨跌' }).fill('1');
  await sheet.locator('textarea').fill('重复登记');
  await confirmIn(page, '下一步');
  await confirmIn(page, '确认登记');
  await expect(sheet.locator('.dc-notice')).toHaveText('已经有行情这一天已经有行情，不能再登记。');
  await page.keyboard.press('Escape');

  const open = page.getByRole('table', { name: '持有中的理财' });
  await expect(open.locator('tbody tr')).toHaveText([`张小明 · 202600012 周 · 平衡 ×210 HTB10.50 HTB盈 +0.50 HTB${md(`${DAY} + 14`)}`]);

  // 流水: the two types as filters.
  await page.goto('/admin/txns');
  const types = page.getByRole('group', { name: '类型' });
  await types.getByRole('button', { name: '理财转回' }).click();
  await expect(page.locator('ul.dc-txns > li')).toHaveCount(2);
});

test('财务 reads 理财 but enters nothing; 参数「理财」 saves wealth_params', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/wealth');
  await expect(page.getByRole('region', { name: '收益规则' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登记指数涨跌' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登记' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '在参数页修改' })).toHaveCount(0);

  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings');
  const group = page.getByRole('heading', { name: '理财', exact: true }).locator('..');
  await expect(group.getByRole('textbox', { name: '指数代码' })).toHaveValue('sh000300');
  await expect(group.getByRole('textbox', { name: '理财 12 周' })).toHaveValue('3.6637');
  await group.getByRole('textbox', { name: '指数代码' }).fill('sh00030');
  await expect(group.locator('.dc-field.is-error')).toContainText('请输入 sh 或 sz 加 6 位数字，如 sh000300');
  await expect(page.getByRole('button', { name: '保存参数' })).toBeDisabled();
  await group.getByRole('textbox', { name: '指数代码' }).fill('sh000300');
  await group.getByRole('group', { name: '档位 2' }).getByRole('textbox', { name: '每天最多亏' }).fill('12');
  await page.getByRole('button', { name: '保存参数' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('参数已保存');
  expect(sql(`select value -> 'tiers' -> 1 ->> 'min' from public.settings where key = 'wealth_params'`)).toBe('-12');
});
