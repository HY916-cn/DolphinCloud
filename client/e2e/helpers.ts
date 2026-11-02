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
export async function signIn(page: Page, kind: '学生' | '工作人员', id: string, path = '/login', password = 'a12345678', save = false) {
  await page.goto(path);
  await page.locator('.dc-seg label', { hasText: kind }).click();
  await page.getByPlaceholder(kind === '学生' ? '请输入学号' : '请输入账号').fill(id);
  await page.getByPlaceholder('请输入密码').fill(password);
  if (save) await page.getByText('在此设备保存登录').click();
  await page.getByRole('button', { name: '登录' }).click();
}

// 下班: the summary is kept as a PDF, then the duty ends.
export async function endDuty(page: Page) {
  await page.getByRole('button', { name: '下班' }).click();
  const download = page.waitForEvent('download');
  await confirmIn(page, '下载 PDF');
  expect((await download).suggestedFilename()).toMatch(/^下班总结-.*\.pdf$/);
  await confirmIn(page, '已签字，确认下班');
  await expect(page.locator('section[aria-label="上下班"]')).toContainText('未上班');
}

export const confirmIn = (page: Page, name: string) => page.locator('.dc-sheet').getByRole('button', { name }).click();
