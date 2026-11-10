import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { confirmIn, downloadNotices, endDuty, resetData, signIn, sql } from './helpers';

// What keeps a slip or a lost network from doing harm, on the seed data: the offline counter, salary rates that could not
// be read, batches and their confirmations, an import cut short, the sheet's focus, a device without a roster, and the
// fields that refuse an empty or impossible value.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

const search = (page: Page) => page.getByRole('searchbox', { name: '搜索学生' });

test('a teller whose device knows they are off duty still registers deposits offline', async ({ page, context }) => {
  await signIn(page, '工作人员', 'teller01');
  await expect(search(page)).toBeVisible();
  await search(page).fill('zxm');
  await expect(page.locator('.dc-list-link', { hasText: '张小明' })).toBeVisible(); // the roster is on this device
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await endDuty(page, true);
  await page.locator('.dc-nav-item', { hasText: '办理' }).click();
  await expect(page).toHaveURL(/\/counter$/);
  await expect(page.getByRole('heading', { name: '未上班' })).toBeVisible();
  await expect(search(page)).toHaveCount(0);

  const registered = await page.evaluate(() =>
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => 'ready', (e) => String(e)));
  expect(registered).toBe('ready');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.dc-notice', { hasText: '离线登记' })).toBeVisible();
  await search(page).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await page.getByLabel('增加一张 5 元').click();
  await page.getByRole('button', { name: '确认存款 5 HTB' }).click();
  await expect(page.locator('aside[aria-label="办理单"]')).toContainText('存款（离线登记）');

  await context.setOffline(false);
  await page.locator('aside[aria-label="办理单"]').getByRole('button', { name: '结束办理 1 笔' }).click();
  await page.getByRole('button', { name: '上传' }).click();
  await expect(page.locator('.dc-notice', { hasText: '待上传' })).toHaveCount(0);
  expect(sql(`select balance from public.accounts where student_no = '20260001'`)).toBe('113');
  await page.getByRole('button', { name: '上班' }).click();
  await expect(search(page)).toBeVisible();
});

test.describe(() => {
  test.use({ serviceWorkers: 'block' }); // page.route sees the app's own requests only
  const salary = (url: URL) => url.pathname.endsWith('/rest/v1/settings') && url.search.includes('salary_per_shift');

  test('工资 cannot be paid on rates that were not read; with them, the amount confirmed is the amount paid', async ({ page }) => {
    test.skip(!process.env.E2E_CONTAINER, 'needs the test container');
    sql(`insert into public.staff_payroll (user_id, account, attendance) select id, '20260002', true from public.profiles where login_id = 'teller01'
      on conflict (user_id) do update set account = excluded.account, attendance = true`);
    sql(`insert into public.attendance (user_id, day, shift, status, signed_by) select id, (now() at time zone 'Asia/Shanghai')::date, 'am', 'confirmed', id
      from public.profiles where login_id = 'teller01'`);
    const pay = sql(`select value ->> 'am' from public.settings where key = 'salary_per_shift'`);

    await page.route(salary, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"test"}' }));
    await signIn(page, '工作人员', 'admin');
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/attendance');
    await expect(page.locator('.dc-notice-danger')).toContainText('暂时无法读取工资费率', { timeout: 10_000 });
    const paying = page.getByRole('button', { name: '发放工资' });
    await expect(paying).toBeDisabled();
    await expect(page.locator('.dc-stat', { hasText: '每班工资' })).toContainText('—');
    await expect(page.locator('.dc-stat', { hasText: '本周工资' })).toContainText('—');
    await expect(page.locator('.dc-sheet')).toHaveCount(0);

    await page.unroute(salary);
    await page.getByRole('button', { name: '重试' }).click();
    await expect(page.locator('.dc-stat', { hasText: '每班工资' })).toContainText(`${pay} /`);
    await paying.click();
    await expect(page.locator('.dc-sheet')).toContainText(`${pay} HTB`);
    await confirmIn(page, `发放 ${pay} HTB`);
    await expect(page.locator('.dc-notice-success')).toContainText(`已发放 ${pay} HTB`);
    expect(sql(`select pay from public.attendance where salary_txn is not null`)).toBe(pay);
  });

  test('the teller sees — and not 0 while the rates cannot be read', async ({ page }) => {
    await page.route(salary, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"test"}' }));
    await signIn(page, '工作人员', 'teller01');
    await expect(page).toHaveURL(/\/counter$/);
    await page.goto('/counter/attendance');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.dc-stat', { hasText: '工资' })).toContainText('—');
    await expect(page.locator('.dc-top-sub', { hasText: '中午班每个' })).toHaveText('工资：中午班每个 — HTB，下午班每个 — HTB。');
    await page.unroute(salary);
    await page.reload();
    await expect(page.locator('.dc-top-sub', { hasText: '中午班每个' })).toHaveText(/中午班每个 \d+ HTB，下午班每个 \d+ HTB/);
  });
});

