import { expect, test, type Page } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 理财 (PHASE-2.md §10.10, design system Invest) on the seed data (supabase/seed.sql): 张小明 (20260001) has 108 HTB and no
// loan; wealth_params is the default. The snapshot starts each product at net value 1 yesterday with no days. Here
// 国债, 黄金, 沪深 300 and 创业板指 get today's net value; 恒生指数 stays at yesterday's; 纳斯达克 100 starts on the day
// before W, the latest weekday at least two days ago, whose close is then past its time to be entered (waiting, and
// 待登记 on the back office). 国债 has a close on LW, the last weekday before today. The tests run in order: teller01
// buys, reverses, sells, and keeps one open on a frozen account; the bank admin enters W and edits the parameters.
test.describe.configure({ mode: 'serial' });
const DAY = 'app_private.cn_date(now())';
let TODAY = '', W = '', LW = '';
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() % 6 !== 0;
test.beforeAll(() => {
  resetData();
  TODAY = sql(`select ${DAY}`);
  W = shift(TODAY, -2);
  while (!weekday(W)) W = shift(W, -1);
  LW = shift(TODAY, -1);
  while (!weekday(LW)) LW = shift(LW, -1);
  sql(`insert into public.wealth_navs (product, day, change, rate, nav) values
    ('bond', '${TODAY}', 0, 0.3184, 1.003184), ('gold', '${TODAY}', 5.65, 5.65, 1.0565),
    ('csi300', '${TODAY}', -0.31, -0.62, 0.9938), ('chinext', '${TODAY}', -1.15, -1.15, 0.9885)`);
  // 纳斯达克 100 starts earlier: the start row is replaced, so replica mode lets the append-only trigger pass.
  sql(`set session_replication_role = replica; delete from public.wealth_navs where product = 'ndx';
    insert into public.wealth_navs (product, day, nav) values ('ndx', '${shift(W, -1)}', 1)`);
  sql(`insert into public.wealth_days (product, day, close, prev_close, change, source, params) values ('bond', '${LW}', 220.12, 219.9, 0.1, 'tencent', '{}')`);
});

const md = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
const pick = (page: Page, name: string) => page.locator('.dc-seg label', { hasText: name }).click();
const receipt = (page: Page) => page.locator('aside[aria-label="办理单"]');
const products = (page: Page) => page.getByRole('radiogroup', { name: '品种' }).locator('.dc-choice');
const balance = () => sql(`select balance from public.accounts where student_no = '20260001'`);
const carry = () => Number(sql(`select interest_carry from public.accounts where student_no = '20260001'`));

async function serve(page: Page) {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await find(page);
}
// The counter keeps a quote while the visit lasts; a value changed here is read again on a new visit after a reload.
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
async function buy(page: Page, name: string, amount: number) {
  await products(page).filter({ hasText: name }).click();
  await page.getByPlaceholder('请输入金额').fill(String(amount));
  await page.getByRole('button', { name: '买入理财', exact: true }).click();
  await confirmIn(page, '确认买入');
  await expect(page.locator('.dc-sheet')).toHaveCount(0);
}
// A holding of 张小明's bought `days` days earlier.
const backdate = (product: string, days: number) =>
  sql(`update public.wealth_holdings set opened_on = ${DAY} - ${days}, starts_on = ${DAY} - ${days} + 1
    where student_no = '20260001' and product = '${product}' and status = 'open'`);

