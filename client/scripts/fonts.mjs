// Runs before `web` and `build`: copies the self-hosted fonts (@fontsource-variable, OFL) into public/fonts, so the
// site serves them itself; public/index.html links public/fonts/fonts.css. The browser fetches only the slices
// (unicode-range) a page uses.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = new URL('../public/fonts/', import.meta.url);
mkdirSync(out, { recursive: true });
const css = ['nunito-sans', 'noto-sans-sc'].map((name) => {
  const pkg = new URL(`../node_modules/@fontsource-variable/${name}/`, import.meta.url);
  cpSync(new URL('files/', pkg), new URL(`${name}/`, out), { recursive: true });
  return readFileSync(new URL('index.css', pkg), 'utf8').replaceAll('url(./files/', `url(/fonts/${name}/`);
});
writeFileSync(new URL('fonts.css', out), css.join('\n'));
