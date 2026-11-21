// Fills the seed data with a little history before the takes, through the counter as teller01 would (no recording):
// 王小雨 deposits 98 HTB and exchanges a 海豚书签, so her card and pages are not empty. Run once after seed.sql,
// then `capture/reset.sh save`.
import { open, signIn } from './lib.mjs';

const { browser, page } = await open({ width: 1180, height: 820 });
await signIn(page, '工作人员', 'teller01');
await page.waitForURL(/\/counter$/);
await page.getByRole('searchbox', { name: '搜索学生' }).fill('20260003');
await page.locator('.dc-list-link', { hasText: '王小雨' }).tap();
await page.locator('.dc-person-name').waitFor();
for (const [face, n] of [[10, 8], [5, 2], [2, 4]]) for (let i = 0; i < n; i++) await page.getByLabel(`增加一张 ${face} 元`).tap();
await page.getByRole('button', { name: '确认存款 98 HTB' }).tap();
await page.locator('aside[aria-label="办理单"] .dc-pop').first().waitFor();
await page.locator('.dc-seg label', { hasText: '兑换' }).tap();
await page.locator('.dc-tile', { hasText: '海豚书签' }).tap();
await page.getByRole('button', { name: '确认兑换 10 HTB' }).tap();
await page.locator('.dc-sheet').getByRole('button', { name: '确认兑换' }).tap();
await page.locator('aside[aria-label="办理单"] .dc-pop').nth(1).waitFor();
await page.locator('aside[aria-label="办理单"]').getByRole('button', { name: /^结束办理/ }).tap();
await page.locator('.dc-notice-success').waitFor();
console.log(await page.locator('.dc-notice-success').innerText());
await browser.close();
