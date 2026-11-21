// Records a real page in real time at the device pixel ratio, then turns the frames into a 30 fps video that keeps their wall-clock timing: nothing is sped up,
// slowed down or redrawn. Markers (taps, the start and end of a business) are written next to the video, on the
// same clock, so the Remotion side can move the camera and run the timer from what really happened.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BASE = process.env.DEMO_BASE ?? 'http://localhost:8093';
export const CAPTURES = new URL('../captures/', import.meta.url).pathname;
const FPS = 30;

// A touch device of the given CSS size, rendered natively at `scale` (no viewport emulation: with it, a second CDP
// session's screenshots come out at 1x, and asking them for the scale re-lays the page out every frame).
export async function open({ width, height, scale = 2 }) {
  const browser = await chromium.launch({ args: [`--window-size=${width},${height}`, `--force-device-scale-factor=${scale}`] });
  const context = await browser.newContext({
    viewport: null, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: 'light', reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  return { browser, context, page, viewport: { width, height, scale } };
}

export async function signIn(page, kind, id, path = '/login?add=1') {
  await page.goto(BASE + path);
  await page.locator('.dc-seg label', { hasText: kind }).tap();
  await page.getByPlaceholder(kind === '学生' ? '请输入学号' : '请输入账号').fill(id);
  await page.getByPlaceholder('请输入密码').fill('a12345678');
  await page.getByRole('button', { name: '登录', exact: true }).tap();
}

// Starts recording `page`; the returned recorder takes markers and, on stop(), writes captures/<name>.mp4 and .json.
// Frames are full-resolution screenshots, taken by three CDP sessions at once (one alone manages about 20 a second at
// 2x, three about 55), each stamped with the middle of its request. Chrome's screencast only sends frames at 1x.
export async function record(page, name, viewport) {
  const dir = join(CAPTURES, `${name}-frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const writes = [];
  const t0 = Date.now();
  let running = true;
  const sessions = [];
  for (let i = 0; i < 3; i++) {
    sessions.push(await page.context().newCDPSession(page));
  }
  const loop = Promise.all(sessions.map(async (cdp) => {
    while (running) {
      const asked = Date.now();
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true });
      const file = join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
      frames.push({ file, t: (asked + Date.now()) / 2 - t0 });
      writes.push(Promise.resolve().then(() => writeFileSync(file, Buffer.from(data, 'base64'))));
    }
  }));
  const markers = [];
  const now = () => Date.now() - t0;

  return {
    now,
    mark(label, extra = {}) { markers.push({ label, t: now(), ...extra }); },
    // Where elements are on the screen right now (CSS px), for the layers that float out of it.
    async rects(label, locators) {
      const t = now();
      const boxes = {};
      for (const [key, locator] of Object.entries(locators)) boxes[key] = await locator.boundingBox();
      markers.push({ label, t, rects: boxes });
    },
    // Taps a locator like a finger: the marker carries the centre of what was tapped, in CSS pixels.
    async tap(locator, label = 'tap') {
      const box = await locator.boundingBox();
      markers.push({ label, t: now(), x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await locator.tap();
    },
    async stop(holdMs = 1500) {
      await page.waitForTimeout(holdMs);
      const end = now();
      running = false;
      await loop;
      await Promise.all(writes);
      frames.sort((a, b) => a.t - b.t);
      // Each frame stays on screen until the next one arrived; the last one until the end of the hold.
      const list = frames.map((f, i) => {
        const next = i + 1 < frames.length ? frames[i + 1].t : end;
        return `file '${f.file}'\nduration ${Math.max(next - f.t, 1) / 1000}`;
      });
      writeFileSync(join(dir, 'list.txt'), list.join('\n') + `\nfile '${frames.at(-1).file}'\n`);
      const out = join(CAPTURES, `${name}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
        '-vf', `fps=${FPS}`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '8', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
      const durationMs = end;
      writeFileSync(join(CAPTURES, `${name}.json`), JSON.stringify({ ...viewport, durationMs, frames: frames.length, markers }, null, 2));
      rmSync(dir, { recursive: true, force: true });
      console.log(`${name}: ${frames.length} frames over ${(durationMs / 1000).toFixed(2)} s (${(frames.length / durationMs * 1000).toFixed(1)} fps captured)`);
      return { out, markers, durationMs };
    },
  };
}