test('柜台「理财」: six products, 买入 with its 冲正, 卖出 refused on the day bought and done the next, and a frozen account', async ({ page }) => {
  await serve(page);
  await expect(page.locator('.dc-notice', { hasText: '理财可能亏损' })).toContainText('每个品种跟着一种行情每天涨跌，卖出时拿回的钱可能少于本金。买入第二天起可以卖出。');
  await expect(products(page)).toHaveCount(6);
  await expect(products(page).nth(0)).toHaveText('国债净值 1.0032今天 +0.32%');
  await expect(products(page).nth(1)).toHaveText('黄金净值 1.0565今天 +5.65%');
  await expect(products(page).nth(1).locator('.dc-pl')).toHaveClass(/is-up/);
  await expect(products(page).nth(2).locator('.dc-pl')).toHaveClass(/is-down/);
  await expect(products(page).nth(4)).toContainText('恒生指数净值 1.0000');
  await expect(products(page).nth(5)).toHaveText('纳斯达克 100净值 1.0000行情待登记');
  await expect(page.getByText('还没有理财。')).toBeVisible();
  await expect(page.getByRole('button', { name: '先选品种' })).toBeDisabled();

  const hint = page.locator('.dc-field-hint');
  const amount = page.getByPlaceholder('请输入金额');
  await expect(hint).toHaveText('1 HTB 起，最多 108 HTB（活期余额）');
  await amount.fill('200');
  await expect(hint).toHaveText('余额不足：活期余额 108 HTB，还差 92 HTB');
  await amount.fill('100');
  await products(page).filter({ hasText: '黄金' }).click();
  await expect(page.getByText('按黄金当前净值 1.0565 买入 100 HTB。净值涨 1%，这笔理财也涨 1%；明天起可以卖出。')).toBeVisible();
  await expect(receipt(page)).toContainText('买理财（正在办理）黄金，净值 1.0565−100');
  await expect(page.locator('.dc-actions-total')).toHaveText('买入理财办理后余额 8 HTB100HTB');

  await page.getByRole('button', { name: '买入理财', exact: true }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('给张小明买黄金 100 HTB？');
  await expect(sheet.locator('.dc-kv > div')).toHaveText(['品种黄金', '买入净值1.0565（今天）', '可以卖出明天起', '期限没有期限，卖出前一直随净值涨跌', '活期余额108 → 8 HTB']);
  await expect(sheet.locator('.dc-caption.is-danger')).toHaveText('理财可能亏损，卖出时拿回的钱可能少于 100 HTB，最多亏光本金。');
  await confirmIn(page, '确认买入');
  await expect(page.locator('.dc-toast')).toHaveText('已买入黄金 100 HTB，净值 1.0565');
  await expect(receipt(page)).toContainText('买理财黄金，净值 1.0565 · HT');
  await expect(page.locator('.dc-person-side')).toHaveText('8当前余额 HTB');
  await expect(page.locator('.dc-list-item')).toHaveText(['黄金 · 本金 100 HTB，现在值 100.00 HTB持平 · 今天 按净值 1.0565 买入明天可卖']);
  await expect(page.getByRole('button', { name: /^卖出/ })).toHaveCount(0);
  expect(sql(`select reason from public.txns where type = 'wealth_buy' and student_no = '20260001'`)).toBe('黄金，净值 1.0565');

  // A 买理财 entered wrong is reversed from the 办理单: the holding is gone and 活期 is back.
  await receipt(page).getByRole('button', { name: '冲正买理财' }).click();
  await page.locator('.dc-sheet .dc-check', { hasText: '金额录错' }).click();
  await confirmIn(page, '确认冲正');
  await expect(receipt(page)).toContainText('买理财（已冲正）');
  await expect(page.locator('.dc-person-side')).toHaveText('108当前余额 HTB');
  await expect(page.getByText('还没有理财。')).toBeVisible();

  // 卖出 on the day bought: the counter offers it only from the next day, so the holding is dated back to show 卖出 and
  // brought to today again before the confirmation: the server refuses with WEALTH_LOCKED, said in the sheet.
  await buy(page, '黄金', 30);
  backdate('gold', 1);
  await reopen(page);
  await page.getByRole('button', { name: '卖出黄金 30 HTB' }).click();
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('卖出这笔黄金？');
  await expect(sheet).toContainText('按当前净值 1.0565，现值 30.00 HTB 转回活期，持平。卖出后不再随净值涨跌。');
  backdate('gold', 0);
  await confirmIn(page, '卖出');
  await expect(sheet.locator('.dc-notice')).toHaveText('还不能卖出这笔理财明天起可以卖出。');
  await page.keyboard.press('Escape');

  // The next day it sells at the latest net value: bought at 1.0234, worth 30 × 1.0565 ÷ 1.0234.
  sql(`update public.wealth_holdings set opened_on = ${DAY} - 1, starts_on = ${DAY}, buy_nav = 1.0234, value_centi = round(3000 * 1.0565 / 1.0234)
    where student_no = '20260001' and status = 'open'`);
  const value = Number(sql(`select round(3000 * 1.0565 / 1.0234)`));
  const gained = `盈 +${((value - 3000) / 100).toFixed(2)} HTB`;
  await reopen(page);
  await expect(page.locator('.dc-list-item')).toHaveText([`黄金 · 本金 30 HTB，现在值 ${(value / 100).toFixed(2)} HTB${gained} · 今天 按净值 1.0234 买入卖出`]);
  await page.getByRole('button', { name: '卖出黄金 30 HTB' }).click();
  await expect(sheet).toContainText(`按当前净值 1.0565，现值 ${(value / 100).toFixed(2)} HTB 转回活期，${gained}。卖出后不再随净值涨跌。`);
  const back = Math.floor((carry() + value) / 100);
  await confirmIn(page, '卖出');
  await expect(page.locator('.dc-toast')).toHaveText(`已卖出，转回活期 ${back} HTB`);
  await expect(receipt(page)).toContainText(`理财转回黄金，${gained} · HT`);
  await expect(receipt(page).getByRole('button', { name: '冲正理财转回' })).toHaveCount(0);
  await expect(page.locator('.dc-list-item')).toHaveText([`黄金 · 本金 30 HTB，拿回 ${(value / 100).toFixed(2)} HTB${gained} · ${md(TODAY)} 卖出已卖出`]);
  await expect(page.locator('.dc-list-item .dc-pl')).toHaveClass(/is-up/);
  await expect(page.locator('.dc-person-side')).toHaveText(`${balance()}当前余额 HTB`);
  expect(sql(`select reason from public.txns where type = 'wealth_close' and student_no = '20260001'`)).toBe(`卖出黄金，${gained}`);

  // A frozen account keeps its 理财 but cannot sell it: the button says why; nothing can be bought.
  await buy(page, '沪深 300', 10);
  backdate('csi300', 1);
  sql(`update public.students set status = 'frozen' where student_no = '20260001'`);
  await reopen(page);
  await expect(page.getByText('账户已冻结，理财照常涨跌，解冻后才能卖出。')).toBeVisible();
  await expect(page.locator('.dc-list-item', { hasText: '沪深 300' }).getByRole('button')).toHaveText('账户冻结');
  await expect(page.locator('.dc-list-item', { hasText: '沪深 300' }).getByRole('button')).toBeDisabled();
  await expect(products(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '买入理财', exact: true })).toHaveCount(0);
  sql(`update public.students set status = 'normal' where student_no = '20260001'`);

  // 今日业务: 买理财 has its 冲正, 理财转回 none.
  await page.goto('/counter/today');
  await expect(page.locator('.dc-txns > li', { hasText: '买理财 10 HTB' }).getByRole('button', { name: /^冲正/ })).toBeVisible();
  await expect(page.locator('.dc-txns > li', { hasText: '理财转回' }).getByRole('button', { name: /^冲正/ })).toHaveCount(0);
});

