import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetData, signIn, sql } from './helpers';

// 图标变形 (motion.md): an icon that swaps as its element's state changes morphs its strokes into the new one.
// It first draws without a morph, and swaps at once under reduced motion. The morph runs on requestAnimationFrame, so
// a paused clock steps it frame by frame; the mid-morph frames are saved next to the test's output.
test.beforeAll(resetData);
test.use({ deviceScaleFactor: 3 });

const d = (icon: Locator) => icon.locator('path').getAttribute('d');
// Pauses the page's clock `ms` past its own time, which runs ahead of the test's once fast-forwarded.
const pause = async (page: Page, ms: number) => page.clock.pauseAt(await page.evaluate(() => Date.now()) + ms);

// Steps the paused clock 1ms at a time until the page shows the change (React Query and React render on timers);
// the morph's first frame comes 16ms later at most, so the frames below stay close to their nominal times.
async function until(page: Page, shown: () => Promise<boolean>) {
  for (let i = 0; i < 3000 && !(await shown()); i++) await page.clock.runFor(1);
  expect(await shown()).toBe(true);
}

// Takes three frames along the way, then checks the icon came to rest on another shape, passing through others,
// within 320ms of its first frame (motion.md "图标变形"); that frame itself comes up to 16ms after the change.
async function morphs(page: Page, icon: Locator, shot: Locator, name: string) {
  const from = await d(icon);
  const seen: (string | null)[] = [];
  for (const [i, ms] of [80, 80, 80].entries()) {
    await page.clock.runFor(ms);
    seen.push(await d(icon));
    await shot.screenshot({ path: test.info().outputPath(`${name}-${i + 1}-${(i + 1) * ms}ms.png`) });
  }
  await page.clock.runFor(320 + 16 - 240);
  const to = await d(icon);
  await page.clock.runFor(1000);
  expect(await d(icon)).toBe(to); // at rest
  expect(to).not.toBe(from);
  for (const mid of seen.slice(0, 2)) expect([from, to]).not.toContain(mid); // in between, not a jump
  return { from, to };
}

test('a status tag and the empty-state icons morph when their state changes', async ({ page }) => {
  sql("update profiles set must_change_password = false"); // 未设置密码 then lists nobody: the empty state with `me`
  await page.clock.install();
  await signIn(page, '工作人员', 'admin');
  await expect(page).toHaveURL(/\/admin$/);

  // 商品: 海豚书签 goes off the shelf while the list is open; the refetch on focus turns 已上架 into 已下架.
  await page.locator('.dc-nav-item', { hasText: '商品' }).click();
  const tag = page.locator('.dc-list-link', { hasText: '海豚书签' }).locator('.dc-tag', { hasText: /已上架|已下架/ });
  await expect(tag).toHaveText('已上架');
  await expect(tag.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  sql("update products set listed = false where name = '海豚书签'");
  await pause(page, 31_000); // past React Query's 30s staleTime
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await until(page, async () => (await tag.allTextContents())[0] === '已下架');
  await morphs(page, tag.locator('svg'), tag, 'product-tag');

  // 工作人员: 已停用 lists nobody, so the empty state draws `teacher` at once; a search turns it into `query`.
  await page.clock.resume();
  await page.goto('/admin/staff');
  await page.getByRole('button', { name: /^已停用/ }).click();
  const empty = page.locator('.dc-empty');
  const staffIcon = empty.locator('.dc-empty-icon svg');
  await expect(empty.locator('h3')).toHaveText('没有停用的账号');
  await expect(staffIcon).toHaveAttribute('aria-hidden', 'true');
  const teacher = await d(staffIcon);
  await pause(page, 1000);
  await page.getByLabel('搜索工作人员').fill('zz');
  await until(page, async () => (await empty.locator('h3').allTextContents())[0] === '没有找到「zz」');
  expect((await morphs(page, staffIcon, empty, 'staff-empty')).to).not.toBe(teacher);

  // Reduced motion: clearing the search puts `teacher` back in one step, with the clock still paused.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByLabel('搜索工作人员').fill('');
  await until(page, async () => (await empty.locator('h3').allTextContents())[0] === '没有停用的账号');
  await expect.poll(() => d(staffIcon)).toBe(teacher);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  // 学生: 未设置密码 lists nobody, so the empty state draws `me`; a search turns it into `query`.
  await page.clock.resume();
  await page.goto('/admin/students');
  await page.getByRole('button', { name: /^未设置密码/ }).click();
  await expect(empty.locator('h3')).toHaveText('所有学生都已设置新密码');
  const studentIcon = empty.locator('.dc-empty-icon svg');
  await pause(page, 1000);
  await page.getByLabel('搜索学生').fill('zz');
  await until(page, async () => (await empty.locator('h3').allTextContents())[0] === '没有找到「zz」');
  await morphs(page, studentIcon, empty, 'student-empty');
});
