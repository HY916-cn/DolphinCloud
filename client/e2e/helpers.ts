/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';

// The longest a spec file runs: one that would cross midnight (Asia/Shanghai) waits for it first, since a duty begun
// before today takes no more business (STALE_DUTY).
const SPEC_WINDOW = 3 * 60_000;

// Puts the test container back to freshly seeded data: the migrated state saved by docker/e2e-test.sh, then
// supabase/seed.sql, so teller01's duty and the seeded business are from today. Every spec file starts with
// `test.beforeAll(resetData)`, so no spec depends on another one's changes or order. Skipped without E2E_CONTAINER,
// i.e. when the tests run against a server that docker/e2e-test.sh did not start.
export function resetData() {
  const name = process.env.E2E_CONTAINER;
  if (!name) return;
  const toMidnight = 86_400_000 - ((Date.now() + 8 * 3_600_000) % 86_400_000); // Asia/Shanghai is UTC+8 all year
  if (toMidnight < SPEC_WINDOW) {
    test.setTimeout(toMidnight + 60_000);
    execFileSync('sleep', [String(Math.ceil(toMidnight / 1000) + 1)]);
  }
  execFileSync('docker', ['exec', name, 'sh', '-ec', `
    psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/e2e-base.sql >/dev/null
    psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/e2e-seed.sql
    find /data/storage -mindepth 1 -delete
    tar -xf /tmp/e2e-storage.tar -C /data`], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Runs one statement in the test container's database and gives its output, for a state the pages only reach after many steps.
export const sql = (statement: string) => execFileSync('docker', ['exec', process.env.E2E_CONTAINER!, 'psql', '-U', 'postgres', '-qAt', '-c', statement], { encoding: 'utf8' }).trim();

// Signs in with the default password a12345678 (every seed login uses it); `save` ticks 在此设备保存登录.
export async function signIn(page: Page, kind: '学生' | '工作人员', id: string, path = '/login?add=1', password = 'a12345678', save = false) {
  await page.goto(path);
  await page.locator('.dc-seg label', { hasText: kind }).click();
  await page.getByPlaceholder(kind === '学生' ? '请输入学号' : '请输入账号').fill(id);
  await page.getByPlaceholder('请输入密码').fill(password);
  if (save) await page.locator('label', { hasText: '在此设备保存登录' }).click();
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

// 上班: the 备用金 card opens with the last one, and it is confirmed as it is.
export async function startDuty(page: Page) {
  await page.getByRole('button', { name: '上班', exact: true }).click();
  await page.getByRole('button', { name: '确认上班' }).click();
}

// 下班: the cash box is counted as it should hold (a face it should be short of counts 0, with a reason), then the
// summary is kept as a PDF and the duty ends; `skip` goes on without it.
export async function endDuty(page: Page, skip = false) {
  await page.getByRole('button', { name: '下班' }).click();
  const card = page.locator('section[aria-label="点储蓄盒"]');
  await expect(card.locator('.dc-qty').first()).toBeVisible();
  for (const qty of await card.locator('.dc-qty').all()) {
    const expected = await qty.locator('.dc-qty-sum b').textContent();
    await qty.locator('.dc-qty-input').fill(/^\d+$/.test(expected!) ? expected! : '0');
  }
  const actions = page.locator('.dc-actions');
  await actions.getByRole('button', { name: '核对' }).click();
  await expect(card.locator('.dc-notice-success, .dc-notice-danger')).toBeVisible();
  if (await card.locator('.dc-notice-danger').isVisible()) await card.getByLabel('原因').fill('储蓄盒少了零钱');
  if (skip) {
    await actions.getByRole('button', { name: '下班', exact: true }).click();
    await confirmIn(page, '确认下班');
  } else {
    await actions.getByRole('button', { name: '打印总结' }).click();
    const download = page.waitForEvent('download');
    await confirmIn(page, '下载 PDF');
    expect((await download).suggestedFilename()).toMatch(/^下班总结-.*\.pdf$/);
    await confirmIn(page, '已签字，确认下班');
  }
  await expect(page.locator('section[aria-label="上下班"]')).toContainText('未上班');
}

export const confirmIn = (page: Page, name: string) => page.locator('.dc-sheet').getByRole('button', { name }).click();

// A notice is drawn on a canvas: record every text drawn, before the page loads.
export const recordNotices = (page: Page) => page.addInitScript(() => {
  const drawn: string[] = ((window as unknown as { notices: string[] }).notices = []);
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    drawn.push(String(text));
    return fill.call(this, text, ...rest);
  };
});
export const drawnNotices = (page: Page) => page.evaluate(() => (window as unknown as { notices: string[] }).notices);

// Downloads the notices of the open sheet and gives the file; the initial password of a login or student number is
// then the text after the first 初始密码 label that follows it.
export async function downloadNotices(page: Page) {
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  return download;
}
export async function noticePassword(page: Page, id: string) {
  const texts = await drawnNotices(page);
  return texts[texts.indexOf('初始密码', texts.indexOf(id)) + 1] ?? '';
}
