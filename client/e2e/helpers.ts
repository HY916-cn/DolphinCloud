/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

// Puts the test container back to the seeded data (snapshot taken by docker/e2e-test.sh); every spec file starts
// with `test.beforeAll(resetData)`, so no spec depends on another one's changes or order. Skipped without
// E2E_CONTAINER, i.e. when the tests run against a server that docker/e2e-test.sh did not start.
export function resetData() {
  const name = process.env.E2E_CONTAINER;
  if (!name) return;
  execFileSync('docker', ['exec', name, 'sh', '-ec', `
    psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/e2e-seed.sql >/dev/null
    find /data/storage -mindepth 1 -delete
    tar -xf /tmp/e2e-storage.tar -C /data`], { stdio: ['ignore', 'ignore', 'inherit'] });
}

// Signs in with the default password a12345678 (every seed login uses it); `save` ticks 在此设备保存登录.
export async function signIn(page: Page, kind: '学生' | '工作人员', id: string, path = '/login?add=1', password = 'a12345678', save = false) {
  await page.goto(path);
  await page.locator('.dc-seg label', { hasText: kind }).click();
  await page.getByPlaceholder(kind === '学生' ? '请输入学号' : '请输入账号').fill(id);
  await page.getByPlaceholder('请输入密码').fill(password);
  if (save) await page.getByText('在此设备保存登录').click();
  await page.getByRole('button', { name: '登录', exact: true }).click();
}

// 下班: the summary is kept as a PDF, then the duty ends; `skip` goes on without it.
export async function endDuty(page: Page, skip = false) {
  await page.getByRole('button', { name: '下班' }).click();
  if (skip) {
    await page.locator('.dc-sheet').getByRole('button', { name: '跳过打印' }).click();
    await confirmIn(page, '确认下班');
  } else {
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