test('学生: 理财 on the home page, and 我的理财 on 信用 one by one, with 明天可卖 on the one bought today', async ({ page }) => {
  // Left by the counter: 沪深 300 10 HTB open since yesterday and 黄金 30 HTB sold today. 纳斯达克 100 5 HTB is bought today.
  sql(`select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where login_id = 'teller01'), 'role', 'authenticated')::text, false);
       select public.buy_wealth(gen_random_uuid(), '20260001', 'ndx', 5);
       update public.wealth_holdings set value_centi = 1050 where student_no = '20260001' and product = 'csi300'`);
  const sold = sql(`select to_char(value_centi / 100.0, 'FM990.00') from public.wealth_holdings where student_no = '20260001' and product = 'gold' and status = 'redeemed'`);
  await signIn(page, '学生', '20260001');
  await expect(page).toHaveURL(/\/student$/);
  await expect(page.locator('.dc-credit-summary .dc-kv > div', { hasText: '理财' })).toHaveText('理财15.50 HTB盈 +0.50 HTB');

  await page.goto('/student/credit');
  await expect(page.getByText('理财有六个品种，每个跟着一种行情每天涨跌：涨了多得，跌了会少拿。买入第二天起可以到柜台卖出。')).toBeVisible();
  const mine = page.locator('.dc-stack', { has: page.getByText('理财有六个品种') }).last();
  await expect(mine.locator('.dc-kv > div')).toHaveText(['现在值合计15.50 HTB', '盈亏合计盈 +0.50 HTB']);
  await expect(mine.locator('.dc-list-item')).toHaveText([
    '纳斯达克 100 · 本金 5 HTB，现在值 5.00 HTB持平 · 今天 买入明天可卖',
    '沪深 300 · 本金 10 HTB，现在值 10.50 HTB盈 +0.50 HTB · 今天 买入持有中',
    `黄金 · 本金 30 HTB，拿回 ${sold} HTB盈 +${(Number(sold) - 30).toFixed(2)} HTB · ${md(TODAY)} 卖出已卖出`,
  ]);
  await expect(mine.getByRole('button')).toHaveCount(0);
  await expect(mine.locator('.dc-list-item', { hasText: '纳斯达克' }).locator('.dc-tag')).toHaveText('明天可卖');

  // 明细: the two types under 全部 only, titled from what the server wrote.
  await page.goto('/student/txns');
  await expect(page.locator('.dc-txn', { hasText: '买理财 · 纳斯达克 100，净值 1.0000' }).locator('.dc-txn-amount')).toHaveText('−5转理财');
  await expect(page.locator('.dc-txn', { hasText: '理财转回 · 卖出黄金，盈' }).locator('.dc-txn-amount small')).toHaveText('转回');
});

