// Recount the launch numbers (P10) from the repository and write src/numbers.json.
// Run before the final render: `npm run numbers`.
import { execSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";

const root = execSync("git rev-parse --show-toplevel").toString().trim();
const sh = (cmd) => execSync(cmd, { cwd: root }).toString().trim();
const ds = `${root}/design-system/project`;

const commits = Number(sh("git rev-list --count HEAD"));
const components = readdirSync(`${ds}/components`, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
const icons = readdirSync(`${ds}/assets/Icons`).filter((f) => f.endsWith(".svg")).length;

// pgTAP assertions: the "PASS: file.sql (N tests)" lines of the latest green CI run on main.
const run = sh("gh run list --workflow ci.yml --branch main --status success --limit 1 --json databaseId -q '.[0].databaseId'");
const log = sh(`gh run view ${run} --log | grep -o "PASS: [^ ]*\\.sql ([0-9]* tests)"`);
const passes = new Map([...log.matchAll(/PASS: (\S+\.sql) \((\d+) tests\)/g)].map((m) => [m[1], Number(m[2])]));
const dbTests = [...passes.values()].reduce((a, b) => a + b, 0);

const numbers = { from: "10月27日", to: "11月21日", days: 26, commits, components, icons, dbTests, ciRun: run, countedAt: new Date().toISOString() };
writeFileSync(new URL("../src/numbers.json", import.meta.url), JSON.stringify(numbers, null, 2) + "\n");
console.log(numbers);
