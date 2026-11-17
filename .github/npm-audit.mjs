// Reads `npm audit --json` from stdin and fails on any high or critical advisory not listed in ALLOWED.
// Packages flagged only because a dependency carries an allowed advisory have no advisory of their own, so they pass.
import { readFileSync } from 'node:fs';

const ALLOWED = new Set([
  // picomatch ReDoS: no fixed version exists; only the expo/metro build tooling uses picomatch and the exported static
  // site does not contain it. Remove this entry once a fixed version is available.
  'GHSA-fc5q-39xc-vjpf',
]);

const report = JSON.parse(readFileSync(0, 'utf8'));
if (!report.vulnerabilities) {
  console.error('npm audit returned no report:', JSON.stringify(report.error ?? report));
  process.exit(1);
}

const found = new Map();
for (const { via } of Object.values(report.vulnerabilities)) {
  for (const advisory of via) {
    if (typeof advisory === 'string' || !['high', 'critical'].includes(advisory.severity)) continue;
    const id = advisory.url.split('/').pop();
    found.set(id, `${advisory.severity} ${advisory.name}: ${advisory.title} (${advisory.url})`);
  }
}

let blocked = 0;
for (const [id, line] of found) {
  if (ALLOWED.has(id)) console.log(`allowed  ${line}`);
  else (blocked++, console.error(`BLOCKED  ${line}`));
}
console.log(`${blocked} high or critical advisories outside the allow list.`);
process.exit(blocked ? 1 : 0);