test('后台「理财」: the days to enter, the products, each day of one product, entering a day, and the open holdings', async ({ page }) => {
  // The president reads it all: a waiting day is 待登记 without 登记, and there is no 登记行情.
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/wealth');
  await expect(page.getByRole('table', { name: '每日行情 · 纳斯达克 100' }).locator('.dc-tag-pending', { hasText: '待登记' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '登记', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登记行情' })).toHaveCount(0);

  const name = sql(`select display_name from public.profiles where login_id = 'admin'`);
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/wealth');
  await expect(page.locator('.dc-notice', { hasText: '还没有取到' })).toHaveText(
    `有 1 天的行情还没有取到：纳斯达克 100 ${md(W)}。这些品种的净值先停在前一天，取到或登记后自动补上。`);
  const table = page.getByRole('table', { name: '理财品种' });
  await expect(table.locator('tbody tr')).toHaveCount(6);
  await expect(table.locator('tbody tr').nth(1)).toHaveText('黄金1.056500今天+5.65%000.00');
  await expect(table.locator('tbody tr').nth(2)).toHaveText('沪深 3000.993800今天−0.62%11010.50');
  await expect(table.locator('tbody tr').nth(5)).toHaveText(`纳斯达克 1001.000000${md(shift(W, -1))} 待登记—155.00`);
  await expect(table.locator('tfoot tr')).toHaveText('合计21515.50');

  // 每日行情 opens on the first product with a day to enter.
  await expect(page.getByRole('tab', { name: '纳斯达克 100' })).toHaveAttribute('aria-selected', 'true');
  const days = page.getByRole('table', { name: '每日行情 · 纳斯达克 100' });
  const row = (day: string) => days.locator('tbody tr').filter({ has: page.locator('td:first-child', { hasText: new RegExp(`^${md(day)}$`) }) });
  await expect(row(W)).toHaveText(`${md(W)}————待登记 登记`);
  await page.getByRole('tab', { name: '国债' }).click();
  const close = page.getByRole('table', { name: '每日行情 · 国债' }).locator('tbody tr', { hasText: '腾讯行情' });
  await expect(close).toContainText(`${md(LW)}220.12+0.10%`);
  await page.getByRole('tab', { name: '纳斯达克 100' }).click();

  // 登记 from the row: the product, the day, the change and where it came from, then a second look.
  await row(W).getByRole('button', { name: '登记' }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText(`登记纳斯达克 100 ${md(W)} 的行情`);
  await expect(sheet.getByRole('combobox', { name: '品种' })).toHaveValue('ndx');
  await expect(sheet).toContainText('这一天休市的不用登记。请从最早的一天起按顺序登记');
  await sheet.getByRole('textbox', { name: '行情涨跌' }).fill('60');
  await expect(sheet.locator('.dc-field.is-error')).toContainText('行情涨跌要在 −50% 到 50% 之间，最多 4 位小数。');
  await expect(sheet.getByRole('button', { name: '下一步' })).toBeDisabled();
  await sheet.getByRole('textbox', { name: '行情涨跌' }).fill('−0.8');
  await sheet.locator('textarea').fill('纳斯达克官网收盘行情');
  await confirmIn(page, '下一步');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText(`按涨跌 −0.80% 登记纳斯达克 100 ${md(W)}？`);
  await expect(sheet).toContainText('纳斯达克 100的净值从这一天起按顺序补上，持有它的理财随之变动。登记后不能修改。');
  await confirmIn(page, '确认登记');
  await expect(page.locator('.dc-toast')).toHaveText(`已登记纳斯达克 100 ${md(W)} 的行情`);
  await expect(row(W)).toContainText(`−0.80%`);
  await expect(row(W)).toContainText(`手动登记 · ${name}`);
  await expect(page.locator('.dc-notice', { hasText: '还没有取到' })).toHaveCount(0);
  expect(sql(`select change || ' ' || source || ' ' || note from public.wealth_days where product = 'ndx' and day = '${W}'`)).toBe('-0.8000 manual 纳斯达克官网收盘行情');

  // A day that has its close already: the server refuses, and the sheet says why.
  await page.getByRole('button', { name: '登记行情' }).click();
  await sheet.getByRole('combobox', { name: '品种' }).selectOption('bond');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText(`登记国债 ${md(LW)} 的行情`);
  await sheet.getByRole('textbox', { name: '行情涨跌' }).fill('1');
  await sheet.locator('textarea').fill('重复登记');
  await confirmIn(page, '下一步');
  await confirmIn(page, '确认登记');
  await expect(sheet.locator('.dc-notice')).toHaveText('已经有行情这一天已经有行情，不能再登记。');
  await page.keyboard.press('Escape');

  const open = page.getByRole('table', { name: '持有中的理财' });
  await expect(open.locator('tbody tr')).toHaveText([
    // 纳斯达克 100 moves with the day just entered.
    new RegExp(`^张小明 · 20260001纳斯达克 1005 HTB1\\.0000\\d\\.\\d\\d HTB.+${md(TODAY)}$`),
    `张小明 · 20260001沪深 30010 HTB0.993810.50 HTB盈 +0.50 HTB${md(shift(TODAY, -1))}`,
  ]);

  // 流水: the two types as filters.
  await page.goto('/admin/txns');
  const types = page.getByRole('group', { name: '类型' });
  await types.getByRole('button', { name: '理财转回' }).click();
  await expect(page.locator('ul.dc-txns > li')).toHaveCount(1);
});

test('财务 reads 理财 but enters nothing; 参数「理财」 saves each product’s multiplier and premium', async ({ page }) => {
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/wealth');
  await expect(page.getByRole('table', { name: '理财品种' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登记行情' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登记', exact: true })).toHaveCount(0);

  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings');
  const anchor = Number(sql(`select app_private.anchor_on(${DAY})`));
  const table = page.getByRole('table', { name: '理财参数' });
  await expect(table.locator('tbody th')).toHaveText(['国债', '黄金', '沪深 300', '创业板指', '恒生指数', '纳斯达克 100']);
  const gold = table.locator('tbody tr', { hasText: '黄金' });
  await expect(gold.getByRole('textbox', { name: '黄金倍率' })).toHaveValue('1');
  await expect(gold.getByRole('textbox', { name: '黄金基准加成' })).toHaveValue('1.75');
  await expect(gold.locator('td').last()).toHaveText(`${(anchor + 1.75).toFixed(2)}%`);
  await gold.getByRole('textbox', { name: '黄金倍率' }).fill('25');
  await expect(gold.locator('.dc-field.is-error .dc-field-hint')).toHaveText('倍率在 0.1～20 之间，最多 4 位小数。');
  await expect(page.getByRole('button', { name: '保存参数' })).toBeDisabled();
  await gold.getByRole('textbox', { name: '黄金倍率' }).fill('2.5');
  await gold.getByRole('textbox', { name: '黄金基准加成' }).fill('−1');
  await expect(gold.locator('td').last()).toHaveText(`${(anchor - 1).toFixed(2)}%`);
  await page.getByRole('button', { name: '保存参数' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('参数已保存');
  expect(sql(`select (value -> 'products' -> 1) - 'symbol' from public.settings where key = 'wealth_params'`))
    .toBe('{"key": "gold", "name": "黄金", "premium": -1, "multiplier": 2.5}');
  expect(sql(`select value ->> 'cap' from public.settings where key = 'wealth_params'`)).toBe('20');

  // On a phone each product is a card, this week's base under its premium.
  await page.setViewportSize({ width: 390, height: 844 });
  const card = page.getByRole('group', { name: '黄金的参数' });
  await expect(card.getByRole('textbox', { name: '黄金倍率' })).toHaveValue('2.5');
  await expect(card.locator('.dc-field-hint')).toHaveText(`本周 ${(anchor - 1).toFixed(2)}%`);
});
