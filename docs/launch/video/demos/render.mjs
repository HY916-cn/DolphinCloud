// Renders each demo twice into docs/launch/video/out/demos/: ProRes 422 HQ for the edit and H.264 for previews.
//   npm run render            every composition
//   npm run render -- Demo01  just these
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const NAMES = { Demo01: 'demo01-find', Demo02: 'demo02-deposit' };
const out = new URL('../out/demos/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const id of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(NAMES)) {
  const run = (...args) => execFileSync('npx', ['remotion', 'render', 'src/index.ts', id, ...args], { stdio: 'inherit' });
  run(`${out}${NAMES[id]}.mov`, '--codec=prores', '--prores-profile=hq');
  run(`${out}${NAMES[id]}.mp4`, '--codec=h264', '--crf=16');
}
