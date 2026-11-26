import { expect, test, type Page } from '@playwright/test';
import { confirmIn, endDuty, resetData, signIn, sql, startDuty } from './helpers';

// 备用金 and 轧账 (PHASE-2.md §4, §7) on the seed data, in order: teller01 ends the seeded duty, begins again from
// the count set below with one more 10 元 note, serves 张小明 and 李思远 in cash, reverses the withdrawal, and counts a box
// that does not balance at 下班; the next duty starts from that count and balances. The accountant then reviews both,
// the president ends an open duty (强制下班) and the accountant counts that box; the bank admin reviews the rest, and
// the president reviews one more duty and one more 强制下班.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);
test.use({ serviceWorkers: 'block' }); // page.route sees the app's own requests only

const teller = `(select id from public.profiles where login_id = 'teller01')`;
const search = (page: Page) => page.getByRole('searchbox', { name: '搜索学生' });
const receipt = (page: Page) => page.locator('aside[aria-label="办理单"]');
async function findStudent(page: Page, query: string, name: string) {
  await search(page).fill(query);
  await page.locator('.dc-list-link', { hasText: name }).click();
  await expect(page.locator('.dc-person-name')).toHaveText(name);
}

test('上班 records the 备用金, by default the last count, and 下班 counts the box by face value', async ({ page }) => {
  test.skip(!process.env.E2E_CONTAINER, 'needs the test container');
  await signIn(page, '工作人员', 'teller01');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await endDuty(page, true);
  // 上班 starts from the last count (default_float): the accountant's when there is one, else the teller's.
  sql(`update public.cash_counts set teller_count = '{"1":20,"2":1,"5":4,"10":2}', review_count = null
    where duty_id = (select id from public.duty where user_id = ${teller} order by started_at desc limit 1)`);

  await page.locator('.dc-nav-item', { hasText: '办理' }).click();
  await page.getByRole('button', { name: '上班', exact: true }).click();
  const card = page.locator('.dc-card', { hasText: '登记备用金' });
  for (const [face, n] of [[1, 20], [2, 1], [5, 4], [10, 2]]) await expect(card.getByLabel(`${face} 元张数`)).toHaveValue(String(n));
  await expect(card.locator('.is-total dd')).toHaveText('62HTB');
  await card.getByLabel('增加一张 10 元').click();
  await expect(card.locator('.is-total dd')).toHaveText('72HTB');

  // A 备用金 the server refuses keeps the card open.
  await page.route('**/rest/v1/rpc/start_duty', (route) => route.continue({ postData: JSON.stringify({ p_float: { 1: -1 } }) }), { times: 1 });
  await page.getByRole('button', { name: '确认上班' }).click();
  await expect(page.locator('.dc-notice-danger')).toContainText('备用金张数有误');
  await expect(page.locator('.dc-notice-danger')).toContainText('每种面额填 0 或正整数。');
  await expect(card.getByLabel('10 元张数')).toHaveValue('3');
  await page.getByRole('button', { name: '确认上班' }).click();
  await expect(search(page)).toBeVisible();
  expect(sql(`select c.float from public.cash_counts c join public.duty d on d.id = c.duty_id where d.user_id = ${teller} and d.ended_at is null`))
    .toBe('{"1": 20, "2": 1, "5": 4, "10": 3}');

  // In: 17 deposited (10 + 5 + 1 + 1) and 10 for a 6 HTB pen; out: its change, 2 元 × 2. The withdrawal is reversed.
  await findStudent(page, 'zxm', '张小明');
  await page.getByLabel('增加一张 10 元').click();
  await page.getByLabel('增加一张 5 元').click();
  await page.getByLabel('增加一张 1 元').click();
  await page.getByLabel('增加一张 1 元').click();
  await page.getByRole('button', { name: '确认存款 17 HTB' }).click();
  await receipt(page).getByRole('button', { name: '结束办理 1 笔' }).click();

  await findStudent(page, 'lsy', '李思远');
  await page.locator('.dc-seg label', { hasText: '取款' }).click();
  await page.getByPlaceholder('请输入金额').fill('13');
  await page.getByRole('button', { name: '确认取款 13 HTB' }).click();
  await confirmIn(page, '确认取款');
  await expect(receipt(page)).toContainText('取款');
  await page.locator('.dc-seg label', { hasText: '兑换' }).click();
  await page.locator('.dc-tile', { hasText: '海浪中性笔' }).click();
  await page.locator('.dc-choice', { hasText: '现金支付' }).click();
  await page.getByLabel('增加一张 10 元').click();
  await page.getByRole('button', { name: '确认兑换 6 HTB' }).click();
  await confirmIn(page, '确认兑换');
  await expect(receipt(page)).toContainText('找零 4 HTB（2 元 × 2 张）');
  await receipt(page).getByRole('button', { name: '冲正取款' }).click();
  await page.locator('.dc-sheet .dc-check', { hasText: '金额录错' }).click();
  await confirmIn(page, '确认冲正');
  await expect(receipt(page)).toContainText('取款（已冲正）');
  await receipt(page).getByRole('button', { name: /^结束办理/ }).click();

  // 下班: what came in and went out by face value, and the box short of one 2 元 note (应有 少 1 张).
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  const cash = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/duty_cash'));
  await page.getByRole('button', { name: '下班' }).click();
  const part = (counts: number[], total: number) => ({
    counts: { 1: counts[0], 2: counts[1], 5: counts[2], 10: counts[3] },
    amounts: { 1: counts[0], 2: counts[1] * 2, 5: counts[2] * 5, 10: counts[3] * 10 },
    total,
  });
  const answer = await (await cash).json();
  expect(answer).toMatchObject({
    denominations: [1, 2, 5, 10],
    float: part([20, 1, 4, 3], 72),
    income: part([2, 0, 1, 2], 27),
    payout: part([0, 2, 0, 0], 4),
    expected: part([22, -1, 5, 5], 95),
  });
  expect(answer.cash_txns.map((t: { type: string }) => t.type)).toEqual(['deposit', 'purchase']); // the withdrawal is reversed within the duty

  const box = page.locator('section[aria-label="点储蓄盒"]');
  const qty = (face: number) => box.locator('.dc-qty', { hasText: `${face}元` });
  await expect(box.locator('.dc-qty-sum')).toHaveText(['应有22', '应有少 1 张', '应有5', '应有5']);
  await expect(qty(2).locator('.dc-qty-sum b.is-danger')).toBeVisible();
  await expect(box.locator('.dc-kv > div').first()).toHaveText('应有合计95 HTB');
  for (const [face, n] of [[1, 22], [5, 5], [10, 5]]) await box.getByLabel(`${face} 元实点张数`).fill(String(n));
  await expect(box.locator('.is-total dd')).toHaveText('97HTB');
  const actions = page.locator('.dc-actions');
  await actions.getByRole('button', { name: '核对' }).click();
  await expect(box.locator('.dc-qty-diff')).toHaveText(['相符', '多 1 张', '相符', '相符']);
  await expect(qty(2)).toHaveClass(/is-off/);
  await expect(qty(1)).toHaveClass(/is-even/);
  const off = box.locator('.dc-notice-danger');
  await expect(off).toContainText('不平账，多 2 HTB');
  await expect(off).toContainText('2 元多 1 张。对照下面的现金业务再点一遍；确实不平，写明原因再下班。');
  const txns = box.getByRole('list', { name: '本次上班的现金业务' }).locator('.dc-txn');
  await expect(txns.locator('.dc-txn-title')).toHaveText(['存款 · 张小明', '兑换 · 李思远']);
  await expect(txns.locator('.dc-txn-time')).toHaveText([/ · 收 10 元 × 1、5 元 × 1、1 元 × 2$/, / · 收 10 元 × 1，找 2 元 × 2$/]);
  const end = actions.getByRole('button', { name: '下班', exact: true });
  await expect(end).toBeDisabled(); // no reason yet

  // A changed count clears the result until 核对 again.
  await box.getByLabel('增加一张 1 元').click();
  await expect(box.locator('.dc-qty-diff')).toHaveCount(0);
  await expect(off).toHaveCount(0);
  await box.getByLabel('减少一张 1 元').click();
  await actions.getByRole('button', { name: '核对' }).click();
  await box.getByLabel('原因').fill('找零少给了 1 张 2 元');
  await expect(end).toBeEnabled();

  // The server's difference stands: a 下班 that reaches it without the reason is refused and does not end the duty.
  await page.route('**/rest/v1/rpc/end_duty', (route) => {
    const body = route.request().postDataJSON();
    return route.continue({ postData: JSON.stringify({ ...body, p_note: null }) });
  }, { times: 1 });
  await end.click();
  await expect(page.locator('.dc-sheet-text')).toHaveText(/^实点 97 HTB，多 2 HTB，原因：找零少给了 1 张 2 元。本次上班共 \d+ 笔业务，没有打印总结。下班后不能再办理业务，需要时再点「上班」。$/);
  await confirmIn(page, '确认下班');
  await expect(page.locator('.dc-sheet')).toHaveCount(0);
  await expect(box.locator('.dc-notice-danger', { hasText: '请写明原因' })).toContainText('现金和应有不一致，写明原因后才能下班。');
  await expect(page.locator('.dc-duty')).toContainText('已上班');

  await actions.getByRole('button', { name: '打印总结' }).click();
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  await (await download).saveAs(test.info().outputPath('下班总结.pdf'));
  await expect(page.locator('.dc-sheet-text')).toHaveText(/^实点 97 HTB，多 2 HTB，原因：找零少给了 1 张 2 元。总结共 \d+ 笔业务。/);
  await confirmIn(page, '已签字，确认下班');
  await expect(page.locator('section[aria-label="上下班"]')).toContainText('未上班');
  expect(sql(`select c.expected || jsonb_build_object('count', c.teller_count, 'note', c.teller_note) from public.cash_counts c
    join public.duty d on d.id = c.duty_id where d.user_id = ${teller} order by d.started_at desc limit 1`))
    .toBe('{"1": 22, "2": -1, "5": 5, "10": 5, "note": "找零少给了 1 张 2 元", "count": {"1": 22, "2": 0, "5": 5, "10": 5}}');
});

