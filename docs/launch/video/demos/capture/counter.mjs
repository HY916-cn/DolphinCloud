// 演示 1 · 找人 and 演示 2 · 存款, one take on an iPad (landscape) as teller01: types "wxy", taps 王小雨, looks at her
// card, then enters the notes by face and confirms. A person's pace: the pauses are a teller reading the screen.
// Markers: start = first key (the stopwatch runs from it), person = her card shown, done = the deposit booked;
// rects = where the person card, the face cards and the 办理单 are, for the layers that float out.
import { open, record, signIn } from './lib.mjs';

const { browser, page, viewport } = await open({ width: 1180, height: 820, scale: 2 });
await signIn(page, '工作人员', 'teller01');
await page.waitForURL(/\/counter$/);
const search = page.getByRole('searchbox', { name: '搜索学生' });
await search.waitFor();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);

const rec = await record(page, 'counter', viewport);
await page.waitForTimeout(3600); // the iPad turns to face us first
await rec.rects('rects:search', { search: page.locator('.dc-search') });
await rec.tap(search, 'search');
rec.mark('start');
await search.pressSequentially('wxy', { delay: 260 });
const hit = page.locator('.dc-list-link', { hasText: '王小雨' }).first();
await hit.waitFor();
await rec.rects('rects:hit', { hit });
await page.waitForTimeout(900);
await rec.tap(hit, 'student');
await page.locator('.dc-person-name').waitFor();
rec.mark('person');
const receipt = page.locator('aside[aria-label="办理单"]');
const faces = page.locator('.dc-qty');
const layers = () => ({
  person: page.locator('.dc-person'), faces: faces.first().locator('xpath=..'), receipt,
  face10: faces.nth(3), face5: faces.nth(2), balance: page.locator('.dc-person-side'), confirm: page.locator('.dc-actions .dc-btn-primary'),
});
await page.waitForTimeout(400);
await rec.rects('rects:person', layers());
await page.waitForTimeout(5600); // 演示 1 ends on her card; 演示 2 starts with the notes
rec.mark('deposit');
const plus = (face) => page.getByLabel(`增加一张 ${face} 元`);
await rec.tap(plus(10), 'face10');
await page.waitForTimeout(650);
await rec.tap(plus(10), 'face10');
await page.waitForTimeout(900);
await rec.tap(plus(5), 'face5');
await page.waitForTimeout(400);
await rec.rects('rects:total', layers());
await page.waitForTimeout(2000);
await rec.tap(page.getByRole('button', { name: '确认存款 25 HTB' }), 'confirm');
await receipt.locator('.dc-pop').first().waitFor();
rec.mark('done');
await page.waitForTimeout(700);
await rec.rects('rects:done', layers());
await rec.stop(3500);
await browser.close();
