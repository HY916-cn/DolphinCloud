import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetData, signIn, sql } from './helpers';

// 存折版 (/book), for students only, on the seed data (supabase/seed.sql): 张小明 (20260001, 小学部) has an opening
// balance of 120, then a deposit of 25, a withdrawal of 15 and an exchange of 22: 108 now, the first of two.
test.beforeAll(resetData);

async function openBook(page: Page, id = '20260001', password = 'a12345678') {
  await page.goto('/book');
  const cover = page.getByRole('form', { name: '打开存折' });
  await cover.getByPlaceholder('学号').fill(id);
  await cover.getByPlaceholder('密码').fill(password);
  await cover.getByRole('button', { name: '打开存折' }).click();
}

// A phone shows one page of the 存折 at a time: turn on with 下一页 until `target` is on the page in view.
async function turnTo(page: Page, target: Locator) {
  const next = page.getByRole('button', { name: '下一页' });
  await expect(target.or(next).first()).toBeVisible(); // the part has opened
  for (let i = 0; i < 4 && !(await target.isVisible()); i++) {
    await next.click(); await page.waitForTimeout(900);
  }
  await expect(target).toBeVisible();
}

const mark = (page: Page, label: string) => page.getByRole('navigation', { name: '存折栏目' }).getByRole('link', { name: label });

test('the cover is the lock: a wrong password keeps it shut, a student’s 学号 and password open it', async ({ page }) => {
  await openBook(page, '20260001', 'wrong-password');
  await expect(page.getByRole('alert')).toContainText('账号或密码不正确');
  await expect(page.locator('.dc-book-open')).toHaveCount(0);
  // A staff login is not a student's: its 账号 does not open the 存折.
  await openBook(page, 'admin');
  await expect(page.getByRole('alert')).toContainText('账号或密码不正确');

  await openBook(page);
  await expect(mark(page, '账户')).toHaveAttribute('aria-current', 'page');
  const account = page.getByRole('region', { name: '储蓄存折' });
  await expect(account.locator('.dc-pb-fields').first()).toContainText('账号20260001');
  await expect(account.locator('.dc-pb-balance dd')).toHaveText('108HTB');
  // 信用分 under the balance on the small gauge. Two facing pages also print 存款排名; a phone's one page gives that line
  // to 信用分 and fits without scrolling.
  await expect(account.locator('.dc-pb-sums').getByRole('meter', { name: '海豚信用分' })).toHaveAttribute('aria-valuenow', '600');
  await expect(account.locator('.dc-pb-sums .dc-gauge-score')).toHaveText('600');
  if (test.info().project.name === 'phone') {
    await expect(account.locator('.dc-pb-sums')).not.toContainText('存款排名');
    expect(await account.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  } else {
    await expect(account.locator('.dc-pb-sums')).toContainText('存款排名第 1 名小学部 2 人');
  }
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  await expect(account.locator('.dc-pb-foot')).toContainText('第 1 页');
  await turnTo(page, page.getByRole('region', { name: '交易记录' }));
  const lines = page.getByRole('region', { name: '交易记录' }).locator('.dc-txn');
  await expect(lines).toHaveCount(4);
  // Newest first, each line with the balance after it: 22 taken out leaves 108, the opening 120 is the last line.
  await expect(lines.first().locator('td.is-out')).toHaveText('22');
  await expect(lines.first().locator('td').last()).toHaveText('108');
  await expect(lines.last().locator('td').last()).toHaveText('120');
});

test('the bookmarks turn to 明细, 排名 and 我的; closing the 存折 signs out to its cover', async ({ page }) => {
  await openBook(page);
  await mark(page, '明细').click();
  await expect(page).toHaveURL(/\/book\/txns$/);
  await expect(mark(page, '明细')).toHaveAttribute('aria-current', 'page');
  // The month comes first; the lines are on the page after it (facing it on a computer).
  await expect(page.getByRole('region', { name: /\d+月收支/ })).toContainText('当前余额108HTB');
  const panel = page.getByRole('tabpanel');
  await turnTo(page, panel);
  await expect(panel.locator('.dc-txn')).toHaveCount(4);
  await page.getByRole('tab', { name: '取款' }).click();
  await expect(panel.locator('.dc-txn')).toHaveCount(1);

  await mark(page, '排名').click();
  await expect(page).toHaveURL(/\/book\/ranking$/);
  const mine = page.locator('.dc-passbook .dc-pb-table tr[aria-current]');
  await expect(mine).toContainText('张*明我');
  await expect(mine).toContainText('108');
  await turnTo(page, page.getByRole('region', { name: '我的名次' }));
  await expect(page.getByRole('region', { name: '我的名次' })).toContainText('名次第 1 名');

  await mark(page, '我的').click();
  await expect(page).toHaveURL(/\/book\/me$/);
  await expect(page.getByRole('region', { name: '户主信息' })).toContainText('账户状态在读');
  await turnTo(page, page.getByRole('button', { name: /合上存折/ }));
  await page.getByRole('button', { name: /合上存折/ }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByRole('form', { name: '打开存折' })).toBeVisible();
});

test('the pages are numbered at their foot and turn with the arrow keys', async ({ page }) => {
  await openBook(page);
  const first = page.getByRole('region', { name: '储蓄存折' }), second = page.getByRole('region', { name: '交易记录' });
  await expect(first.locator('.dc-pb-foot')).toContainText('第 1 页');
  await page.keyboard.press('ArrowRight'); // a phone turns to page 2; a computer, with pages 1 and 2 open, to page 3
  if (test.info().project.name === 'phone') await expect(second.locator('.dc-pb-foot')).toContainText('第 2 页');
  else await expect(page.getByRole('region', { name: '利息 · 定期 · 贷款' }).locator('.dc-pb-foot')).toContainText('第 3 页');
  await page.keyboard.press('ArrowLeft');
  await expect(first.locator('.dc-pb-foot')).toContainText('第 1 页');
});

test('this device opens the version last used: the 存折版 until the 普通版 is used again', async ({ page }) => {
  await openBook(page);
  await expect(page.locator('.dc-book-open')).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/book$/);
  await mark(page, '我的').click();
  await expect(page.getByRole('region', { name: '户主信息' })).toBeVisible(); // 我的 has opened, not 账户's 下一页
  const style = page.getByRole('group', { name: '页面样式' });
  await turnTo(page, style);
  await expect(style.getByRole('radio', { name: /存折版/ })).toBeChecked();
  await style.getByText('普通版').click(); // the 存折 closes, then the 普通版 opens
  await expect(page).toHaveURL(/\/student$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/student$/);
});

