/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import type { Page } from '@playwright/test';

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

// Signs in with the default password a12345678 (every seed login uses it).
export async function signIn(page: Page, kind: '学生' | '工作人员', id: string, path = '/login', password = 'a12345678') {
  await page.goto(path);
  await page.locator('.dc-seg label', { hasText: kind }).click();
  await page.getByPlaceholder(kind === '学生' ? '请输入学号' : '请输入账号').fill(id);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
}

export const confirmIn = (page: Page, name: string) => page.locator('.dc-sheet').getByRole('button', { name }).click();
