import type { Page } from '@playwright/test';

// Signs in with the default password a12345678 (every seed login uses it).
export async function signIn(page: Page, kind: '学生' | '工作人员', id: string, path = '/login', password = 'a12345678') {
  await page.goto(path);
  await page.locator('.dc-seg label', { hasText: kind }).click();
  await page.getByPlaceholder(kind === '学生' ? '请输入学号' : '请输入账号').fill(id);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
}

export const confirmIn = (page: Page, name: string) => page.locator('.dc-sheet').getByRole('button', { name }).click();
