// Runs before `web` and `build`: copies the self-hosted fonts (@fontsource-variable, OFL) into public/fonts, so the
// site serves them itself; public/index.html links public/fonts/fonts.css. Only the files the CSS uses are copied,
// and the browser fetches only the slices (unicode-range) a page needs.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const out = new URL('../public/fonts/', import.meta.url);
rmSync(out, { recursive: true, force: true });
const css = ['nunito-sans', 'noto-sans-sc'].map((name) => {
  const pkg = new URL(`../node_modules/@fontsource-variable/${name}/`, import.meta.url);
  mkdirSync(new URL(`${name}/`, out), { recursive: true });
  const source = readFileSync(new URL('index.css', pkg), 'utf8');
  for (const [, file] of source.matchAll(/url\(\.\/files\/([^)]+)\)/g)) {
    copyFileSync(new URL(`files/${file}`, pkg), new URL(`${name}/${file}`, out));
  }
  return source.replaceAll('url(./files/', `url(/fonts/${name}/`);
});
writeFileSync(new URL('fonts.css', out), css.join('\n'));