test('the next 上班 starts from that count, and a box that balances ends at once', async ({ page }) => {
  await signIn(page, '工作人员', 'teller01');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await page.getByRole('button', { name: '上班', exact: true }).click();
  const card = page.locator('.dc-card', { hasText: '登记备用金' });
  await expect(card).toContainText('默认是上次下班时点出的张数，复核改过的按复核的数；按实际张数修改，没有就填 0。');
  for (const [face, n] of [[1, 22], [2, 0], [5, 5], [10, 5]]) await expect(card.getByLabel(`${face} 元张数`)).toHaveValue(String(n));
  await page.getByRole('button', { name: '确认上班' }).click();
  await expect(page.locator('.dc-duty')).toContainText('已上班');

  await page.getByRole('button', { name: '下班' }).click();
  const box = page.locator('section[aria-label="点储蓄盒"]');
  for (const [face, n] of [[1, 22], [5, 5], [10, 5]]) await box.getByLabel(`${face} 元实点张数`).fill(String(n));
  await page.locator('.dc-actions').getByRole('button', { name: '核对' }).click();
  await expect(box.locator('.dc-notice-success')).toHaveText('平账各面额都和应有相符。打印下班总结，签字后确认下班。');
  await expect(box.getByLabel('原因')).toHaveCount(0);
  await page.locator('.dc-actions').getByRole('button', { name: '下班', exact: true }).click();
  await expect(page.locator('.dc-sheet-text')).toHaveText('实点 97 HTB，平账。本次上班共 0 笔业务，没有打印总结。下班后不能再办理业务，需要时再点「上班」。');
  await confirmIn(page, '确认下班');
  await expect(page.locator('section[aria-label="上下班"]')).toContainText('未上班');
});