test('选择 covers only the students in view, and a batch confirmation names everyone it reaches', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  const bar = page.getByRole('toolbar', { name: '批量操作' });
  const pick = (name: string) => page.locator('.dc-batch-pick', { hasText: `选择${name}` }).click();

  await pick('张小明');
  await expect(bar).toContainText('已选 1 个');
  await page.getByRole('searchbox', { name: '搜索学生' }).fill('不存在XYZ');
  await expect(bar).toContainText('已选 0 个');
  await expect(bar.getByRole('button', { name: '重置密码' })).toBeDisabled();
  await expect(bar.getByRole('button', { name: '注销' })).toBeDisabled();
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(bar).toContainText('已选 0 个');

  await pick('张小明');
  await page.getByRole('button', { name: /未设置密码/ }).click();
  await expect(bar).toContainText('已选 0 个');
  await page.getByRole('button', { name: /未设置密码/ }).click();

  await pick('张小明');
  await bar.getByRole('button', { name: '冻结' }).click();
  await expect(page.locator('.dc-sheet-list li')).toHaveText(['张小明20260001']);
  await confirmIn(page, '冻结');
  await expect(page.locator('.dc-notice-success')).toContainText('已冻结 1 人');

  await pick('张小明');
  await pick('李思远');
  await bar.getByRole('button', { name: '重置密码' }).click();
  await expect(page.locator('.dc-sheet-list li')).toHaveText(['张小明20260001', '李思远20260002']);
  await page.locator('.dc-sheet').getByRole('button', { name: '取消' }).click();
  await bar.getByRole('button', { name: '注销' }).click();
  await expect(page.locator('.dc-sheet-list li')).toHaveCount(2);
  await confirmIn(page, '继续');
  await expect(page.locator('.dc-sheet-list li')).toHaveCount(2);
  await page.locator('.dc-sheet').getByRole('button', { name: '取消' }).click();
  await bar.getByRole('button', { name: '恢复正常' }).click(); // only 张小明 is frozen
  await expect(page.locator('.dc-sheet-list li')).toHaveText(['张小明20260001']);
  await confirmIn(page, '恢复正常');
  await expect(page.locator('.dc-notice-success')).toContainText('已恢复正常 1 人');

  await page.goto('/admin/staff');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await pick('柜员小林');
  await expect(bar).toContainText('已选 1 个');
  await page.getByRole('searchbox', { name: '搜索工作人员' }).fill('柜员');
  await expect(bar).toContainText('已选 0 个');
  await page.getByRole('button', { name: '清除', exact: true }).click();
  await expect(bar).toContainText('已选 0 个');
  await bar.locator('label.dc-check').click();
  const count = Number((await bar.innerText()).match(/已选 (\d+) 个/)![1]);
  expect(count).toBeGreaterThan(1);
  for (const action of ['停用', '重置密码', '注销']) {
    await bar.getByRole('button', { name: action }).click();
    await expect(page.locator('.dc-sheet-list li')).toHaveCount(count);
    await page.locator('.dc-sheet').getByRole('button', { name: '取消' }).click();
    await expect(page.locator('.dc-sheet')).toHaveCount(0);
  }
});

