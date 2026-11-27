import { expect, test, type Page } from '@playwright/test';
import { resetData, signIn, sql } from './helpers';

// The three pages that need no sign-in (PHASE-2.md §16.4): 利率看板, 大屏时间 and 文件传输, with their links on the
// login page, and the bank admin's 文件传输 page. The tests run in order: a send made here is taken, then deleted.
test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

let code = '';
const pickup = (page: Page) => page.locator('.dc-pickup-code');
const boxes = (page: Page) => page.getByRole('group', { name: '取件码' }).locator('input');
const typed = (page: Page) => expect.poll(() => boxes(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)));
// The icon of each file row in a list, by its type.
const expectIcons = (page: Page, list: string, icons: string[]) => expect.poll(() => page.getByRole('list', { name: list })
  .locator('.dc-list-icon svg').evaluateAll((els) => els.map((e) => e.getAttribute('data-icon')))).toEqual(icons);

test('the login page links to the three pages, all on one 375×667 screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  // They sit under 更多 in the top right corner; Esc closes it and returns focus to 更多.
  const more = page.locator('.dc-login-more summary');
  const list = page.getByRole('list', { name: '不用登录的功能' });
  await more.click();
  await expect(list.getByRole('link', { name: /^利率看板/ })).toBeVisible();
  await expect(list.getByRole('link', { name: /^大屏时间/ })).toBeVisible();
  await expect(list.getByRole('link', { name: /^文件传输/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(more).toBeFocused();
  // Staff sign-in has them too.
  await page.locator('.dc-seg label', { hasText: '工作人员' }).click();
  await more.click();
  await list.getByRole('link', { name: /^文件传输/ }).click();
  await expect(page).toHaveURL(/\/transfer$/);
  await page.goto('/login');
  await more.click();
  await list.getByRole('link', { name: /^利率看板/ }).click();
  await expect(page).toHaveURL(/\/board$/);
});

test('利率看板: four tiles, 活期 at the bank admin’s 本周锚点, no sign-in', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/rates');
  const anchor = (await page.getByRole('region', { name: '本周锚点' }).locator('.dc-stat').first().textContent())!.replace('本周锚点', '');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('海豚银行 · 利率实时');
  await expect(page.locator('.dc-board-panel h2')).toHaveText(['活期本周', '贷款本周', '定期本周', '理财今天']);
  await expect(page.locator('.dc-board-grid')).not.toHaveClass(/is-flat-loan/);
  await expect(page.getByRole('region', { name: '活期周利率' }).locator('.dc-board-hero')).toHaveText(anchor);
  await expect(page.getByRole('region', { name: '贷款周利率' }).locator('dt')).toHaveText(['600 分', '750 分', '900 分', '1000 分']);
  await expect(page.getByRole('region', { name: '定期周利率' }).locator('dt')).toHaveText(['2 周', '4 周', '12 周', '24 周', '48 周']);
  // 理财: the six products in their order, each with its latest rate as public_rates gives it (— before its first net
  // value), and 休市 or its day under the name when that is so.
  const wealth = JSON.parse(sql(`select public_rates() -> 'wealth'`)) as { name: string; rate: number | null }[];
  const rows = page.getByRole('region', { name: '理财各品种今天的收益率' }).locator('.dc-board-list > div');
  await expect(rows.locator('dt')).toHaveText(['国债', '黄金', '沪深 300', '创业板指', '恒生指数', '纳斯达克 100'].map((n) => new RegExp(`^${n}`)));
  await expect(rows.locator('dd')).toHaveText(wealth.map((w) => (w.rate === null ? '—' : /^[+−]?\d+(\.\d+)?%$/)));
  await expect(page.getByRole('status')).toHaveText(/^更新于 \d\d:\d\d:\d\d$/);
  // 16:9 fits the screen: nothing to scroll, no tile spilling over.
  const fit = await page.evaluate(() => {
    const board = document.querySelector('.dc-board')!;
    const spill = [...document.querySelectorAll('.dc-board-panel')].some((p) => p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1);
    return { scroll: board.scrollHeight - board.clientHeight, spill };
  });
  expect(fit).toEqual({ scroll: 0, spill: false });
});

test('利率看板 standing up: one column that scrolls itself after 5 s, and stops for 30 s when touched', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto('/board');
  const board = page.locator('.dc-board');
  await expect(page.getByRole('status')).toHaveText(/^更新于/);
  const top = () => board.evaluate((b) => b.scrollTop);
  expect(await board.evaluate((b) => b.scrollHeight - b.clientHeight)).toBeGreaterThan(1);
  await page.waitForTimeout(4_000);
  expect(await top()).toBe(0);
  await expect.poll(top, { timeout: 5_000 }).toBeGreaterThan(50);
  // A key pauses it where it is.
  await page.keyboard.press('Shift');
  const held = await top();
  await page.waitForTimeout(1_500);
  expect(await top()).toBe(held);
});

