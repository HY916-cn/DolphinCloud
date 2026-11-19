import { expect, test } from '@playwright/test';
import { confirmIn, resetData, signIn, sql } from './helpers';

// 货币 and the 经营看板 (PHASE-2.md §11, §16.2) on the seed data: the bank admin records the 期初现金 (1 元 × 100, 5 元 × 20)
// and an issue FX-1 (10 元 × 30), so the bank should hold 500 HTB, and the seeded business, all before them, counts in
// nothing; the overview's six figures are checked against the database; a second 期初现金 is not offered, and a 更正
// that takes more 5 元 notes than the 期初现金 had is refused. The president reads both pages and records nothing.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const n = (v: number | string) => Number(v).toLocaleString('en-US');
const day = () => sql(`select to_char(app_private.cn_date(now()), 'FMMM月FMDD日')`);

test('银行管理员: 期初现金 and an issue on 货币, the 经营看板 on 总览, no second 期初现金, a 更正 below 0 refused', async ({ page }) => {
  const today = day();
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '货币', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/currency$/);
  await expect(page.locator('.dc-notice', { hasText: '先登记银行期初现金' }))
    .toContainText('登记金库和各储蓄盒现有的各面额张数，从登记那一刻起计算银行应有现金。现在按全部流水计算。');
  await expect(page.getByRole('list', { name: '登记记录' })).toHaveCount(0);
  await expect(page.locator('.dc-empty')).toHaveText('还没有登记');

  // 期初现金, offered first and chosen while there is none.
  await page.getByRole('link', { name: '登记', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/currency\/new$/);
  await expect(page.locator('.dc-choice b')).toHaveText(['期初现金', '发行', '回收', '销毁', '更正']);
  await expect(page.getByRole('radio', { name: /期初现金/ })).toBeChecked();
  const submit = page.locator('.dc-actions').getByRole('button', { name: '登记' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('1 元张数').fill('100');
  await page.getByLabel('5 元张数').fill('20');
  await expect(page.locator('.dc-kv .is-total')).toHaveText('期初现金合计200HTB');
  await submit.click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('登记期初现金 200 HTB？');
  await expect(sheet.locator('.dc-kv dd')).toHaveText([today, '1 元 × 100、5 元 × 20']);
  await confirmIn(page, '确认登记');
  await expect(page).toHaveURL(/\/admin\/currency$/);
  await expect(page.locator('.dc-toast')).toHaveText('已登记');
  await expect(page.locator('.dc-notice', { hasText: '先登记银行期初现金' })).toHaveCount(0);

  // 发行, the default once the 期初现金 is in; no second 期初现金.
  await page.getByRole('link', { name: '登记', exact: true }).click();
  await expect(page.locator('.dc-choice b')).toHaveText(['发行', '回收', '销毁', '更正']);
  await expect(page.getByRole('radio', { name: /发行/ })).toBeChecked();
  await page.getByLabel('批次号').fill('FX-1');
  await page.getByLabel('10 元张数').fill('30');
  await page.getByLabel('用途').fill('开学发行');
  await page.getByLabel('审批人').fill('王老师');
  await expect(page.locator('.dc-actions-total')).toHaveText('发行300HTB');
  await submit.click();
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('登记发行 FX-1，300 HTB？');
  await expect(sheet.locator('.dc-kv dd')).toHaveText([today, '10 元 × 30', 'FX-1', '开学发行', '王老师']);
  await confirmIn(page, '确认登记');
  await expect(page).toHaveURL(/\/admin\/currency$/);

  // 货币: what the bank should hold, against the balances.
  const [total, exact] = sql(`select sum(balance + term_total + wealth_total), round(100.0 * 500 / sum(balance + term_total + wealth_total), 1)
    from public.accounts`).split('|');
  const ratio = Number(exact).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const low = Number(exact) < 30;
  await expect(page.locator('.dc-stat')).toHaveText([
    `兑付能力${ratio}%${low ? '低于提示线 30%' : '提示线 30%'}`, '银行应有现金500HTB', `账户余额合计${n(total)}HTB`]);
  await expect(page.locator('.dc-notice', { hasText: '兑付能力' })).toHaveCount(low ? 1 : 0);
  const paper = page.getByRole('region', { name: '纸币' });
  await expect(paper.locator('.dc-kv > div')).toHaveText(['期初现金200 HTB', '发行300 HTB', '回收0 HTB', '销毁0 HTB', '流水的现金变动0 HTB',
    '银行应有现金500HTB', '流到学生手中0 HTB']);
  await expect(paper.getByRole('table').locator('tbody tr', { hasText: '10 元' }).locator('td'))
    .toHaveText(['10 元', '0', '30', '0', '0', '0', '30', /.+/, '0']);
  await expect(paper.getByRole('table').locator('tfoot td')).toHaveText(['合计（HTB）', '200', '300', '0', '0', '0', '500', /.+/, '0']);
  const records = page.getByRole('list', { name: '登记记录' }).locator('.dc-list-item');
  await expect(records).toHaveCount(2);
  await expect(records.first()).toContainText('发行 FX-1 · 300 HTB');
  await expect(records.first()).toContainText(`${today} · 10 元 × 30`);
  await expect(records.first()).toContainText('开学发行 · 审批 王老师 · 银行管理员');
  await expect(records.first()).toHaveClass(/is-new/);
  await expect(records.nth(1)).toContainText(`期初现金 · 200 HTB${today} · 1 元 × 100、5 元 × 20`);

  // 总览: the six figures, each against the database.
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '总览', exact: true }).click();
  const [loans, remaining, overdue, overdueLeft] = sql(`select count(*), coalesce(sum(remaining), 0), count(*) filter (where status = 'overdue'),
    coalesce(sum(remaining) filter (where status = 'overdue'), 0) from public.loans where status in ('active', 'overdue')`).split('|').map(Number);
  const [qty, cost, uncosted] = sql(`select coalesce(sum(stock), 0), coalesce(sum(stock * cost), 0), count(*) filter (where cost is null and stock > 0)
    from public.products`).split('|').map(Number);
  const [week, last] = sql(`select count(*) filter (where w = m), count(*) filter (where w = m - 7) from (
    select date_trunc('week', app_private.cn_date(t.created_at))::date as w, date_trunc('week', app_private.cn_date(now()))::date as m
    from public.txns t where app_private.is_business(t)) x`).split('|').map(Number);
  const [anchor, published] = sql(`select app_private.anchor_on(app_private.cn_date(now())),
    (select to_char(max(week_start), 'FMMM月FMDD日') from public.rate_weeks where week_start <= app_private.cn_date(now()))`).split('|');
  const change = week === last ? '和上周持平' : !last ? '上周 0 笔' : `比上周 ${week > last ? '+' : '−'}${Math.abs(Math.round(((week - last) / last) * 100))}%`;
  await expect(page.locator('.dc-stat')).toHaveText([
    `账户余额${n(total)}HTB含定期、理财本金`,
    `银行应有现金500HTB兑付能力 ${ratio}%${low ? '，低于 30%' : ''}`,
    `贷款余额${n(remaining)}HTB${overdue ? `逾期 ${overdue} 笔 · ${n(overdueLeft)} HTB` : loans ? `${loans} 笔未结清` : ''}`,
    `文创库存${n(qty)}件成本 ${n(cost)} HTB${uncosted ? ` · ${uncosted} 种没填成本` : ''}`,
    `本周业务${n(week)}笔${change}`,
    `本周锚点${Number(Number(anchor).toFixed(4))}%${published ? `${published}公布` : '还没有公布，按初始锚点'}`,
  ]);
  const cash = page.getByRole('link', { name: /银行应有现金/ });
  await expect(cash).toHaveAttribute('href', '/admin/currency');
  await expect(cash).toHaveClass(low ? /is-danger/ : /^(?!.*is-danger)/);
  await expect(page.getByRole('img', { name: /^每周业务笔数：/ })).toHaveAttribute('aria-label', new RegExp(`起 · ${week} 笔$`));
  await expect(page.locator('.dc-chart-axis span').filter({ hasText: /\d/ })).toHaveCount(6);
  await page.getByRole('button', { name: '各周数字' }).click();
  const weeks = page.getByRole('dialog', { name: '每周业务笔数' });
  await expect(weeks.locator('tbody tr')).toHaveCount(12);
  await expect(weeks.locator('tbody tr').first().locator('td').nth(1)).toHaveText(n(week));
  await confirmIn(page, '关闭');
  await expect(weeks).toHaveCount(0);
  // The sections below it keep their place: 今日业务 still there.
  await expect(page.getByRole('region', { name: '今日业务' })).toBeVisible();

  // A 更正 of the 期初现金 that takes 21 of its 20 notes of 5 元.
  await cash.click();
  await expect(page).toHaveURL(/\/admin\/currency$/);
  await page.getByRole('link', { name: '登记', exact: true }).click();
  await page.locator('.dc-choice', { hasText: '更正' }).click();
  await expect(page.locator('.dc-card .dc-caption').first()).toHaveText('多登的面额写负数，少登的写正数，合计可以为 0。记在今天。');
  await expect(page.getByLabel('对应的登记').locator('option')).toHaveText(['请选择', '发行 FX-1 · ' + today + ' · 300 HTB', '期初现金 · ' + today + ' · 200 HTB']);
  await page.getByLabel('对应的登记').selectOption({ index: 2 });
  await page.getByLabel('5 元张数').fill('-20');
  await page.getByRole('button', { name: '减少一张 5 元' }).click();
  await expect(page.getByLabel('5 元张数')).toHaveValue('−21');
  await expect(page.locator('.dc-qty', { hasText: '5元' }).locator('.dc-qty-sum')).toHaveText('小计−105');
  await page.getByLabel('原因').fill('5 元多登了');
  await submit.click();
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('登记更正 −105 HTB？');
  await expect(sheet.locator('.dc-kv dd')).toHaveText([today, '5 元 −21', '5 元多登了', '期初现金']);
  await confirmIn(page, '确认登记');
  await expect(page.locator('.dc-notice-danger')).toHaveText('更正后 5 元会少于 0 张这笔登记加上它的全部更正，每种面额都不能少于 0 张。');
  await expect(page.getByLabel('5 元张数')).toHaveValue('−21'); // the form keeps what was entered
  expect(sql(`select count(*) from public.currency_moves`)).toBe('2');
});

test('行长 reads 货币 without 登记, and the form’s address goes back to 货币', async ({ page }) => {
  await signIn(page, '工作人员', 'president01');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator('.dc-stat')).toHaveCount(6);
  await page.goto('/admin/currency');
  await expect(page.locator('.dc-stat').nth(1)).toHaveText('银行应有现金500HTB');
  await expect(page.getByRole('list', { name: '登记记录' }).locator('.dc-list-item')).toHaveCount(2);
  await expect(page.getByRole('link', { name: '登记', exact: true })).toHaveCount(0);
  await page.goto('/admin/currency/new');
  await expect(page).toHaveURL(/\/admin\/currency$/);
  await expect(page.locator('.dc-top-title')).toContainText('货币');
});