test('a sheet keeps Tab inside it and gives focus back to the button that opened it', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/students');
  await page.getByRole('button', { name: '选择', exact: true }).click();
  await page.locator('.dc-batch-pick', { hasText: '选择张小明' }).click();
  const opener = page.getByRole('toolbar', { name: '批量操作' }).getByRole('button', { name: '重置密码' });
  const sheet = page.locator('.dc-sheet');
  const focused = () => page.evaluate(() => {
    const el = document.activeElement!;
    return { inside: !!el.closest('.dc-sheet'), name: el.getAttribute('aria-label') ?? (el as HTMLElement).innerText };
  });

  await opener.click();
  await expect(sheet.getByRole('button', { name: '取消' })).toBeFocused();
  for (const key of ['Tab', 'Shift+Tab']) {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press(key);
      const now = await focused();
      expect(now.inside).toBe(true);
      seen.add(now.name);
    }
    expect([...seen].sort()).toEqual(['取消', '本次涉及', '重置并生成通知单'].sort());
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await opener.click();
  await sheet.getByRole('button', { name: '取消' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test.describe(() => {
  test.use({ serviceWorkers: 'block' });
  const roster = (url: URL) => url.pathname.endsWith('/rest/v1/students') && !!url.searchParams.get('select')?.startsWith('student_no,name,class_no');

  test('a device with no roster and no network says so, and 重试 fetches it', async ({ page }) => {
    await page.route(roster, (route) => route.abort());
    await signIn(page, '工作人员', 'teller01');
    await expect(page).toHaveURL(/\/counter$/);
    const empty = page.locator('.dc-empty', { hasText: '这台设备还没有名册' });
    await expect(empty).toContainText('请联网后重试。名册下载后，断网也能搜索学生。');
    await page.unroute(roster);
    await empty.getByRole('button', { name: '重试' }).click();
    await expect(empty).toHaveCount(0);
    await search(page).fill('zxm');
    await expect(page.locator('.dc-list-link', { hasText: '张小明' })).toBeVisible();
  });

  test('a roster that is really empty is not a failure', async ({ page }) => {
    await page.route(roster, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await signIn(page, '工作人员', 'teller01');
    await expect(page).toHaveURL(/\/counter$/);
    await search(page).fill('zxm');
    await expect(page.locator('.dc-empty')).toContainText('没有找到「zxm」');
  });

  test('an import cut short keeps the notices of the students it opened', async ({ page }) => {
    test.setTimeout(180_000);
    const rows = Array.from({ length: 150 }, (_, i) => [String(20270001 + i), `新生${i + 1}`, '小学部', '2023', '1', '']);
    let calls = 0;
    await page.route('**/rest/v1/rpc/import_roster', (route) => (++calls === 2
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"test"}' }) : route.continue()));
    await signIn(page, '工作人员', 'admin');
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/students/import');
    await page.getByLabel('选择名册文件').setInputFiles({
      name: '名册.csv', mimeType: 'text/csv',
      buffer: Buffer.from('﻿' + [['学号', '姓名', '学部', '学届', '班号', '期初余额'], ...rows].map((r) => r.join(',')).join('\n')),
    });
    await page.getByRole('button', { name: '确认导入' }).click();
    await expect(page.locator('h1.display')).toHaveText('导入中断', { timeout: 120_000 });
    await expect(page.locator('.dc-result-lead')).toContainText('新开户 100 人');
    await expect(page.locator('.dc-notice-danger')).toContainText('前 100 人已导入，其中新开户 100 人，请先保存这些人的开户通知单');
    await expect(page.locator('.dc-notice-danger')).toContainText('已导入的学号只更新信息');
    await page.getByRole('button', { name: '开户通知单' }).click();
    const file = await downloadNotices(page);
    expect((await readFile(await file.path())).toString('latin1').match(/\/Type \/Page /g)?.length).toBe(100);
  });
});

test('a 时段 left empty takes the time in the band only when confirmed', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/txns');
  await page.getByRole('button', { name: '按时段' }).click();
  const until = page.getByRole('button', { name: '每天到', exact: true });
  await until.click();
  await page.keyboard.press('Escape');
  await expect(until).toHaveText('24:00');
  await until.click();
  await page.locator('.dc-top-title').click();
  await expect(until).toHaveText('24:00');

  const from = page.getByRole('button', { name: '每天从', exact: true });
  await expect(from).toHaveText('0:00');
  await from.click();
  await page.getByRole('dialog', { name: '选择每天从' }).getByRole('button', { name: '确定' }).click();
  await expect(from).toHaveText('00:00');
});

test('参数 says what a number may be and will not save one it cannot take', async ({ page }) => {
  let saves = 0;
  page.on('request', (r) => { if (r.url().includes('/rpc/set_settings')) saves++; });
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/settings');
  const save = page.getByRole('button', { name: '保存参数' });
  const single = page.locator('.dc-field', { hasText: '单笔取款上限' });
  const ranking = page.getByLabel('排名人数', { exact: true });
  await ranking.fill('7');
  await expect(save).toBeEnabled();

  await page.getByLabel('小学部单笔取款上限', { exact: true }).fill('');
  await expect(single).toHaveClass(/is-error/);
  await expect(single.locator('.dc-qty-ctrl.is-error')).toHaveCount(1);
  await expect(single.locator('.dc-field-hint')).toContainText('请输入 1 到 1000000 的整数');
  await expect(save).toBeDisabled();
  await page.getByLabel('小学部单笔取款上限', { exact: true }).fill('0');
  await expect(save).toBeDisabled();
  await page.getByLabel('小学部单笔取款上限', { exact: true }).fill('50');
  await expect(single).not.toHaveClass(/is-error/);
  await expect(save).toBeEnabled();

  await ranking.fill('101');
  await expect(page.locator('.dc-field', { hasText: '排名人数' }).locator('.dc-field-hint')).toContainText('请输入 1 到 100 的整数');
  await expect(save).toBeDisabled();
  expect(saves).toBe(0);
});

test.describe(() => {
  test.use({ serviceWorkers: 'block' }); // every request of the page is seen
  const pickTime = async (page: Page, field: string, ...values: string[]) => {
    await page.getByRole('button', { name: field, exact: true }).click();
    for (const value of values) await page.getByRole('button', { name: value, exact: true }).click();
    await page.getByRole('dialog', { name: `选择${field}` }).getByRole('button', { name: '确定' }).click();
  };
  const wrongThenRight = async (page: Page, read = '/rest/v1/txns?') => {
    await page.getByRole('button', { name: '按时段' }).click();
    await pickTime(page, '每天从', '10时');
    await pickTime(page, '每天到', '9时');
    await expect(page.locator('.dc-notice-danger')).toHaveText(/时段有误.*结束时间要晚于开始时间。/s);
    await page.waitForTimeout(500);
    let reads = 0;
    const count = (r: { url(): string }) => { if (r.url().includes(read)) reads++; };
    page.on('request', count);
    await page.waitForTimeout(800);
    expect(reads).toBe(0);
    await pickTime(page, '每天从', '0时');
    await pickTime(page, '每天到', '23时', '59分');
    await expect(page.locator('.dc-notice-danger')).toHaveCount(0);
    expect(reads).toBeGreaterThan(0);
    page.off('request', count);
  };

  test('流水 asks for nothing and exports nothing while its 时段 ends before it starts', async ({ page }) => {
    await signIn(page, '工作人员', 'admin');
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/txns');
    const out = page.getByRole('button', { name: '打印 / 导出' });
    await expect(out).toBeEnabled();
    await page.getByRole('button', { name: '按时段' }).click();
    await pickTime(page, '每天从', '10时');
    await pickTime(page, '每天到', '9时');
    await expect(page.locator('.dc-notice-danger')).toContainText('时段有误');
    await expect(out).toBeDisabled();
    await page.getByRole('button', { name: '按时段' }).click();
    await expect(page.locator('.dc-notice-danger')).toHaveCount(0);
    await expect(out).toBeEnabled();
    await page.getByRole('button', { name: '按时段' }).click(); // the off-chip cleared the 时段
    await page.reload();
    await wrongThenRight(page);
    await expect(out).toBeEnabled();
  });

  test('柜台查询 asks for nothing while its 时段 ends before it starts', async ({ page }) => {
    await signIn(page, '工作人员', 'teller01');
    await expect(page).toHaveURL(/\/counter$/);
    await search(page).fill('zxm');
    await page.locator('.dc-list-link', { hasText: '张小明' }).click();
    await page.locator('.dc-seg label', { hasText: '查询' }).click();
    await expect(page.locator('.dc-txn').first()).toBeVisible();
    await wrongThenRight(page, '/rest/v1/rpc/student_txns');
    await expect(page.locator('.dc-txn').first()).toBeVisible();
  });

  test('明细 asks for nothing while its 时段 ends before it starts', async ({ page }) => {
    await signIn(page, '学生', '20260001');
    await expect(page).toHaveURL(/\/student$/);
    await page.goto('/student/txns');
    await wrongThenRight(page);
    await expect(page.locator('.dc-txn').first()).toBeVisible();
  });
});

test('a duty left open overnight is ended before the counter serves anyone again', async ({ page }) => {
  test.skip(!process.env.E2E_CONTAINER, 'needs the test container');
  const receipt = page.locator('aside[aria-label="办理单"]');
  await signIn(page, '工作人员', 'teller01');
  await expect(search(page)).toBeVisible();
  await search(page).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();

  // The duty began yesterday: the server refuses the deposit, and ending the visit leaves only the card asking for 下班.
  sql(`update public.duty set started_at = started_at - interval '1 day' where ended_at is null
    and user_id = (select id from public.profiles where login_id = 'teller01')`);
  await page.getByLabel('增加一张 5 元').click();
  await page.getByRole('button', { name: '确认存款 5 HTB' }).click();
  await expect(page.locator('.dc-notice-danger')).toContainText('上次上班还没下班');
  await expect(page.locator('.dc-notice-danger')).toContainText('已经跨天。请先下班，再重新上班办理业务。');
  await page.getByRole('button', { name: '返回', exact: true }).click();
  const card = page.locator('section[aria-label="上下班"] .dc-empty');
  await expect(card).toContainText('上次上班还没下班');
  await expect(card).toContainText('已经跨天。先下班，再重新上班。');
  await expect(card.locator('.dc-empty-icon.is-danger')).toBeVisible();
  await expect(search(page)).toHaveCount(0);
  await page.locator('.dc-nav-item', { hasText: '考勤' }).click();
  await expect(page.locator('.dc-duty.is-stale')).toContainText('上次上班还没下班');
  await page.locator('.dc-nav-item', { hasText: '办理' }).click();

  await endDuty(page, true);
  await page.getByRole('button', { name: '上班' }).click();
  await search(page).fill('zxm');
  await page.locator('.dc-list-link', { hasText: '张小明' }).click();
  await page.getByLabel('增加一张 5 元').click();
  await page.getByRole('button', { name: '确认存款 5 HTB' }).click();
  await expect(receipt).toContainText('5 元 × 1 张 · HT');
});