const row = (page: Page, text: string) => page.getByRole('table', { name: '轧账' }).locator('tbody tr', { hasText: text });
// The row whose 差额 reads `diff` exactly (平, 多 2 HTB).
const byDiff = (page: Page, diff: string) => page.getByRole('table', { name: '轧账' }).locator('tbody tr')
  .filter({ has: page.locator('td:nth-child(6)').getByText(diff, { exact: true }) });

test('财务: 待复核 on 总览 (a day late in red), 复核 as the teller counted, and with a count of its own', async ({ page }) => {
  // The seeded duty ended yesterday.
  sql(`update public.duty set started_at = started_at - interval '1 day', ended_at = ended_at - interval '1 day'
    where id = (select id from public.duty where user_id = ${teller} order by started_at limit 1)`);
  await signIn(page, '工作人员', 'accountant01');
  const waiting = page.locator('section[aria-label="待复核的轧账"]');
  await expect(waiting.getByRole('heading')).toHaveText('待复核的轧账 · 3 次');
  await expect(waiting.locator('.dc-caption.is-danger')).toHaveText('1 次已超过一天未复核');
  const links = waiting.locator('.dc-list-link');
  await expect(links).toHaveCount(3);
  await expect(links.first()).toContainText('超过一天');
  await expect(links.nth(1)).toContainText('柜员实点 97 HTB · 多 2 HTB');
  await expect(links.nth(2)).toContainText('柜员实点 97 HTB · 平');

  await page.locator('.dc-nav-item', { hasText: '轧账' }).click();
  await expect(page.getByRole('tab', { selected: true })).toHaveText('待复核3');
  await expect(page.getByRole('table', { name: '轧账' }).locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('.dc-tag-danger', { hasText: '待复核 · 超过一天' })).toHaveCount(1);
  const short = byDiff(page, '多 2 HTB');
  await expect(short.locator('td')).toHaveText(['柜员小林', /– /, '待复核', '95 HTB', '97 HTB', '多 2 HTB', '找零少给了 1 张 2 元']);
  await expect(page.getByRole('columnheader')).toHaveCount(7); // no column of actions: the name opens the duty
  const even = byDiff(page, '平').filter({ hasText: '97 HTB' });

  // As the teller counted, on the duty's own page.
  await even.getByRole('link', { name: '柜员小林' }).click();
  await expect(page).toHaveURL(/\/admin\/cash\/[0-9a-f-]{36}$/);
  await expect(page.locator('.dc-top-title')).toContainText('复核 柜员小林的上班');
  const shift = page.locator('section[aria-label="这次上班"]');
  const check = page.locator('section[aria-label="核对"]');
  const actions = page.locator('.dc-actions');
  // The cash table is in 核对, one row per face; the totals are in 这次上班.
  const table = check.getByRole('table', { name: '本次上班现金' });
  await expect(table.getByRole('columnheader')).toHaveText(['面额', '应有', '柜员实点', '差额']);
  await expect(table.locator('tbody tr td:first-child')).toHaveText(['1 元', '2 元', '5 元', '10 元']);
  await expect(shift.locator('.dc-kv > div').filter({ hasText: /^(应有|柜员实点)/ })).toHaveText(['应有97 HTB', '柜员实点97 HTB']);
  await expect(check.getByRole('radio', { name: '和柜员点的一致' })).toBeChecked();
  await expect(check.locator('.dc-caption')).toHaveText('以柜员点的 97 HTB 为准。');
  await expect(actions.locator('.dc-actions-total b')).toHaveText('97HTB');
  await actions.getByRole('button', { name: '复核通过' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('已复核，平账');
  await expect(page).toHaveURL(/\/admin\/cash$/);
  // The row stays where it was, now 已轧账 and marked new.
  await expect(page.getByRole('table', { name: '轧账' }).locator('tbody tr')).toHaveCount(3);
  await expect(page.locator('tbody tr.is-new .dc-tag-success')).toHaveText('已轧账');

  // The filters stay in the address: 返回 comes back to them.
  await page.locator('form[aria-label="筛选轧账"] select').selectOption({ label: '柜员小林' });
  await expect(page.getByRole('table', { name: '轧账' }).locator('tbody tr')).toHaveCount(2);
  await short.getByRole('link', { name: '柜员小林' }).click();
  await expect(page).toHaveURL(/\/admin\/cash\/[0-9a-f-]{36}\?user=/);
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page).toHaveURL(/\/admin\/cash\?user=/);
  await expect(page.locator('form[aria-label="筛选轧账"] select').locator('option:checked')).toHaveText('柜员小林');

  // A count of the accountant's own: the difference is worked out again, and a count other than the teller's needs the reason.
  await short.getByRole('link', { name: '柜员小林' }).click();
  await expect(page.getByRole('list', { name: '本次上班的现金业务' }).locator('.dc-txn-title')).toHaveText(['存款 · 张小明', '兑换 · 李思远']);
  await check.locator('.dc-seg label', { hasText: '不一致' }).click();
  await expect(check.locator('.dc-qty-sum')).toHaveText(['柜员22', '柜员0', '柜员5', '柜员5']);
  await check.getByLabel('减少一张 1 元').click();
  await expect(check.locator('.is-total')).toHaveText('复核实点合计96HTB');
  await expect(check.locator('.dc-caption.is-danger')).toHaveText('按复核的数，多 1 HTB，会记一条风险提醒。');
  await expect(actions.locator('.dc-actions-total')).toContainText('复核实点');
  await expect(actions.getByRole('button', { name: '复核通过' })).toBeDisabled();
  await check.getByLabel('原因').fill('盒底少了 1 张 1 元');
  await actions.getByRole('button', { name: '复核通过' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('已复核，多 1 HTB');
  await expect(page).toHaveURL(/\/admin\/cash\?user=/);
  await page.getByRole('tab', { name: /^已轧账/ }).click();
  await expect(byDiff(page, '多 1 HTB').locator('td.is-wrap small')).toHaveText('复核：复核点为 96 HTB，盒底少了 1 张 1 元');
  expect(sql(`select c.review_count::text || ' ' || c.status from public.cash_counts c join public.duty d on d.id = c.duty_id
    where c.review_note is not null`)).toBe('{"1": 21, "2": 0, "5": 5, "10": 5} done');

  // A review already made is read-only.
  await byDiff(page, '多 1 HTB').getByRole('link', { name: '柜员小林' }).click();
  const cash = page.locator('section[aria-label="现金"]');
  await expect(cash.getByRole('table', { name: '本次上班现金' }).getByRole('columnheader')).toHaveText(['面额', '应有', '柜员实点', '复核实点', '差额']);
  await expect(cash.getByRole('table', { name: '本次上班现金' }).locator('tbody tr').first().locator('td')).toHaveText(['1 元', /^\d+$/, '22', '21', /^(0|[多少] \d+ 张)$/]);
  await expect(shift).toContainText('复核实点96 HTB');
  await expect(shift).toContainText('由财务小郑复核');
  await expect(check).toHaveCount(0);
  await expect(actions).toHaveCount(0);
});

test('强制下班: the counter stops at once, and the accountant counts the box', async ({ page, browser, baseURL, ignoreHTTPSErrors, locale, timezoneId }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(page).toHaveURL(/\/counter$/);
  await page.getByRole('button', { name: '上班', exact: true }).click();
  await page.getByRole('button', { name: '确认上班' }).click();
  await findStudent(page, 'zxm', '张小明');

  const president = await (await browser.newContext({ baseURL, ignoreHTTPSErrors, locale, timezoneId })).newPage();
  await signIn(president, '工作人员', 'president01');
  await expect(president).toHaveURL(/\/admin$/);
  await president.goto('/admin/cash');
  await president.getByRole('tab', { name: /^待下班/ }).click();
  await row(president, '柜员小林').getByRole('button', { name: '柜员小林' }).click();
  const sheet = president.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('柜员小林的上班');
  await expect(sheet.locator('.dc-kv dt')).toHaveText(['上班', '状态']);
  await expect(sheet.locator('.dc-tag')).toHaveText('待下班');
  await expect(sheet.getByRole('button', { name: '强制下班' })).toHaveClass(/dc-btn-ghost is-danger/);
  await confirmIn(president, '强制下班');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('让柜员小林强制下班？');
  await expect(sheet.getByRole('button', { name: '强制下班' })).toBeDisabled();
  await sheet.getByLabel('原因').fill('同一学生 10 分钟内办理 6 笔');
  await confirmIn(president, '强制下班');
  await expect(president.locator('.dc-toast')).toHaveText('已强制下班');
  await president.getByRole('tab', { name: /^强制下班/ }).click();
  await expect(row(president, '柜员小林').locator('.dc-tag-danger')).toHaveText('强制下班');
  await president.close();

  // The teller's next business is refused: the visit ends and the counter says why.
  await page.getByLabel('增加一张 5 元').click();
  await page.getByRole('button', { name: '确认存款 5 HTB' }).click();
  await expect(page.locator('.dc-notice-danger', { hasText: '已被强制下班' })).toContainText('行长或银行管理员结束了这次上班。重新上班后才能继续办理。');
  await expect(page.locator('.dc-empty', { hasText: '未上班' })).toBeVisible();

  // No teller's count: the accountant enters one, and the reason only when it differs from what the box should hold.
  await signIn(page, '工作人员', 'accountant01');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/cash');
  const forced = row(page, '强制下班');
  await expect(forced.locator('td').nth(4)).toHaveText('—');
  await expect(forced.locator('td.is-wrap small')).toHaveText('强制下班：同一学生 10 分钟内办理 6 笔');
  await forced.getByRole('link', { name: '柜员小林' }).click();
  const review = page.locator('section[aria-label="核对"]');
  await expect(page.locator('section[aria-label="这次上班"]')).toContainText('同一学生 10 分钟内办理 6 笔');
  await expect(review.locator('.dc-seg')).toHaveCount(0);
  await expect(review.locator('.dc-qty-sum')).toHaveText(['应有22', '应有0', '应有5', '应有5']);
  await review.getByLabel('1 元复核实点张数').fill('22');
  await review.getByLabel('5 元复核实点张数').fill('5');
  await review.getByLabel('10 元复核实点张数').fill('4');
  const pass = page.locator('.dc-actions').getByRole('button', { name: '复核通过' });
  await expect(pass).toBeDisabled();
  await review.getByLabel('增加一张 10 元').click();
  await expect(review.locator('.dc-caption.is-danger')).toHaveCount(0);
  // Without the count the server asks for one.
  await page.route('**/rest/v1/rpc/review_cash_count', (route) =>
    route.continue({ postData: JSON.stringify({ p_duty_id: route.request().postDataJSON().p_duty_id }) }), { times: 1 });
  await pass.click();
  await expect(review.locator('.dc-notice-danger')).toContainText('这次上班没有柜员实点，请录入点出的各面额张数。');
  await pass.click();
  await expect(page.locator('.dc-toast')).toHaveText('已复核，平账');
  expect(sql(`select c.status || ' ' || (c.forced_by is not null) from public.cash_counts c join public.duty d on d.id = c.duty_id
    where d.user_id = ${teller} order by d.started_at desc limit 1`)).toBe('done true');
});

test('银行管理员: 复核 as the teller counted and with a count of its own, as the reviewer', async ({ page }) => {
  // One more duty, from the count the accountant made of the last box and with no business, so it balances.
  await signIn(page, '工作人员', 'teller01');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await startDuty(page);
  await expect(page.locator('.dc-duty')).toContainText('已上班');
  await endDuty(page, true);

  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  const waiting = page.locator('section[aria-label="待复核的轧账"]');
  await expect(waiting.getByRole('heading')).toHaveText('待复核的轧账 · 2 次');
  // The seeded duty, a day late, comes first; the bank admin takes the teller's count.
  await waiting.locator('.dc-list-link').first().click();
  await expect(page).toHaveURL(/\/admin\/cash\/[0-9a-f-]{36}$/);
  await expect(page.locator('.dc-top-title')).toContainText('复核 柜员小林的上班');
  const check = page.locator('section[aria-label="核对"]');
  const pass = page.locator('.dc-actions').getByRole('button', { name: '复核通过' });
  await expect(check.getByRole('radio', { name: '和柜员点的一致' })).toBeChecked();
  await pass.click();
  await expect(page.locator('.dc-toast')).toHaveText(/^已复核，/);
  await expect(page.locator('tbody tr.is-new .dc-tag-success')).toHaveText('已轧账');

  // A count of the bank admin's own, with the reason.
  await page.getByRole('table', { name: '轧账' }).locator('tbody tr', { has: page.locator('.dc-tag-pending') })
    .getByRole('link', { name: '柜员小林' }).click();
  await check.locator('.dc-seg label', { hasText: '不一致' }).click();
  await check.getByLabel('增加一张 1 元').click();
  await expect(check.locator('.dc-caption.is-danger')).toHaveText('按复核的数，多 1 HTB，会记一条风险提醒。');
  await expect(pass).toBeDisabled();
  await check.getByLabel('原因').fill('盒底多找到 1 张 1 元');
  await pass.click();
  await expect(page.locator('.dc-toast')).toHaveText('已复核，多 1 HTB');
  expect(sql(`select string_agg(p.display_name, ',') from public.cash_counts c join public.profiles p on p.id = c.reviewed_by
    where c.reviewed_at > now() - interval '5 minutes' and p.login_id = 'admin'`)).toBe('银行管理员,银行管理员');

  // The reviewer reads as the bank admin.
  await page.getByRole('tab', { name: /^已轧账/ }).click();
  await byDiff(page, '多 1 HTB').filter({ hasText: '盒底多找到' }).getByRole('link', { name: '柜员小林' }).click();
  await expect(page.locator('section[aria-label="这次上班"]')).toContainText('由银行管理员复核');
  await expect(page.locator('section[aria-label="这次上班"]')).toContainText('盒底多找到 1 张 1 元');
  await expect(check).toHaveCount(0);
});

test('行长: 待复核 on 总览, 复核 a duty and a 强制下班, as the reviewer', async ({ page, browser, baseURL, ignoreHTTPSErrors, locale, timezoneId }) => {
  // One duty that ends as counted, and one the president ends.
  await signIn(page, '工作人员', 'teller01');
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await startDuty(page);
  await expect(page.locator('.dc-duty')).toContainText('已上班');
  await endDuty(page, true);
  await startDuty(page);
  await expect(page.locator('.dc-duty')).toContainText('已上班');

  const president = await (await browser.newContext({ baseURL, ignoreHTTPSErrors, locale, timezoneId })).newPage();
  await signIn(president, '工作人员', 'president01');
  await expect(president).toHaveURL(/\/admin$/);
  await president.goto('/admin/cash');
  await president.getByRole('tab', { name: /^待下班/ }).click();
  await row(president, '柜员小林').getByRole('button', { name: '柜员小林' }).click();
  await confirmIn(president, '强制下班');
  await president.locator('.dc-sheet').getByLabel('原因').fill('放学后忘记下班');
  await confirmIn(president, '强制下班');
  await expect(president.locator('.dc-toast')).toHaveText('已强制下班');

  // 总览 lists both; the president takes the teller's count of the first.
  await president.goto('/admin');
  const waiting = president.locator('section[aria-label="待复核的轧账"]');
  await expect(waiting.getByRole('heading')).toHaveText('待复核的轧账 · 2 次');
  await waiting.locator('.dc-list-link').filter({ hasNotText: '强制下班' }).click();
  await expect(president).toHaveURL(/\/admin\/cash\/[0-9a-f-]{36}$/);
  const check = president.locator('section[aria-label="核对"]');
  const pass = president.locator('.dc-actions').getByRole('button', { name: '复核通过' });
  await expect(check.getByRole('radio', { name: '和柜员点的一致' })).toBeChecked();
  await pass.click();
  await expect(president.locator('.dc-toast')).toHaveText(/^已复核，/);

  // The 强制下班: the president counts the box as it should hold.
  await president.getByRole('tab', { name: /^强制下班/ }).click();
  await row(president, '放学后忘记下班').getByRole('link', { name: '柜员小林' }).click();
  await expect(check.locator('.dc-list-title')).toHaveText('复核实点');
  for (const qty of await check.locator('.dc-qty').all()) {
    await qty.locator('.dc-qty-input').fill((await qty.locator('.dc-qty-sum b').textContent())!);
  }
  await expect(check.locator('.is-total')).toContainText('复核实点合计');
  await pass.click();
  await expect(president.locator('.dc-toast')).toHaveText('已复核，平账');
  expect(sql(`select count(*) from public.cash_counts c join public.profiles p on p.id = c.reviewed_by
    where c.reviewed_at > now() - interval '5 minutes' and p.login_id = 'president01'`)).toBe('2');

  // The reviewer reads as the president.
  await president.getByRole('tab', { name: /^已轧账/ }).click();
  await row(president, '放学后忘记下班').getByRole('link', { name: '柜员小林' }).click();
  await expect(president.locator('section[aria-label="这次上班"]')).toContainText('由王行长复核');
  await expect(check).toHaveCount(0);
  await president.close();
});
