// Builds the two manuals in docs/manual: family.html → 海豚云学生与家长手册.pdf, staff.html → 海豚云工作人员手册.pdf.
// Screens come from the design system's page previews; icons from design-system/project/assets/Icons.
// Run: node docs/manual/build.mjs   (needs `npm --prefix client install` and Playwright's Chromium)
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../client/node_modules/playwright/index.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../', import.meta.url));
const ds = `${root}design-system/project`;
const theme = `${root}client/src/theme`;

// name → clip in preview CSS px (omit for the whole card)
const shots = {
  Cover: null,
  LoginPage: { x: 0, y: 0, width: 1440, height: 620 },
  StudentHomePage: { x: 0, y: 0, width: 1440, height: 620 },
  TxnHistoryPage: { x: 0, y: 0, width: 1440, height: 620 },
  RankingPage: { x: 0, y: 0, width: 1440, height: 620 },
  StudentBookPage: null,
  CounterServicePage: { x: 0, y: 0, width: 1440, height: 620 },
  CreditGauge: { x: 0, y: 0, width: 960, height: 440 },
  Loan: { x: 0, y: 0, width: 830, height: 1100 },
  CashCount: { x: 0, y: 0, width: 1240, height: 1380 },
  CashReview: { file: 'CashCount', x: 120, y: 1930, width: 1020, height: 780 },
  RateBoard: { x: 0, y: 0, width: 1950, height: 1110 },
  BigClock: { x: 0, y: 0, width: 1960, height: 1110 },
  FileTransfer: { x: 0, y: 0, width: 2060, height: 900 },
};

const browser = await chromium.launch();
const img = {};
for (const [name, spec] of Object.entries(shots)) {
  const file = `${ds}/components/${spec?.file ?? name}/preview.html`;
  const first = readFileSync(file, 'utf8').split('\n')[0];
  const width = +(first.match(/width=(\d+)/)?.[1] ?? 960);
  const height = +(first.match(/height=(\d+)/)?.[1] ?? 600);
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto(`file://${file}`);
  for (const css of [`${root}client/node_modules/@fontsource-variable/nunito-sans/index.css`,
    `${root}client/node_modules/@fontsource-variable/noto-sans-sc/index.css`, `${theme}/tokens.css`, `${theme}/bundle.css`])
    await page.addStyleTag({ url: `file://${css}` });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const { file: _, ...clip } = spec ?? {};
  const buf = await page.screenshot({ type: 'jpeg', quality: 86, fullPage: !spec, clip: spec ? clip : undefined });
  img[name] = `data:image/jpeg;base64,${buf.toString('base64')}`;
  await page.close();
}

const icons = {};
for (const f of readdirSync(`${ds}/assets/Icons`).filter((f) => f.endsWith('.svg')))
  icons[f.slice(0, -4)] = readFileSync(`${ds}/assets/Icons/${f}`, 'utf8')
    .replace(/<!--.*?-->\s*/s, '')
    .replace(/ width="48" height="48"/, '')
    .replace(/stroke="#[0-9a-f]+"/gi, 'stroke="currentColor"')
    .replace('<svg ', '<svg class="dc-icon" aria-hidden="true" ');

const books = { 'family.html': '海豚云学生与家长手册.pdf', 'staff.html': '海豚云工作人员手册.pdf' };
let failed = false;
for (const [html, pdf] of Object.entries(books)) {
  const page = await browser.newPage();
  await page.goto(`file://${here}${html}`);
  const problems = await page.evaluate(({ img, icons }) => {
    document.querySelectorAll('img[data-shot]').forEach((el) => { el.src = img[el.dataset.shot]; });
    document.querySelectorAll('i[data-icon]').forEach((el) => { el.outerHTML = icons[el.dataset.icon]; });
    const pages = [...document.querySelectorAll('.page')];
    // chapters are numbered in page order; each footer names the chapter it sits in
    let chap = document.title;
    let n = 0;
    pages.forEach((p, i) => {
      const opener = p.querySelector('.opener');
      if (opener) {
        n += 1;
        const no = String(n).padStart(2, '0');
        opener.querySelector('.no').textContent = `CHAPTER ${no}`;
        opener.dataset.no = no;
        chap = `${no} ${opener.querySelector('h1').textContent}`;
      }
      p.querySelectorAll('.chap').forEach((c) => { c.textContent = chap; });
      p.querySelectorAll('.pno').forEach((c) => { c.textContent = i + 1; });
    });
    document.querySelectorAll('.toc a[data-ref]').forEach((a) => {
      const t = document.getElementById(a.dataset.ref);
      if (!t) return;
      a.querySelector('.n').textContent = t.dataset.no;
      a.querySelector('.p').textContent = pages.indexOf(t.closest('.page')) + 1;
    });
    return [
      ...pages.flatMap((p, i) => (p.querySelector('.body')?.scrollHeight > p.querySelector('.body')?.clientHeight + 1 ? [`page ${i + 1} overflows`] : [])),
      ...[...document.querySelectorAll('.toc a[data-ref]')].filter((a) => !a.querySelector('.p').textContent).map((a) => `missing #${a.dataset.ref}`),
      ...[...document.querySelectorAll('i[data-icon]')].map((i) => `missing icon ${i.dataset.icon}`),
    ];
  }, { img, icons });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  if (problems.length) { failed = true; console.error(`${html}:\n${problems.join('\n')}`); }
  // PREVIEW_DIR=<dir> also saves each page as a PNG for checking the layout
  if (process.env.PREVIEW_DIR) {
    const dir = `${process.env.PREVIEW_DIR}/${html.replace('.html', '')}`;
    mkdirSync(dir, { recursive: true });
    for (const [i, p] of (await page.locator('.page').all()).entries()) await p.screenshot({ path: `${dir}/p${String(i + 1).padStart(2, '0')}.png` });
  }
  await page.pdf({ path: `${here}${pdf}`, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
  console.log(`${pdf}: ${await page.locator('.page').count()} pages`);
  await page.close();
}
await browser.close();
if (failed) process.exit(1);