test('利率看板 with 减少动态效果 does not scroll', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto('/board');
  await expect(page.getByRole('status')).toHaveText(/^更新于/);
  await page.waitForTimeout(7_000);
  expect(await page.locator('.dc-board').evaluate((b) => b.scrollTop)).toBe(0);
});

test('大屏时间: Shanghai time to the second, calibrated', async ({ page }) => {
  await page.goto('/clock');
  await expect(page.locator('.dc-clock-time')).toHaveText(/^\d\d:\d\d:\d\d$/);
  await expect(page.locator('.dc-clock-date')).toHaveText(/^\d{1,2}月\d{1,2}日 星期[一二三四五六日]$/);
  const first = await page.locator('.dc-clock-time').textContent();
  await expect(page.locator('.dc-clock-time')).not.toHaveText(first!);
  await expect(page.getByText('未校准')).toHaveCount(0);
  expect(await page.title()).toBe('大屏时间');
});

test('发送 two small files for a pickup code', async ({ page }) => {
  await page.goto('/transfer');
  const steps = page.getByRole('list', { name: '步骤' }).locator('li');
  await expect(steps).toHaveText(['选择文件', '上传', '告诉对方取件码']);
  await expect(steps.first()).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: '上传', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: '这次的额度' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '使用说明' }).locator('.dc-kv > div')).toHaveText([
    '保留时间7 天，到期自动删除', '文件个数一次至多 20 个', '单个文件100 MB 以内', '合计大小200 MB 以内', '上传次数同一网络每小时 10 次']);
  await page.locator('input[type="file"]').setInputFiles([
    { name: '报告.txt', mimeType: 'text/plain', buffer: Buffer.from('海豚银行 11 月报表') },
    { name: 'empty.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) },
  ]);
  await expect(page.getByRole('list', { name: '要发送的文件' }).locator('.dc-file-name')).toHaveText(['报告.txt', 'empty.bin']);
  await expectIcons(page, '要发送的文件', ['file-text', 'file']);
  // 这次的额度 holds the count and the total; the ActionBar only the button.
  const quota = page.getByRole('region', { name: '这次的额度' });
  await expect(quota.locator('.dc-progress-head')).toHaveText(['文件个数2 / 20', '合计大小1 KB / 200 MB']);
  await expect(page.locator('.dc-actions-total')).toHaveCount(0);
  await page.getByRole('button', { name: '上传 2 个文件' }).click();
  await expect(pickup(page)).toHaveText(/^\d{4}$/);
  code = (await pickup(page).textContent())!;
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(0)).toHaveClass('is-done');
  await expect(pickup(page)).toHaveAttribute('aria-label', `取件码 ${code}`);
  await expect(page.locator('.dc-pickup-due')).toHaveText(/^\d{1,2}月\d{1,2}日 \d\d:\d\d 到期$/);
  // 7 days from the server's clock, read on the browser's: a little either way.
  await expect(page.locator('.dc-pickup .dc-caption')).toHaveText(/^还剩 (7 天|6 天 23 小时)$/);
  await expect(page.getByRole('list', { name: '这次发出的文件' }).locator('.dc-list-item')).toHaveText(['报告.txt1 KB', 'empty.bin1 KB']);
  await expectIcons(page, '这次发出的文件', ['file-text', 'file']);
  await expect(page.getByText('2 个文件，合计 1 KB')).toBeVisible();
  await expect(page.locator('.dc-actions')).toHaveCount(0);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: '复制链接' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/transfer?code=${code}`);
  await page.getByRole('button', { name: '再发一批' }).click();
  await expect(page.getByRole('button', { name: '上传', exact: true })).toBeDisabled();
  await expect(steps.first()).toHaveAttribute('aria-current', 'step');
});

test('发送 lists each file with the icon of its type', async ({ page }) => {
  await page.goto('/transfer');
  await page.locator('input[type="file"]').setInputFiles(['计划.PDF', '名单.xlsx', '资料.zip', 'README']
    .map((name) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from('x') })));
  await expectIcons(page, '要发送的文件', ['file-text', 'file-sheet', 'file-archive', 'file']);
});

test('发送 more than 200 MB in all: the total turns red with what is over, and nothing can be sent', async ({ page }) => {
  await page.goto('/transfer');
  // Made in the page: Playwright's setInputFiles takes at most 50 MB.
  await page.locator('input[type="file"]').evaluate((input: HTMLInputElement) => {
    const files = new DataTransfer();
    for (const n of [90, 90, 30]) files.items.add(new File([new Uint8Array(n * 1_048_576)], `${n}.bin`));
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const total = page.getByRole('region', { name: '这次的额度' }).locator('.dc-progress').last();
  await expect(total).toHaveClass(/is-danger/);
  await expect(total.locator('.dc-progress-head b')).toHaveText('210 MB / 200 MB');
  await expect(total.locator('.dc-caption')).toHaveText('超出 10 MB，请移除一些文件。');
  await expect(page.locator('.dc-notice-danger')).toContainText('合计太大');
  await expect(page.getByRole('button', { name: '上传 3 个文件' })).toBeDisabled();
});

test('接收 with the code lists the files and downloads them under their names', async ({ page }) => {
  await page.goto('/transfer');
  await page.getByRole('tab', { name: '接收' }).click();
  await expect(page.getByRole('button', { name: '取件' })).toBeDisabled();
  // Typing moves on box by box.
  await boxes(page).first().click();
  await page.keyboard.type(code);
  await typed(page).toEqual([...code]);
  await expect(page.getByRole('list', { name: '步骤' }).locator('li[aria-current="step"]')).toHaveText('输入取件码');
  await page.getByRole('button', { name: '取件' }).click();
  const files = page.getByRole('list', { name: '文件' });
  await expect(files.locator('.dc-file-name')).toHaveText(['报告.txt', 'empty.bin']);
  await expectIcons(page, '文件', ['file-text', 'file']);
  await expect(files.locator('small')).toHaveText(['1 KB', '1 KB']);
  await expect(page.getByRole('list', { name: '步骤' }).locator('li[aria-current="step"]')).toHaveText('下载文件');
  await expect(page.getByText(/^还剩 (7 天|6 天 23 小时)，有效期内可以反复下载。$/)).toBeVisible();
  await expect(page.getByText('2 个文件，合计 1 KB')).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: '接收' }).getByRole('region', { name: '使用说明' }).locator('.dc-kv > div'))
    .toHaveText(['有效期生成后 7 天', '下载次数有效期内不限', '输错取件码连错 10 次后等 10 分钟']);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载 报告.txt' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('报告.txt');
  expect((await import('node:fs')).readFileSync((await file.path())!, 'utf8')).toBe('海豚银行 11 月报表');
  // ?code= opens 接收 and takes it at once.
  await page.goto(`/transfer?code=${code}`);
  await expect(page.getByRole('tab', { name: '接收' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('list', { name: '文件' }).locator('.dc-list-item')).toHaveCount(2);
});

test('a wrong code says so and empties the boxes', async ({ page }) => {
  const wrong = sql(`select lpad(n::text, 4, '0') from generate_series(0, 9999) n where lpad(n::text, 4, '0') not in (select code from public.transfers) limit 1`);
  await page.goto('/transfer');
  await page.getByRole('tab', { name: '接收' }).click();
  await boxes(page).first().focus();
  // Pasting 4 digits fills all four boxes.
  await page.evaluate((text) => {
    const data = new DataTransfer();
    data.setData('text', text);
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, wrong);
  await typed(page).toEqual([...wrong]);
  await page.getByRole('button', { name: '取件' }).click();
  await expect(page.locator('.dc-notice-danger')).toContainText('取件码不对或已过期请核对 4 位取件码。取件码在生成后 7 天内有效。');
  await typed(page).toEqual(['', '', '', '']);
  await expect(boxes(page).first()).toBeFocused();
  await expect(page.locator('.dc-code')).toHaveClass(/is-error/);
});

test('后台「文件」lists the pickup without its code and deletes it with a reason', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/transfers');
  await expect(page.getByRole('heading', { name: '文件传输' })).toBeVisible();
  await expect(page.locator('.dc-caption')).toHaveText('未到期的取件 1 次，合计 1 KB，上限 5 GB。');
  const row = page.getByRole('list', { name: '未到期的取件' }).locator('.dc-list-item');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('2 个文件 · 1 KB');
  await expect(row).toContainText('报告.txt、empty.bin');
  // A pickup of files of different types: the plain file icon.
  await expect(row.locator('.dc-list-icon svg')).toHaveAttribute('data-icon', 'file');
  await expect(row).not.toContainText(code);
  await row.getByRole('button', { name: '删除' }).click();
  const sheet = page.locator('.dc-sheet');
  await expect(sheet.locator('.dc-sheet-title')).toHaveText('删除这 2 个文件？');
  await sheet.getByRole('button', { name: '确认删除' }).click();
  await expect(sheet.locator('.dc-field-hint')).toHaveText('请写明删除的原因');
  await sheet.getByLabel('原因').fill('发错了文件');
  await sheet.getByRole('button', { name: '确认删除' }).click();
  await expect(page.locator('.dc-toast')).toHaveText('已删除');
  await expect(page.getByText('没有未到期的取件')).toBeVisible();
  // The log keeps it under 文件传输.
  await page.goto('/admin/audit');
  await expect(page.getByText('提前删除文件传输').first()).toBeVisible();
  // The code no longer opens.
  await page.goto(`/transfer?code=${code}`);
  await expect(page.locator('.dc-notice-danger')).toContainText('取件码不对或已过期');
});

test('the nav has 文件 after 日志 for the bank admin', async ({ page }) => {
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);
  const nav = page.getByRole('navigation', { name: '主导航' }).getByRole('link');
  await expect(nav.filter({ hasText: /^(参数|日志|文件|我的)$/ })).toHaveText(['参数', '日志', '文件', '我的']);
});

test.describe(() => {
  test.use({ serviceWorkers: 'block' }); // page.route sees the app's own requests only
  const second = (url: URL) => url.pathname.includes('/upload/sign/') && url.pathname.endsWith('/2');
  const list = (page: Page) => page.getByRole('list', { name: '要发送的文件' }).locator('.dc-list-item');

  test('发送: a file that failed can be removed, and the rest go as a new send', async ({ page }) => {
    await page.route(second, (route) => route.abort());
    await page.goto('/transfer');
    await page.locator('input[type="file"]').setInputFiles([
      { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') },
      { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('b') },
    ]);
    await page.getByRole('button', { name: '上传 2 个文件' }).click();
    await expect(page.locator('.dc-notice-danger')).toContainText('没有传完');
    await expect(list(page)).toHaveText(['a.txt1 KB已上传', 'b.txt1 KB · 没有传完重试']);
    await expect(page.getByRole('button', { name: '重试未传完的' })).toBeEnabled();
    await page.getByRole('button', { name: '移除 b.txt' }).click();
    // The send no longer holds these files: the rest wait for a new one, and files can be added again.
    await expect(list(page)).toHaveText(['a.txt1 KB']);
    await expect(page.getByRole('button', { name: '选择文件' })).toBeEnabled();
    await page.getByRole('button', { name: '上传 1 个文件' }).click();
    await expect(pickup(page)).toHaveText(/^\d{4}$/);
    await expect(page.getByRole('list', { name: '这次发出的文件' }).locator('.dc-file-name')).toHaveText(['a.txt']);
  });

  test('发送: a send past its 2 hours starts over with the same files', async ({ page }) => {
    let fail = true;
    await page.route((url) => url.pathname.includes('/upload/sign/'), (route) => (fail ? route.abort() : route.continue()));
    await page.goto('/transfer');
    await page.locator('input[type="file"]').setInputFiles([{ name: 'c.txt', mimeType: 'text/plain', buffer: Buffer.from('c') }]);
    await page.getByRole('button', { name: '上传 1 个文件' }).click();
    await expect(list(page)).toHaveText(['c.txt1 KB · 没有传完重试']);
    sql(`update public.transfers set created_at = now() - interval '3 hours' where code is null`);
    fail = false;
    await page.getByRole('button', { name: '重试未传完的' }).click();
    await expect(page.locator('.dc-notice-danger')).toContainText('这次发送已失效，请重新选择文件。');
    await expect(list(page)).toHaveText(['c.txt1 KB']);
    await expect(page.getByRole('button', { name: '选择文件' })).toBeEnabled();
    await page.getByRole('button', { name: '上传 1 个文件' }).click();
    await expect(pickup(page)).toHaveText(/^\d{4}$/);
  });
});