test('the 存折版 is for students: a staff login there goes to its own pages', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin/);
  await page.goto('/book');
  await expect(page).toHaveURL(/\/admin/);
});

// Last, as it adds a business: a week's 活期 interest paid by the system.
test('明细 prints seven tabs, 利息 and 贷款 among them; on a phone all seven share a row and the page fits without scrolling', async ({ page }) => {
  sql(`insert into public.interest_accruals (student_no, day, balance, rate, centi) values ('20260001', current_date - 2, 108, 2.08, 230);
       select app_private.settle_interest(now())`);
  await openBook(page);
  await mark(page, '明细').click();
  await expect(page.getByRole('region', { name: /\d+月收支/ })).toBeVisible(); // 明细 has opened, not 账户's 下一页
  const panel = page.getByRole('tabpanel');
  await turnTo(page, panel);
  await expect(page.getByRole('tab')).toHaveText(['全部', '存款', '取款', '兑换', '工资', '利息', '贷款']);
  await expect(panel.locator('.dc-txn')).toHaveCount(5);
  await page.getByRole('tab', { name: '利息' }).click();
  await expect(panel.locator('.dc-txn')).toHaveCount(1);
  await expect(panel.locator('.dc-txn')).toContainText('活期利息');
  const sheet = page.getByRole('region', { name: '交易明细' });
  await page.getByRole('tab', { name: '全部' }).click();
  await expect(panel.locator('.dc-txn')).toHaveCount(5);
  expect(await sheet.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  if (test.info().project.name === 'phone') { // the seven share one row
    expect(new Set(await page.getByRole('tab').evaluateAll((tabs) => tabs.map((t) => t.getBoundingClientRect().top))).size).toBe(1);
  }
});

// Last, as it opens a term, a 定期 and a 贷款: the account's third page sums them up, the loan in seal red once overdue.
test('the account’s third page prints 攒着的利息, 定期合计 and 贷款, and 贷款 in red once overdue', async ({ page }) => {
  const DAY = 'app_private.cn_date(now())';
  const md = (date: string) => sql(`select to_char(${date}, 'FMMM月FMDD日')`);
  const LOAN = `(select id from public.loans where student_no = '20260001' and status <> 'reversed')`;
  sql(`insert into public.terms (name, starts_on, ends_on) values ('本学期', ${DAY} - 30, ${DAY} + 40);
       insert into public.interest_accruals (student_no, day, balance, rate, centi) values ('20260001', current_date - 1, 108, 2.08, 37);
       select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where login_id = 'teller01'), 'role', 'authenticated')::text, false);
       select public.open_term_deposit(gen_random_uuid(), '20260001', 50, 4);
       select public.open_loan(gen_random_uuid(), '20260001', 60, '买书', 'installment', 4, 'account')`);
  const centi = Number(sql(`select app_private.pending_interest('20260001')`));
  expect(centi).toBeLessThan(100);
  const first = Number(sql(`select p.principal + l.interest_centi / 100 from public.loan_periods p join public.loans l on l.id = p.loan_id
    where p.loan_id = ${LOAN} and p.seq = 1`));

  await openBook(page);
  const sums = page.getByRole('region', { name: '利息 · 定期 · 贷款' });
  await turnTo(page, sums);
  const lines = sums.locator('.dc-pb-fields dd');
  await expect(lines).toHaveText([
    `0.${String(centi).padStart(2, '0')} HTB满 1 HTB 再存进余额`,
    `50 HTB${md(`${DAY} + 28`)} 到期`,
    `剩余 60 HTB${md(`${DAY} + 7`)} 应还 ${first} HTB`,
  ]);
  await expect(lines.nth(2)).not.toHaveClass(/is-danger/);
  await expect(sums.getByRole('list', { name: '说明' }).locator('li')).toHaveCount(4);
  await expect(sums.locator('.dc-pb-foot')).toContainText('第 3 页');
  if (test.info().project.name === 'phone') expect(await sums.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);

  sql(`update public.loan_periods set due_on = ${DAY} - 1, overdue_at = now() where loan_id = ${LOAN} and seq = 1;
       update public.loans set status = 'overdue' where id = ${LOAN}`);
  const late = Number(sql(`select principal - paid from public.loan_periods where loan_id = ${LOAN} and seq = 1`));
  await page.reload();
  await turnTo(page, sums);
  await expect(lines.nth(2)).toHaveText(`已逾期 · 应还 ${late} HTB`);
  await expect(lines.nth(2)).toHaveClass(/is-danger/);
});
